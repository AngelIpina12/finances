"use server";

import { auth } from "@/lib/auth";
import { drizzleDb, accounts, transactions, type Transaction, type Account } from "@/lib/db";
import { eq, and, gte, lte, or } from "drizzle-orm";
import { recurringPayments } from "@/lib/db/schema";
import Decimal from "decimal.js";
import { addMonths } from "date-fns";

export interface FutureCharge {
  name: string;
  amount: string;
  nextPaymentDate: Date;
  description?: string;
}

export interface BillingCycleInfo {
  accountId: string;
  billingDate: number;
  dueDate: number;
  cycleStart: Date;
  cycleEnd: Date;
  duePaymentDate: Date;
  totalCharges: string;
  totalPayments: string;
  netOwed: string;
  owedAmount: string;
  byTermMonthlyPayment: string;
  futureCharges: FutureCharge[];
  currency: string;
  accountName: string;
}

/**
 * Calculate the billing cycle balance for a credit card account.
 *
 * Dynamic billing cycle based on the account's billingDate field:
 * Cycle runs from (billingDate + 1) of the previous month to billingDate of the current month.
 * For example (if billingDate = 15 and today is July 31):
 * - Last closed cycle: June 16 to July 15
 * - Payment due: based on the card's dueDate
 */
export async function getCreditCardBillingCycleInfo(
  accountId: string
): Promise<BillingCycleInfo | null> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Get the credit card account
  const account = await drizzleDb
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.userId, session.user.id),
        eq(accounts.type, "credit")
      )
    )
    .limit(1);

  if (!account[0] || !account[0].dueDate || !account[0].billingDate) {
    return null;
  }

  const creditCard = account[0];
  const dueDate = creditCard.dueDate as number;
  const billingDate = creditCard.billingDate as number;

  // Dynamic billing cycle: determined by the account's billingDate
  // Cycle runs from (billingDate + 1) of previous month to billingDate of current month
  // For example, if billingDate = 15: cycle is 16th of prev month to 15th of this month
  // If billingDate = 14: cycle is 15th of prev month to 14th of this month
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentDay = now.getDate();

  let cycleEnd: Date;
  let cycleStart: Date;

  // Show the CURRENT cycle (the one that is open right now, not yet closed)
  // If currentDay <= billingDate, we're still in last cycle (billing date hasn't passed this month)
  // If currentDay > billingDate, we're in the new cycle (billing date passed, new cycle started)
  const currentBillingMonth = currentDay <= billingDate ? currentMonth - 1 : currentMonth;
  cycleStart = new Date(currentYear, currentBillingMonth, billingDate + 1);
  cycleEnd = new Date(currentYear, currentBillingMonth + 1, billingDate);

  // Due payment date: due date of the month after the cycle ends
  const duePaymentDate = new Date(cycleEnd.getFullYear(), cycleEnd.getMonth() + 1, dueDate);

  // Calculate next charge date for by_term payments on this account
  // Next charge is billingDate + 1 (day after billing) of the current/next month
  let nextChargeDate: Date;
  if (currentDay <= billingDate) {
    nextChargeDate = new Date(currentYear, currentMonth, billingDate + 1);
  } else {
    nextChargeDate = new Date(currentYear, currentMonth + 1, billingDate + 1);
  }

  // Get all transactions in this billing cycle
  // INCLUDE all transactions (both regular and by_term/MSI) for the cycle total
  const cycleTransactions = await drizzleDb
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        eq(transactions.userId, session.user.id),
        gte(transactions.date, cycleStart),
        lte(transactions.date, cycleEnd)
      )
    );

  // Calculate totals
  // totalCharges = ONLY regular expenses (no recurring_payment_id / MSI)
  // MSI transactions are tracked separately in owedAmount/byTermMonthlyPayment
  let totalCharges = new Decimal(0);
  let totalPayments = new Decimal(0);

  for (const tx of cycleTransactions) {
    const amount = new Decimal(tx.amount);
    if (tx.type === "expense" && !tx.recurringPaymentId) {
      // Regular expense (not MSI/by_term)
      totalCharges = totalCharges.plus(amount);
    } else if (tx.type === "expense" && tx.recurringPaymentId) {
      // MSI/by_term transaction - don't add to totalCharges
      // These are tracked separately via recurringPayments
    } else if (tx.type === "income") {
      // Payments and refunds are recorded as income on the credit card
      totalPayments = totalPayments.plus(amount);
    }
    // Transfers are not included in billing cycle calculation
  }

  // Net owed = regular charges - payments (MSI handled separately)
  const netOwed = totalCharges.minus(totalPayments);

  // Calculate owedAmount from by_term payments for THIS credit card account
  // (sum of remaining balances across all by_term plans)
  let owedAmountDecimal = new Decimal(0);
  let byTermMonthlyPayment = new Decimal(0);

  const byTermPayments = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(
      and(
        eq(recurringPayments.userId, session.user.id),
        eq(recurringPayments.paymentType, "by_term"),
        eq(recurringPayments.isActive, 1)
      )
    );

  for (const payment of byTermPayments) {
    const typeSpecific = payment.typeSpecific as {
      creditAccountId?: string;
      totalAmount?: string;
      totalPayments?: number;
      firstBillDate?: Date;
      reduceCreditLimit?: boolean;
    };

    if (typeSpecific.creditAccountId === accountId && typeSpecific.totalAmount && typeSpecific.totalPayments && typeSpecific.firstBillDate) {
      const totalAmount = new Decimal(typeSpecific.totalAmount);
      const totalPayments = typeSpecific.totalPayments;
      const monthlyAmount = totalAmount.dividedBy(totalPayments);

      // Use remainingBalance if set (from bank statement), otherwise calculate it
      let paymentOwedAmount: Decimal;
      if (payment.remainingBalance !== null && payment.remainingBalance !== undefined) {
        // Use the real remaining balance from the bank statement
        paymentOwedAmount = new Decimal(payment.remainingBalance);
      } else {
        // Fallback: calculate from firstBillDate
        const firstBillDate = new Date(typeSpecific.firstBillDate);

        let pastPayments = 0;
        let currentPaymentDate = new Date(firstBillDate);

        while (currentPaymentDate <= now && pastPayments < totalPayments) {
          pastPayments++;
          currentPaymentDate = addMonths(firstBillDate, pastPayments);
        }

        const amountPaid = monthlyAmount.times(pastPayments);
        paymentOwedAmount = totalAmount.minus(amountPaid);
      }

      // Only add if there's still a balance remaining
      if (paymentOwedAmount.greaterThan(0)) {
        owedAmountDecimal = owedAmountDecimal.plus(paymentOwedAmount);
      }

      // Monthly payment is always based on original totalAmount / totalPayments
      byTermMonthlyPayment = byTermMonthlyPayment.plus(monthlyAmount);
    }
  }

  // Future charges: subscriptions with nextPaymentDate > 30 days from now
  const futureCharges: FutureCharge[] = [];
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const subscriptionPayments = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(
      and(
        eq(recurringPayments.userId, session.user.id),
        eq(recurringPayments.paymentType, "subscription"),
        eq(recurringPayments.isActive, 1)
      )
    );

  for (const payment of subscriptionPayments) {
    const typeSpecific = payment.typeSpecific as {
      creditAccountId?: string;
      price?: string;
    };

    if (typeSpecific.creditAccountId === accountId && payment.nextPaymentDate) {
      const nextDate = new Date(payment.nextPaymentDate);
      if (nextDate > thirtyDaysFromNow) {
        futureCharges.push({
          name: payment.name,
          amount: typeSpecific.price || "0",
          nextPaymentDate: nextDate,
          description: payment.description || undefined,
        });
      }
    }
  }

  return {
    accountId,
    billingDate,
    dueDate,
    cycleStart,
    cycleEnd,
    duePaymentDate,
    totalCharges: totalCharges.toString(),
    totalPayments: totalPayments.toString(),
    netOwed: netOwed.toString(),
    owedAmount: owedAmountDecimal.toString(),
    byTermMonthlyPayment: byTermMonthlyPayment.toString(),
    futureCharges,
    currency: creditCard.currency,
    accountName: creditCard.name,
  };
}

/**
 * Get billing cycle info for all credit card accounts
 */
export async function getAllCreditCardBillingCycles(): Promise<BillingCycleInfo[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Get all credit card accounts
  const creditCards = await drizzleDb
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, session.user.id),
        eq(accounts.type, "credit")
      )
    );

  const results: BillingCycleInfo[] = [];

  for (const card of creditCards) {
    const info = await getCreditCardBillingCycleInfo(card.id);
    if (info) {
      results.push(info);
    }
  }

  return results;
}
