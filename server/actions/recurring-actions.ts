"use server";

import { auth } from "@/lib/auth";
import { drizzleDb, recurringPayments, accounts, fixedIncomeAccounts, type RecurringPayment } from "@/lib/db";
import { eq, and, lte, gt } from "drizzle-orm";
import { recurringPaymentSchema } from "@/types/forms";
import { revalidatePath } from "next/cache";
import { addDays, addWeeks, addMonths, addYears, isBefore, setHours, setMinutes, setDate, getDay, getMonth, startOfMonth, getWeekOfMonth } from "date-fns";
import Decimal from "decimal.js";

type PaymentType = 'indefinite' | 'by_term' | 'subscription';
type CycleType = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

interface CycleConfig {
  type: CycleType;
  interval: number;
  daysOfWeek?: number[];
  daysOfMonth?: number[];
  monthsOfYear?: number[];
  time: string;
  perMonthDays?: Record<string, number>; // key: "YYYY-MM", value: day of month
}

interface TypeSpecificData {
  subtype?: 'transaction' | 'transfer';
  accountId?: string;
  categoryId?: string;
  subcategoryId?: string;
  tagIds?: string[];
  amount?: string;
  fromAccountId?: string;
  toAccountId?: string;
  totalAmount?: string;
  totalPayments?: number;
  firstBillDate?: Date;
  creditAccountId?: string;
  reduceCreditLimit?: boolean;
  iconUrl?: string;
  price?: string;
  billingCycle?: string;
  billingConfig?: CycleConfig;
  paymentDay?: number;
  endDate?: Date;
  // Direction for indefinite transactions
  transactionType?: 'income' | 'expense';
  // Payroll income specific
  isPayroll?: boolean;
  payrollConfig?: {
    dayOfWeek: number; // 0=Sun, 1=Mon, ..., 6=Sat
    regularAmount: string;
    fifthWeekAmount?: string;
    hasFifthWeekAdjustment: boolean;
  };
}

export async function getRecurringPayments(): Promise<RecurringPayment[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Fix any incorrect nextPaymentDate for payments with perMonthDays
  await fixNextPaymentDates();

  const payments = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(eq(recurringPayments.userId, session.user.id));

  return payments;
}

export async function getRecurringPaymentsByType(type: PaymentType): Promise<RecurringPayment[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const payments = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(
      and(
        eq(recurringPayments.userId, session.user.id),
        eq(recurringPayments.paymentType, type)
      )
    );

  return payments;
}

export async function getActiveRecurringPayments(): Promise<RecurringPayment[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const payments = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(
      and(
        eq(recurringPayments.userId, session.user.id),
        eq(recurringPayments.isActive, 1)
      )
    );

  return payments;
}

export async function createRecurringPayment(data: {
  paymentType: PaymentType;
  name: string;
  description?: string;
  cycleType: CycleType;
  cycleConfig: CycleConfig;
  startDate?: Date;
  endDate?: Date;
  typeSpecific: TypeSpecificData;
  remainingBalance?: string | number;
}): Promise<RecurringPayment> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const parsed = recurringPaymentSchema.safeParse(data);
  if (!parsed.success) {
    console.error('Zod validation error:', JSON.stringify(parsed.error.issues, null, 2));
    throw new Error(parsed.error.issues[0].message);
  }

  // Calculate next payment date based on start date and cycle config
  // For by_term, use firstBillDate from typeSpecific if available
  let nextPaymentDate: Date;
  if (data.paymentType === "by_term" && data.typeSpecific.firstBillDate) {
    const firstBillDate = new Date(data.typeSpecific.firstBillDate);
    const [hours, minutes] = data.cycleConfig.time?.split(':').map(Number) || [0, 0];
    const now = new Date();

    // If firstBillDate is in the future, that's the next payment
    if (firstBillDate > now) {
      nextPaymentDate = setHours(firstBillDate, hours);
      nextPaymentDate = setMinutes(nextPaymentDate, minutes);
    } else {
      // Calculate how many months since firstBillDate
      const monthsDiff = (now.getFullYear() - firstBillDate.getFullYear()) * 12 +
        (now.getMonth() - firstBillDate.getMonth());

      // Next payment is monthsDiff from firstBillDate (the billing day of the current/future month)
      nextPaymentDate = addMonths(firstBillDate, monthsDiff);

      // Set the day to match firstBillDate's day
      const paymentDay = firstBillDate.getDate();
      const targetDay = Math.min(paymentDay, getDaysInMonth(nextPaymentDate));
      nextPaymentDate = setDate(nextPaymentDate, targetDay);
      nextPaymentDate = setHours(nextPaymentDate, hours);
      nextPaymentDate = setMinutes(nextPaymentDate, minutes);
    }
  } else if (data.paymentType === "subscription" && data.typeSpecific.paymentDay) {
    // For subscriptions, use paymentDay (day of month 1-31)
    const [hours, minutes] = data.cycleConfig.time?.split(':').map(Number) || [0, 0];
    const now = new Date();
    const paymentDay = data.typeSpecific.paymentDay;

    // Start from current month, find the next occurrence of paymentDay
    nextPaymentDate = new Date(now.getFullYear(), now.getMonth(), paymentDay);
    nextPaymentDate = setHours(nextPaymentDate, hours);
    nextPaymentDate = setMinutes(nextPaymentDate, minutes);

    // If that date is in the past (or now), move to next month
    if (nextPaymentDate <= now) {
      nextPaymentDate = addMonths(nextPaymentDate, 1);
      const targetDay = Math.min(paymentDay, getDaysInMonth(nextPaymentDate));
      nextPaymentDate = setDate(nextPaymentDate, targetDay);
      nextPaymentDate = setHours(nextPaymentDate, hours);
      nextPaymentDate = setMinutes(nextPaymentDate, minutes);
    }
  } else {
    const startDate = data.startDate || new Date();
    nextPaymentDate = calculateNextPaymentDateFromConfig(startDate, data.cycleConfig);
  }

  const [newPayment] = await drizzleDb
    .insert(recurringPayments)
    .values({
      userId: session.user.id,
      paymentType: data.paymentType,
      name: data.name,
      description: data.description,
      cycleType: data.cycleType,
      cycleConfig: data.cycleConfig as object,
      startDate: data.startDate,
      endDate: data.endDate,
      nextPaymentDate,
      typeSpecific: data.typeSpecific as object,
      remainingBalance: data.remainingBalance !== undefined
        ? new Decimal(data.remainingBalance.toString()).toString()
        : data.paymentType === "by_term" && data.typeSpecific.totalAmount
          ? data.typeSpecific.totalAmount.toString()
          : null,
    })
    .returning();

  // If by_term with reduceCreditLimit, create past transactions
  if (data.paymentType === "by_term" && data.typeSpecific.reduceCreditLimit) {
    await createPastTransactionsForByTerm(newPayment);
  }

  revalidatePath("/recurring");
  return newPayment;
}

export async function updateRecurringPayment(
  id: string,
  data: {
    name?: string;
    description?: string;
    cycleType?: CycleType;
    cycleConfig?: CycleConfig;
    startDate?: Date;
    endDate?: Date;
    typeSpecific?: TypeSpecificData;
    isActive?: number;
    nextPaymentDate?: Date;
    remainingBalance?: string | number;
  }
): Promise<RecurringPayment> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Verify ownership
  const payment = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(
      and(
        eq(recurringPayments.id, id),
        eq(recurringPayments.userId, session.user.id)
      )
    )
    .limit(1);

  if (!payment[0]) throw new Error("Recurring payment not found");

  const [updated] = await drizzleDb
    .update(recurringPayments)
    .set({
      ...data,
      cycleConfig: data.cycleConfig ? data.cycleConfig as object : undefined,
      typeSpecific: data.typeSpecific ? data.typeSpecific as object : undefined,
      remainingBalance: data.remainingBalance !== undefined
        ? new Decimal(data.remainingBalance.toString()).toString()
        : undefined,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(recurringPayments.id, id),
        eq(recurringPayments.userId, session.user.id)
      )
    )
    .returning();

  revalidatePath("/recurring");
  return updated;
}

export async function deleteRecurringPayment(id: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Get the payment first to check if it's by_term with reduceCreditLimit
  const payment = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(
      and(
        eq(recurringPayments.id, id),
        eq(recurringPayments.userId, session.user.id)
      )
    )
    .limit(1);

  if (payment[0]) {
    const typeSpecific = payment[0].typeSpecific as TypeSpecificData;

    // If by_term with reduceCreditLimit, delete transactions and restore owedAmount
    if (payment[0].paymentType === "by_term" && typeSpecific.reduceCreditLimit) {
      await deleteByTermPaymentTransactions(id, typeSpecific);
    }
  }

  await drizzleDb
    .delete(recurringPayments)
    .where(
      and(
        eq(recurringPayments.id, id),
        eq(recurringPayments.userId, session.user.id)
      )
    );

  revalidatePath("/recurring");
}

/**
 * Delete all transactions associated with a by_term payment and restore the owedAmount.
 *
 * When a by_term payment is deleted, we:
 * 1. Delete all associated transactions
 * 2. Reset owedAmount to 0
 */
async function deleteByTermPaymentTransactions(paymentId: string, typeSpecific: TypeSpecificData): Promise<void> {
  const { transactions } = await import("@/lib/db/schema");

  if (!typeSpecific.creditAccountId) {
    return;
  }

  // Get all transactions associated with this recurring payment
  const associatedTransactions = await drizzleDb
    .select()
    .from(transactions)
    .where(eq(transactions.recurringPaymentId, paymentId));

  if (associatedTransactions.length > 0) {
    for (const tx of associatedTransactions) {
      await drizzleDb.delete(transactions).where(eq(transactions.id, tx.id));
    }
  }

  // Reset owedAmount to 0 when the by_term payment is deleted
  await drizzleDb
    .update(accounts)
    .set({ owedAmount: "0", updatedAt: new Date() })
    .where(eq(accounts.id, typeSpecific.creditAccountId!));

  revalidatePath("/accounts");
  revalidatePath("/transactions");
}

/**
 * Create past transactions for a by_term payment with reduceCreditLimit enabled.
 *
 * This creates individual transactions for tracking purposes. The billing cycle
 * excludes these transactions (via recurringPaymentId filter) to prevent double-counting.
 * The owedAmount field tracks the remaining balance for display purposes.
 */
async function createPastTransactionsForByTerm(payment: RecurringPayment): Promise<void> {
  const { transactions } = await import("@/lib/db/schema");
  const typeSpecific = payment.typeSpecific as TypeSpecificData;

  if (!typeSpecific.creditAccountId || !typeSpecific.totalAmount || !typeSpecific.totalPayments || !typeSpecific.firstBillDate) {
    return;
  }

  const monthlyAmount = new Decimal(typeSpecific.totalAmount).dividedBy(typeSpecific.totalPayments);
  const totalPayments = typeSpecific.totalPayments;
  const firstBillDate = new Date(typeSpecific.firstBillDate);
  const now = new Date();
  const [hours, minutes] = (payment.cycleConfig as CycleConfig)?.time?.split(':').map(Number) || [0, 0];

  // Calculate how many payments have already passed
  // First payment is at firstBillDate, second at firstBillDate + 1 month, etc.
  let pastPayments = 0;
  let currentPaymentDate = new Date(firstBillDate);

  // If firstBillDate is in the future, no past payments yet
  if (firstBillDate > now) {
    pastPayments = 0;
  } else {
    // Count how many payment dates have passed (including firstBillDate if it's in the past)
    while (currentPaymentDate <= now && pastPayments < totalPayments) {
      pastPayments++;
      currentPaymentDate = addMonths(firstBillDate, pastPayments);
    }
  }

  if (pastPayments <= 0) {
    return;
  }

  // Calculate owedAmount: totalAmount - (monthlyAmount * paymentsMade)
  const amountPaid = monthlyAmount.times(pastPayments);
  const owedAmount = new Decimal(typeSpecific.totalAmount).minus(amountPaid);

  const tagIdsString = typeSpecific.tagIds && typeSpecific.tagIds.length > 0
    ? typeSpecific.tagIds.join(',')
    : null;

  // Create transactions for each past payment
  // First payment is at firstBillDate (i=0), second at firstBillDate + 1 month (i=1), etc.
  for (let i = 0; i < pastPayments; i++) {
    const paymentDate = addMonths(firstBillDate, i);
    const paymentDateWithTime = setHours(setMinutes(paymentDate, minutes), hours);

    // Create the transaction
    await drizzleDb
      .insert(transactions)
      .values({
        userId: payment.userId,
        accountId: typeSpecific.creditAccountId!,
        type: "expense",
        categoryId: typeSpecific.categoryId || null,
        amount: monthlyAmount.toString(),
        description: payment.name,
        tagIds: tagIdsString,
        recurringPaymentId: payment.id,
        date: paymentDateWithTime,
      });
  }

  // Update owedAmount for display purposes (NOT creditLimit)
  // Note: These transactions are excluded from billing cycle via recurringPaymentId filter
  await drizzleDb
    .update(accounts)
    .set({ owedAmount: owedAmount.toString(), updatedAt: new Date() })
    .where(eq(accounts.id, typeSpecific.creditAccountId!));

  revalidatePath("/accounts");
  revalidatePath("/transactions");
}

/**
 * Clean up existing by_term transactions and properly set owedAmount.
 *
 * This is a ONE-TIME cleanup function to fix the old by_term implementation
 * that was creating individual transactions and reducing creditLimit.
 *
 * Call this once to:
 * 1. Delete all transactions with recurringPaymentId (old by_term transactions)
 * 2. Calculate correct owedAmount for each by_term payment
 * 3. Reset creditLimit to its original value (if it was reduced)
 */
export async function cleanupByTermPaymentTransactions(): Promise<{
  deletedTransactions: number;
  updatedAccounts: number;
}> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Re-import transactions for this cleanup function
  const { transactions } = await import("@/lib/db/schema");

  // Get all by_term payments for this user
  const byTermPayments = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(
      and(
        eq(recurringPayments.userId, session.user.id),
        eq(recurringPayments.paymentType, "by_term")
      )
    );

  let deletedCount = 0;
  let updatedCount = 0;

  // Process each by_term payment
  for (const payment of byTermPayments) {
    const typeSpecific = payment.typeSpecific as TypeSpecificData;

    if (!typeSpecific.creditAccountId || !typeSpecific.totalAmount || !typeSpecific.totalPayments || !typeSpecific.firstBillDate) {
      continue;
    }

    // Delete existing transactions for this payment
    const existingTx = await drizzleDb
      .select()
      .from(transactions)
      .where(eq(transactions.recurringPaymentId, payment.id));

    if (existingTx.length > 0) {
      for (const tx of existingTx) {
        await drizzleDb.delete(transactions).where(eq(transactions.id, tx.id));
      }
      deletedCount += existingTx.length;
    }

    // Calculate correct owedAmount
    const totalAmount = new Decimal(typeSpecific.totalAmount);
    const totalPayments = typeSpecific.totalPayments;
    const firstBillDate = new Date(typeSpecific.firstBillDate);
    const now = new Date();

    let paymentCount = 0;
    let currentPaymentDate = new Date(firstBillDate);

    while (currentPaymentDate <= now && paymentCount < totalPayments) {
      paymentCount++;
      currentPaymentDate = addMonths(firstBillDate, paymentCount);
    }

    const paymentsMade = paymentCount - 1;
    let owedAmount: Decimal;

    if (paymentsMade <= 0) {
      owedAmount = totalAmount;
    } else {
      const monthlyAmount = totalAmount.dividedBy(totalPayments);
      const amountPaid = monthlyAmount.times(paymentsMade);
      owedAmount = totalAmount.minus(amountPaid);
    }

    // Update the account with correct owedAmount
    await drizzleDb
      .update(accounts)
      .set({ owedAmount: owedAmount.toString(), updatedAt: new Date() })
      .where(eq(accounts.id, typeSpecific.creditAccountId));

    updatedCount++;
  }

  revalidatePath("/accounts");
  revalidatePath("/transactions");

  return {
    deletedTransactions: deletedCount,
    updatedAccounts: updatedCount,
  };
}

export async function toggleRecurringPayment(id: string): Promise<RecurringPayment> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const payment = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(
      and(
        eq(recurringPayments.id, id),
        eq(recurringPayments.userId, session.user.id)
      )
    )
    .limit(1);

  if (!payment[0]) throw new Error("Recurring payment not found");

  const [updated] = await drizzleDb
    .update(recurringPayments)
    .set({
      isActive: payment[0].isActive === 1 ? 0 : 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(recurringPayments.id, id),
        eq(recurringPayments.userId, session.user.id)
      )
    )
    .returning();

  revalidatePath("/recurring");
  return updated;
}

// Calculate next payment date based on cycle config
function calculateNextPaymentDateFromConfig(currentDate: Date, config: CycleConfig): Date {
  const [hours, minutes] = config.time?.split(':').map(Number) || [0, 0];
  let nextDate = new Date(currentDate);

  // Check if this payment uses perMonthDays (specific day per month)
  const hasPerMonthDays = config.perMonthDays && Object.keys(config.perMonthDays).length > 0;

  switch (config.type) {
    case 'daily':
      nextDate = addDays(nextDate, config.interval);
      break;
    case 'weekly':
      if (config.daysOfWeek && config.daysOfWeek.length > 0) {
        // If daysOfWeek is set, find the next occurrence of that day
        nextDate = findNextDayOfWeek(nextDate, config.daysOfWeek[0]);
        // If that day is today or in the past, move to next week
        if (nextDate <= currentDate) {
          nextDate = addWeeks(nextDate, config.interval);
        }
      } else {
        nextDate = addWeeks(nextDate, config.interval);
      }
      break;
    case 'monthly':
      if (hasPerMonthDays && config.perMonthDays) {
        // Find the next month in perMonthDays that is after currentDate
        nextDate = findNextPerMonthDay(currentDate, config.perMonthDays, config.interval);
      } else if (config.daysOfMonth && config.daysOfMonth.length > 0) {
        nextDate = addMonths(nextDate, config.interval);
        const targetDay = config.daysOfMonth[0];
        nextDate = setDate(nextDate, Math.min(targetDay, getDaysInMonth(nextDate)));
      } else {
        nextDate = addMonths(nextDate, config.interval);
      }
      break;
    case 'yearly':
      nextDate = addYears(nextDate, config.interval);
      break;
    case 'custom':
      // For custom, use monthly as base with interval
      if (config.daysOfMonth && config.daysOfMonth.length > 0) {
        nextDate = addMonths(nextDate, config.interval);
        const targetDay = config.daysOfMonth[0];
        nextDate = setDate(nextDate, Math.min(targetDay, getDaysInMonth(nextDate)));
      } else if (config.daysOfWeek && config.daysOfWeek.length > 0) {
        nextDate = addWeeks(nextDate, config.interval);
        nextDate = findNextDayOfWeek(nextDate, config.daysOfWeek[0]);
      } else {
        nextDate = addMonths(nextDate, config.interval);
      }
      break;
  }

  // Set the time
  nextDate = setHours(nextDate, hours);
  nextDate = setMinutes(nextDate, minutes);

  return nextDate;
}

// Find the next payment date when using perMonthDays
function findNextPerMonthDay(currentDate: Date, perMonthDays: Record<string, number>, interval: number): Date {
  const currentMonth = currentDate.getMonth(); // 0-indexed
  const currentYear = currentDate.getFullYear();

  // Get all perMonthDays keys sorted chronologically
  const sortedKeys = Object.keys(perMonthDays).sort();

  if (sortedKeys.length === 0) {
    return addMonths(currentDate, interval);
  }

  // Try to find the next occurrence after currentDate
  for (const key of sortedKeys) {
    const [year, monthStr] = key.split('-');
    const yearNum = parseInt(year);
    const monthNum = parseInt(monthStr); // 1-indexed

    // Check if this month is after (or same as) currentDate considering interval
    // If interval is 1, we just need any month on or after current
    // If interval is 3, we need months that are interval-aligned

    const nextDateForKey = new Date(yearNum, monthNum - 1, perMonthDays[key]);

    if (nextDateForKey > currentDate) {
      // Verify this month aligns with the interval
      // Calculate months from start of current month to this month
      const monthsDiff = (yearNum - currentYear) * 12 + (monthNum - 1 - currentMonth);
      if (monthsDiff >= 0 && monthsDiff % interval === 0) {
        return nextDateForKey;
      }
    }
  }

  // If no future date found, cycle back to the first perMonthDays entry
  // and add years as needed
  const firstKey = sortedKeys[0];
  const [firstYear, firstMonthStr] = firstKey.split('-');
  const firstYearNum = parseInt(firstYear);
  const firstMonthNum = parseInt(firstMonthStr);

  // Find how many years to add to make the first key's month come after current
  let yearsToAdd = 0;
  if (firstYearNum < currentYear || (firstYearNum === currentYear && firstMonthNum <= currentMonth + 1)) {
    yearsToAdd = Math.ceil((currentYear - firstYearNum) / interval || 1);
    if (firstMonthNum > (currentMonth + 1) % 12) {
      yearsToAdd--;
    }
    yearsToAdd = Math.max(1, yearsToAdd);
  }

  return new Date(firstYearNum + yearsToAdd, firstMonthNum - 1, perMonthDays[firstKey]);
}

function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function findNextDayOfWeek(date: Date, dayOfWeek: number): Date {
  const current = new Date(date);
  const currentDay = getDay(current);
  const daysUntilTarget = (dayOfWeek - currentDay + 7) % 7;
  if (daysUntilTarget === 0) return current;
  return addDays(current, daysUntilTarget);
}

/**
 * Check if a given date is a 5th week occurrence of its day of week in the month.
 * For payroll purposes: if a month has 5 Thursdays (for example), the last one is the 5th week.
 */
function isFifthWeekOfMonth(date: Date, dayOfWeek: number): boolean {
  const year = date.getFullYear();
  const month = date.getMonth();
  const dayOfMonth = date.getDate();

  // Find the first occurrence of dayOfWeek in this month
  const firstDayOfMonth = new Date(year, month, 1);
  const firstDayOfMonthDayOfWeek = getDay(firstDayOfMonth);
  const daysUntilFirstOccurrence = (dayOfWeek - firstDayOfMonthDayOfWeek + 7) % 7;
  const firstOccurrence = new Date(year, month, daysUntilFirstOccurrence + 1);

  // Check if there is a 5th occurrence this month
  // If adding 28 days to first occurrence stays in the same month, there's a 5th week
  const potential5th = addDays(firstOccurrence, 28);
  if (potential5th.getMonth() !== month) {
    // This month has only 4 occurrences, so no 5th week
    return false;
  }

  // This month has a 5th occurrence. Check if the given date is that last (5th) occurrence.
  // Count occurrences up to and including the given date
  let count = 0;
  let current = new Date(firstOccurrence);
  while (current <= date) {
    if (getDay(current) === dayOfWeek) {
      count++;
    }
    current = addDays(current, 1);
  }

  // If this is the 5th occurrence, it's the 5th week
  return count === 5;
}

/**
 * Get the week number within the month (1-5) for a given date
 */
function getWeekNumberInMonth(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth();
  const dayOfWeek = getDay(date);

  const firstDayOfMonth = new Date(year, month, 1);
  const firstDayOfMonthDayOfWeek = getDay(firstDayOfMonth);

  const daysUntilFirstOccurrence = (dayOfWeek - firstDayOfMonthDayOfWeek + 7) % 7;
  const firstOccurrence = daysUntilFirstOccurrence + 1;

  return Math.ceil(firstOccurrence / 7);
}

/**
 * Calculate the correct payment amount for a payroll payment based on whether it's a 5th week
 */
function getPayrollAmount(payrollConfig: TypeSpecificData['payrollConfig']): string {
  if (!payrollConfig) return "0";

  const { regularAmount, fifthWeekAmount, hasFifthWeekAdjustment } = payrollConfig;

  if (hasFifthWeekAdjustment && fifthWeekAmount) {
    return fifthWeekAmount;
  }

  return regularAmount || "0";
}

// Get the next payment date for a specific occurrence
export async function getNextPaymentDateForOccurrence(payment: RecurringPayment): Promise<Date> {
  const config = payment.cycleConfig as CycleConfig;
  const typeSpecific = payment.typeSpecific as TypeSpecificData;
  const now = new Date();

  // For by_term payments, calculate based on firstBillDate
  if (payment.paymentType === "by_term" && typeSpecific.firstBillDate) {
    const firstBillDate = new Date(typeSpecific.firstBillDate);
    const [hours, minutes] = config.time?.split(':').map(Number) || [0, 0];

    // Start from firstBillDate and find the next occurrence after now
    let nextDate = new Date(firstBillDate);

    // If firstBillDate is in the future, that's the next payment
    if (nextDate > now) {
      nextDate = setHours(nextDate, hours);
      nextDate = setMinutes(nextDate, minutes);
      return nextDate;
    }

    // Otherwise, calculate how many months since firstBillDate
    const monthsDiff = (now.getFullYear() - firstBillDate.getFullYear()) * 12 +
      (now.getMonth() - firstBillDate.getMonth());

    // Start from firstBillDate and add monthsDiff to get the current/future billing month
    nextDate = addMonths(firstBillDate, monthsDiff);

    // If we're past the payment day this month, nextDate is already correct
    // If not, go back one month and forward
    const paymentDay = firstBillDate.getDate();
    const targetDay = Math.min(paymentDay, getDaysInMonth(nextDate));
    nextDate = setDate(nextDate, targetDay);

    // Set time
    nextDate = setHours(nextDate, hours);
    nextDate = setMinutes(nextDate, minutes);

    // If this is still before now, add one more month
    if (nextDate <= now) {
      nextDate = addMonths(nextDate, 1);
      const newTargetDay = Math.min(paymentDay, getDaysInMonth(nextDate));
      nextDate = setDate(nextDate, newTargetDay);
      nextDate = setHours(nextDate, hours);
      nextDate = setMinutes(nextDate, minutes);
    }

    // Check if we've exceeded the total number of payments
    const totalPayments = typeSpecific.totalPayments || 0;
    if (totalPayments > 0) {
      const paymentNumber = getMonthDifference(firstBillDate, nextDate);
      if (paymentNumber >= totalPayments) {
        // Cycle is complete - no more payments
        return new Date(0); // Returns epoch (1970) to signal "no more payments"
      }
    }

    return nextDate;
  }

  // For other payment types, use the config
  return calculateNextPaymentDateFromConfig(now, config);
}

// Process all due recurring payments (called by cron)
export async function processRecurringPayments(): Promise<{ processed: number; results: Array<{ id: string; success: boolean; error?: string }> }> {
  const session = await auth();
  // For cron, we might use a different auth or skip auth
  if (!session?.user?.id) {
    // Allow cron job to proceed - in production, use a service token
  }

  const now = new Date();

  const duePayments = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(
      and(
        eq(recurringPayments.isActive, 1),
        lte(recurringPayments.nextPaymentDate, now),
        // Exclude payments with epoch (1970) as nextPaymentDate - these have completed their cycle
        gt(recurringPayments.nextPaymentDate, new Date("2000-01-01"))
      )
    );

  const results: Array<{ id: string; success: boolean; error?: string }> = [];
  let processed = 0;

  for (const payment of duePayments) {
    try {
      const typeSpecific = payment.typeSpecific as TypeSpecificData;
      let updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      // For by_term payments, create a transaction and reduce remainingBalance
      if (payment.paymentType === "by_term" && typeSpecific.creditAccountId) {
        const totalAmount = new Decimal(typeSpecific.totalAmount || "0");
        const totalPayments = typeSpecific.totalPayments || 1;
        const monthlyAmount = totalAmount.dividedBy(totalPayments);

        // Create the expense transaction for this payment
        const { transactions } = await import("@/lib/db/schema");
        if (payment.nextPaymentDate) {
          await drizzleDb.insert(transactions).values({
            userId: payment.userId,
            accountId: typeSpecific.creditAccountId,
            type: "expense",
            categoryId: typeSpecific.categoryId || null,
            amount: monthlyAmount.toString(),
            description: payment.name,
            recurringPaymentId: payment.id,
            date: payment.nextPaymentDate,
          });
        }

        // Reduce remainingBalance by monthlyAmount
        if (payment.remainingBalance) {
          const currentBalance = new Decimal(payment.remainingBalance);
          const newBalance = currentBalance.minus(monthlyAmount);

          if (newBalance.lessThanOrEqualTo(0)) {
            // All payments done - deactivate and set remainingBalance to 0
            updateData.remainingBalance = "0";
            updateData.isActive = 0;
          } else {
            updateData.remainingBalance = newBalance.toString();
          }
        }

        // Calculate next payment date
        const nextDate = await getNextPaymentDateForOccurrence(payment);
        updateData.nextPaymentDate = nextDate;

        // If nextDate is epoch (1970), the payment cycle is complete - deactivate
        if (nextDate.getTime() === 0) {
          updateData.isActive = 0;
        }
      } else if (typeSpecific.isPayroll && payment.nextPaymentDate) {
        // For payroll payments, create an income transaction with the appropriate amount
        const payrollConfig = typeSpecific.payrollConfig;
        if (payrollConfig && typeSpecific.accountId) {
          const { transactions } = await import("@/lib/db/schema");

          // Determine the correct amount based on whether it's a 5th week
          let amount: string;
          if (payrollConfig.hasFifthWeekAdjustment) {
            // Check if this payment date is a 5th week
            const isFifth = isFifthWeekOfMonth(payment.nextPaymentDate, payrollConfig.dayOfWeek);
            amount = isFifth ? (payrollConfig.fifthWeekAmount || payrollConfig.regularAmount || "0") : (payrollConfig.regularAmount || "0");
          } else {
            amount = payrollConfig.regularAmount || "0";
          }

          // Create an income transaction
          await drizzleDb.insert(transactions).values({
            userId: payment.userId,
            accountId: typeSpecific.accountId,
            type: "income",
            categoryId: typeSpecific.categoryId || null,
            amount: amount,
            description: payment.name,
            recurringPaymentId: payment.id,
            date: payment.nextPaymentDate,
          });

          // Update the account balance
          const [account] = await drizzleDb
            .select()
            .from(accounts)
            .where(eq(accounts.id, typeSpecific.accountId))
            .limit(1);

          if (account) {
            const newBalance = new Decimal(account.balance).plus(amount).toString();
            await drizzleDb
              .update(accounts)
              .set({ balance: newBalance, updatedAt: new Date() })
              .where(eq(accounts.id, typeSpecific.accountId));

            // Also update the originalPrincipal of the linked fixed income account
            const [fiAccount] = await drizzleDb
              .select()
              .from(fixedIncomeAccounts)
              .where(eq(fixedIncomeAccounts.linkedAccountId, typeSpecific.accountId))
              .limit(1);

            if (fiAccount) {
              await drizzleDb
                .update(fixedIncomeAccounts)
                .set({ originalPrincipal: newBalance, updatedAt: new Date() })
                .where(eq(fixedIncomeAccounts.id, fiAccount.id));
            }
          }
        }

        // Calculate next payment date
        const nextDate = await getNextPaymentDateForOccurrence(payment);
        updateData.nextPaymentDate = nextDate;
      } else if (payment.paymentType === "subscription" && typeSpecific.accountId && payment.nextPaymentDate) {
        // Create an expense transaction for subscriptions
        const { transactions } = await import("@/lib/db/schema");
        await drizzleDb.insert(transactions).values({
          userId: payment.userId,
          accountId: typeSpecific.accountId,
          type: "expense",
          categoryId: typeSpecific.categoryId || null,
          amount: typeSpecific.price || "0",
          description: payment.name,
          recurringPaymentId: payment.id,
          date: payment.nextPaymentDate,
        });

        const nextDate = await getNextPaymentDateForOccurrence(payment);
        updateData.nextPaymentDate = nextDate;
      } else {
        // For other non-by_term payments, just update next payment date
        const nextDate = await getNextPaymentDateForOccurrence(payment);
        updateData.nextPaymentDate = nextDate;
      }

      await drizzleDb
        .update(recurringPayments)
        .set(updateData)
        .where(eq(recurringPayments.id, payment.id));

      results.push({ id: payment.id, success: true });
      processed++;
    } catch (error) {
      results.push({
        id: payment.id,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  return { processed, results };
}

// Recalculate and fix incorrect nextPaymentDate for all active payments
export async function fixNextPaymentDates(): Promise<{ corrected: number }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const payments = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(eq(recurringPayments.userId, session.user.id));

  const now = new Date();
  let corrected = 0;

  for (const payment of payments) {
    if (payment.isActive !== 1) continue;

    const config = payment.cycleConfig as CycleConfig;
    const typeSpecific = payment.typeSpecific as TypeSpecificData;
    const hasPerMonthDays = config.perMonthDays && Object.keys(config.perMonthDays).length > 0;

    // For by_term, use firstBillDate to calculate correct next payment
    if (payment.paymentType === "by_term" && typeSpecific.firstBillDate) {
      const correctNextDate = await getNextPaymentDateForOccurrence(payment);

      if (payment.nextPaymentDate) {
        const storedDate = new Date(payment.nextPaymentDate);
        if (storedDate < now || Math.abs(storedDate.getTime() - correctNextDate.getTime()) > 86400000) {
          await drizzleDb
            .update(recurringPayments)
            .set({
              nextPaymentDate: correctNextDate,
              updatedAt: new Date(),
            })
            .where(eq(recurringPayments.id, payment.id));
          corrected++;
        }
      }
    } else if (hasPerMonthDays) {
      // Check if the stored nextPaymentDate is actually valid for the perMonthDays config
      const correctNextDate = calculateNextPaymentDateFromConfig(now, config);

      if (payment.nextPaymentDate) {
        const storedDate = new Date(payment.nextPaymentDate);
        // If stored date is wrong (before now or doesn't match perMonthDays), fix it
        const monthKey = `${storedDate.getFullYear()}-${String(storedDate.getMonth() + 1).padStart(2, '0')}`;
        const hasStoredMonth = config.perMonthDays && config.perMonthDays[monthKey] !== undefined;
        const storedDay = (hasStoredMonth && config.perMonthDays) ? config.perMonthDays[monthKey] : null;
        const correctMonthKey = `${correctNextDate.getFullYear()}-${String(correctNextDate.getMonth() + 1).padStart(2, '0')}`;
        const correctHasMonth = config.perMonthDays && config.perMonthDays[correctMonthKey] !== undefined;

        // Fix if: stored is in past, OR stored month not in perMonthDays, OR stored day doesn't match perMonthDays
        if (storedDate < now || !hasStoredMonth || (storedDay !== null && storedDay !== storedDate.getDate())) {
          await drizzleDb
            .update(recurringPayments)
            .set({
              nextPaymentDate: correctNextDate,
              updatedAt: new Date(),
            })
            .where(eq(recurringPayments.id, payment.id));
          corrected++;
        }
      }
    }
  }

  return { corrected };
}

// ============================================================
// PROJECTIONS - Cash Flow based on recurring payments
// ============================================================

export interface CashFlowProjection {
  periodLabel: string;       // e.g., "Aug 2026"
  periodKey: string;         // e.g., "2026-08"
  projectedIncome: number;
  projectedExpenses: number;
  netCashFlow: number;
  incomeDetails: Array<{ name: string; amount: number; date: string }>;
  expenseDetails: Array<{ name: string; amount: number; date: string }>;
  // Enriched breakdowns
  incomeBreakdown: IncomeBreakdown[];
  expenseBreakdown: ExpenseBreakdown[];
}

export interface IncomeBreakdown {
  type: 'payroll' | 'other';
  label: string;
  items: Array<{
    name: string;
    accountName?: string;
    amount: number;
    date: string;
  }>;
  total: number;
}

export interface ExpenseBreakdown {
  creditAccountId: string;
  creditAccountName: string;
  billingDate: number; // day of month (corte)
  items: Array<{
    name: string;
    amount: number;
    date: string;
    paymentNumber?: number;
    totalPayments?: number;
  }>;
  total: number;
}

export interface OtherExpenseItem {
  name: string;
  amount: number;
  date: string;
}

/**
 * Project cash flow for a date range based on recurring payments.
 *
 * - by_term: Only counts payments within firstBillDate + totalPayments range
 * - subscription: Projects every period while active
 * - indefinite: Projects based on cycleConfig and endDate
 */
export async function projectRecurringCashFlow(
  monthsAhead: number = 6,
  startDate?: Date,
  endDate?: Date
): Promise<CashFlowProjection[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const now = new Date();
  const projections: CashFlowProjection[] = [];

  // Determine the range to project
  const rangeStart = startDate ? startOfMonth(startDate) : startOfMonth(now);
  const rangeEnd = endDate ? startOfMonth(endDate) : addMonths(startOfMonth(now), monthsAhead);

  // Get all active recurring payments
  const payments = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(
      and(
        eq(recurringPayments.userId, session.user.id),
        eq(recurringPayments.isActive, 1)
      )
    );

  // Fetch all accounts once for name/billing date lookups
  const allAccounts = await drizzleDb
    .select({
      id: accounts.id,
      name: accounts.name,
      billingDate: accounts.billingDate,
      type: accounts.type,
    })
    .from(accounts)
    .where(eq(accounts.userId, session.user.id));

  const accountMap = new Map(
    allAccounts.map(a => [a.id, { name: a.name, billingDate: a.billingDate, type: a.type }])
  );

  // Generate projections for each month in the range
  let current = new Date(rangeStart);
  while (current <= rangeEnd) {
    const targetMonth = startOfMonth(current);
    const year = targetMonth.getFullYear();
    const month = targetMonth.getMonth(); // 0-indexed
    const periodKey = `${year}-${String(month + 1).padStart(2, '0')}`;
    const periodLabel = targetMonth.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

    let projectedIncome = 0;
    let projectedExpenses = 0;
    const incomeDetails: CashFlowProjection['incomeDetails'] = [];
    const expenseDetails: CashFlowProjection['expenseDetails'] = [];

    // Breakdown tracking
    const payrollItems: IncomeBreakdown['items'] = [];
    const otherIncomeItems: IncomeBreakdown['items'] = [];
    const creditCardExpenses: ExpenseBreakdown[] = [];
    const otherExpenseItems: OtherExpenseItem[] = [];

    for (const payment of payments) {
      const typeSpecific = payment.typeSpecific as TypeSpecificData;

      if (payment.paymentType === 'by_term') {
        // by_term: Only include if payment falls within firstBillDate + totalPayments
        const firstBillDate = typeSpecific.firstBillDate ? new Date(typeSpecific.firstBillDate) : null;
        const totalPayments = typeSpecific.totalPayments || 0;

        if (!firstBillDate || totalPayments <= 0) continue;

        // Calculate which payment number this would be (0-indexed)
        // Payment 0 = firstBillDate, Payment 1 = firstBillDate + 1 month, etc.
        const paymentNumber = getMonthDifference(firstBillDate, targetMonth);

        if (paymentNumber < 0 || paymentNumber >= totalPayments) {
          continue; // Outside the payment term range
        }

        // Monthly payment amount
        const totalAmount = parseFloat(typeSpecific.totalAmount || '0');
        const monthlyAmount = totalAmount / totalPayments;
        const paymentDate = addMonths(firstBillDate, paymentNumber);

        // Only count if same month
        if (paymentDate.getMonth() === month && paymentDate.getFullYear() === year) {
          projectedExpenses += monthlyAmount;
          expenseDetails.push({
            name: payment.name,
            amount: monthlyAmount,
            date: paymentDate.toISOString().split('T')[0],
          });

          // Add to credit card breakdown
          const creditAccountId = typeSpecific.creditAccountId || '';
          const creditAccount = creditAccountId ? accountMap.get(creditAccountId) : null;
          const billingDate = firstBillDate.getDate();

          creditCardExpenses.push({
            creditAccountId: creditAccountId || 'unknown',
            creditAccountName: creditAccount?.name || 'Unknown Card',
            billingDate,
            items: [{
              name: payment.name,
              amount: monthlyAmount,
              date: paymentDate.toISOString().split('T')[0],
              paymentNumber: paymentNumber + 1,
              totalPayments,
            }],
            total: monthlyAmount,
          });
        }

      } else if (payment.paymentType === 'subscription') {
        // subscription: Projects every period based on paymentDay, but only if the subscription has started
        const price = parseFloat(typeSpecific.price || '0');
        const paymentDay = typeSpecific.paymentDay || 1;

        // Skip if next_payment_date is in the future relative to the target month
        if (payment.nextPaymentDate) {
          const nextPd = new Date(payment.nextPaymentDate);
          const nextPdMonth = startOfMonth(nextPd);
          if (nextPdMonth > targetMonth) {
            continue; // Subscription hasn't started yet for this target month
          }
        }

        // Create a date for this month on the payment day
        const paymentDate = new Date(year, month, Math.min(paymentDay, getDaysInMonth(targetMonth)));

        if (paymentDay > 0) {
          projectedExpenses += price;
          expenseDetails.push({
            name: payment.name,
            amount: price,
            date: paymentDate.toISOString().split('T')[0],
          });

          // Add to credit card breakdown
          const creditAccountId = typeSpecific.accountId || '';
          const creditAccount = creditAccountId ? accountMap.get(creditAccountId) : null;
          const billingDate = typeSpecific.paymentDay || 1;

          creditCardExpenses.push({
            creditAccountId: creditAccountId || 'unknown',
            creditAccountName: creditAccount?.name || 'Unknown Card',
            billingDate,
            items: [{
              name: payment.name,
              amount: price,
              date: paymentDate.toISOString().split('T')[0],
            }],
            total: price,
          });
        }

      } else if (payment.paymentType === 'indefinite') {
        // indefinite: Check if there's a payment this month based on cycleConfig
        const paymentOccurrences = getIndefinitePaymentOccurrences(payment, targetMonth, now);

        for (const occurrence of paymentOccurrences) {
          // Determine direction: isPayroll = income, transactionType = income/expense
          let amount = 0;
          let direction: 'income' | 'expense' = 'expense';

          if (typeSpecific.isPayroll) {
            // Payroll: use payrollConfig amounts
            direction = 'income';
            const payrollConfig = typeSpecific.payrollConfig;
            if (payrollConfig) {
              // Check if 5th week adjustment applies
              const occurrenceDate = new Date(occurrence.date);
              if (payrollConfig.hasFifthWeekAdjustment && isFifthWeekOfMonth(occurrenceDate, payrollConfig.dayOfWeek)) {
                amount = parseFloat(payrollConfig.fifthWeekAmount || '0');
              } else {
                amount = parseFloat(payrollConfig.regularAmount || '0');
              }
            }
          } else {
            amount = parseFloat(typeSpecific.amount || '0');
            direction = typeSpecific.transactionType === 'income' ? 'income' : 'expense';
          }

          if (amount > 0) {
            const accountId = typeSpecific.accountId || '';
            const account = accountId ? accountMap.get(accountId) : null;

            if (direction === 'income') {
              projectedIncome += amount;
              incomeDetails.push({ name: payment.name, amount, date: occurrence.date });

              // Add to income breakdown
              if (typeSpecific.isPayroll) {
                payrollItems.push({
                  name: payment.name,
                  accountName: account?.name,
                  amount,
                  date: occurrence.date,
                });
              } else {
                otherIncomeItems.push({
                  name: payment.name,
                  accountName: account?.name,
                  amount,
                  date: occurrence.date,
                });
              }
            } else {
              projectedExpenses += amount;
              expenseDetails.push({ name: payment.name, amount, date: occurrence.date });

              // Add to other expenses (non-credit card)
              otherExpenseItems.push({
                name: payment.name,
                amount,
                date: occurrence.date,
              });
            }
          }
        }
      }
    }

    // Aggregate breakdowns
    const aggregatedExpenses = aggregateExpensesByCreditCard(creditCardExpenses);
    const incomeBreakdown: IncomeBreakdown[] = [];

    if (payrollItems.length > 0) {
      incomeBreakdown.push({
        type: 'payroll',
        label: 'Payroll',
        items: payrollItems,
        total: payrollItems.reduce((sum, item) => sum + item.amount, 0),
      });
    }
    if (otherIncomeItems.length > 0) {
      incomeBreakdown.push({
        type: 'other',
        label: 'Other Income',
        items: otherIncomeItems,
        total: otherIncomeItems.reduce((sum, item) => sum + item.amount, 0),
      });
    }

    projections.push({
      periodLabel,
      periodKey,
      projectedIncome,
      projectedExpenses,
      netCashFlow: projectedIncome - projectedExpenses,
      incomeDetails,
      expenseDetails,
      incomeBreakdown,
      expenseBreakdown: aggregatedExpenses,
    });

    current = addMonths(current, 1);
  }

  return projections;
}

/**
 * Get all occurrences of an indefinite payment in a given month
 */
function getIndefinitePaymentOccurrences(
  payment: RecurringPayment,
  targetMonth: Date,
  now: Date
): Array<{ date: string }> {
  const config = payment.cycleConfig as CycleConfig;
  const occurrences: Array<{ date: string }> = [];

  // Check endDate - if past targetMonth, skip
  if (payment.endDate) {
    const endDate = new Date(payment.endDate);
    if (endDate < targetMonth) return []; // Payment has ended
  }

  const year = targetMonth.getFullYear();
  const month = targetMonth.getMonth();
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  // Check perMonthDays first - explicit dates per month
  if (config.perMonthDays && Object.keys(config.perMonthDays).length > 0) {
    const dayOfMonth = config.perMonthDays[monthStr];
    if (dayOfMonth) {
      const date = new Date(year, month, dayOfMonth);
      const dateStr = date.toISOString().split('T')[0];
      // Make sure date is not in the past
      if (date >= now || isSameMonth(date, now)) {
        occurrences.push({ date: dateStr });
      }
    }
    return occurrences;
  }

  // Check daysOfMonth (fixed day each month)
  if (config.daysOfMonth && config.daysOfMonth.length > 0) {
    for (const day of config.daysOfMonth) {
      const date = new Date(year, month, day);
      if (date >= now || isSameMonth(date, now)) {
        occurrences.push({ date: date.toISOString().split('T')[0] });
      }
    }
    return occurrences;
  }

  // Check daysOfWeek (weekly payments)
  if (config.daysOfWeek && config.daysOfWeek.length > 0 && config.type === 'weekly') {
    const interval = config.interval || 1;
    // Find all occurrences of the day(s) of week in the target month
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    for (let d = new Date(firstDayOfMonth); d <= lastDayOfMonth; d.setDate(d.getDate() + 1)) {
      if (config.daysOfWeek.includes(d.getDay())) {
        if (d >= now || isSameMonth(d, now)) {
          occurrences.push({ date: d.toISOString().split('T')[0] });
        }
      }
    }
    // Filter to interval weeks
    if (interval > 1 && occurrences.length > 0) {
      const filtered = occurrences.filter((_, idx) => idx % interval === 0);
      return filtered;
    }
    return occurrences;
  }

  return occurrences;
}

/**
 * Get month difference between two dates (0-indexed)
 */
function getMonthDifference(startDate: Date, endDate: Date): number {
  return (endDate.getFullYear() - startDate.getFullYear()) * 12 +
         (endDate.getMonth() - startDate.getMonth());
}

/**
 * Check if two dates are in the same month
 */
function isSameMonth(date1: Date, date2: Date): boolean {
  return date1.getFullYear() === date2.getFullYear() &&
         date1.getMonth() === date2.getMonth();
}

/**
 * Aggregate expense items by credit card account
 */
function aggregateExpensesByCreditCard(expenses: ExpenseBreakdown[]): ExpenseBreakdown[] {
  const map = new Map<string, ExpenseBreakdown>();

  for (const expense of expenses) {
    const key = expense.creditAccountId;
    if (!map.has(key)) {
      map.set(key, {
        creditAccountId: expense.creditAccountId,
        creditAccountName: expense.creditAccountName,
        billingDate: expense.billingDate,
        items: [],
        total: 0,
      });
    }
    const existing = map.get(key)!;
    existing.items.push(...expense.items);
    existing.total += expense.total;
  }

  return Array.from(map.values());
}
