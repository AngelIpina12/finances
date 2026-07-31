"use server";

import { auth } from "@/lib/auth";
import { drizzleDb, accounts, transactions, type Transaction, type Account } from "@/lib/db";
import { eq, and, gte, lte, or } from "drizzle-orm";
import { recurringPayments } from "@/lib/db/schema";
import Decimal from "decimal.js";
import { addMonths } from "date-fns";

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
  currency: string;
  accountName: string;
}

/**
 * Calculate the billing cycle balance for a credit card account.
 *
 * The billing cycle runs from billingDate of the previous month to billingDate of the current month.
 * For example, if billingDate is 14:
 * - Current cycle: June 14 to July 14
 * - Payment due: August 2 (or similar, based on dueDate)
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

  if (!account[0] || !account[0].billingDate || !account[0].dueDate) {
    return null;
  }

  const creditCard = account[0];
  const billingDate = creditCard.billingDate as number;
  const dueDate = creditCard.dueDate as number;

  // Calculate billing cycle dates
  // Billing cycle goes from billingDate (e.g., 15th) to billingDate - 1 (e.g., 14th) of the next month
  // We always show the LAST CLOSED cycle (not the current open one)
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();

  let cycleStart: Date;
  let cycleEnd: Date;

  // If today is before the billing date, we're still in the previous cycle
  if (today.getDate() < billingDate) {
    // We're before this month's billing date, so last closed cycle is 2 months ago
    cycleStart = new Date(currentYear, currentMonth - 2, billingDate);
    cycleEnd = new Date(currentYear, currentMonth - 1, billingDate - 1);
  } else {
    // We're after this month's billing date, so last closed cycle is last month
    cycleStart = new Date(currentYear, currentMonth - 1, billingDate);
    cycleEnd = new Date(currentYear, currentMonth, billingDate - 1);
  }

  // Due payment date: due date of the month after the cycle ends
  const duePaymentDate = new Date(cycleEnd.getFullYear(), cycleEnd.getMonth() + 1, dueDate);

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
  let totalCharges = new Decimal(0);
  let totalPayments = new Decimal(0);

  for (const tx of cycleTransactions) {
    const amount = new Decimal(tx.amount);
    if (tx.type === "expense") {
      totalCharges = totalCharges.plus(amount);
    } else if (tx.type === "income") {
      // Payments and refunds are recorded as income on the credit card
      totalPayments = totalPayments.plus(amount);
    }
    // Transfers are not included in billing cycle calculation
  }

  // Net owed = charges - payments (including by_term/MSI transactions)
  const netOwed = totalCharges.minus(totalPayments);

  // Calculate owedAmount from ALL by_term payments for this account
  // (sum of remaining balances across all by_term plans)
  let owedAmountDecimal = new Decimal(0);
  let byTermMonthlyPayment = new Decimal(0);
  const now = new Date();

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
      const firstBillDate = new Date(typeSpecific.firstBillDate);

      // Count how many payments have been made (including firstBillDate if in the past)
      let pastPayments = 0;
      let currentPaymentDate = new Date(firstBillDate);

      while (currentPaymentDate <= now && pastPayments < totalPayments) {
        pastPayments++;
        currentPaymentDate = addMonths(firstBillDate, pastPayments);
      }

      // Calculate remaining owed amount for this payment plan
      const amountPaid = monthlyAmount.times(pastPayments);
      const paymentOwedAmount = totalAmount.minus(amountPaid);

      // Only add if there's still a balance remaining
      if (paymentOwedAmount.greaterThan(0)) {
        owedAmountDecimal = owedAmountDecimal.plus(paymentOwedAmount);
      }

      // Add to monthly payment total
      byTermMonthlyPayment = byTermMonthlyPayment.plus(monthlyAmount);
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
