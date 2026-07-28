"use server";

import { auth } from "@/lib/auth";
import { drizzleDb, accounts, transactions, type Transaction, type Account } from "@/lib/db";
import { eq, and, gte, lte, or } from "drizzle-orm";
import { recurringPayments } from "@/lib/db/schema";
import Decimal from "decimal.js";

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
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth(); // 0-indexed

  // Cycle end: billing date of current month (or today if before billing date)
  const cycleEnd = new Date(currentYear, currentMonth, Math.min(billingDate, today.getDate()));
  // If today is before the billing date, we're still in the previous cycle
  if (today.getDate() < billingDate) {
    cycleEnd.setMonth(cycleEnd.getMonth() - 1);
  }

  // Cycle start: billing date of previous month
  const cycleStart = new Date(cycleEnd);
  cycleStart.setMonth(cycleStart.getMonth() - 1);

  // Due payment date: due date of next month (after the cycle ends)
  const duePaymentDate = new Date(cycleEnd.getFullYear(), cycleEnd.getMonth() + 1, dueDate);

  // Get all transactions in this billing cycle
  // EXCLUDE transactions that have recurringPaymentId - these are from by_term payments
  // which track their balance via owedAmount, not via individual transactions
  const allCycleTransactions = await drizzleDb
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

  // Filter out by_term transactions (those with recurringPaymentId set)
  const cycleTransactions = allCycleTransactions.filter(tx => !tx.recurringPaymentId);

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

  // Net owed = charges - payments (ONLY regular transactions)
  // Note: by_term payments track via owedAmount, NOT via billing cycle transactions
  // owedAmount is shown separately in the UI, not added to netOwed
  const owedAmountDecimal = new Decimal(creditCard.owedAmount || "0");
  const netOwed = totalCharges.minus(totalPayments);

  // Get the monthly by_term payment from active recurring payments for this account
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
    const typeSpecific = payment.typeSpecific as { creditAccountId?: string; totalAmount?: string; totalPayments?: number };
    if (typeSpecific.creditAccountId === accountId && typeSpecific.totalAmount && typeSpecific.totalPayments) {
      byTermMonthlyPayment = new Decimal(typeSpecific.totalAmount).dividedBy(typeSpecific.totalPayments);
      break; // Use the first active by_term payment for this account
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
