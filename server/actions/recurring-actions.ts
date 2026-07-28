"use server";

import { auth } from "@/lib/auth";
import { drizzleDb, recurringPayments, accounts, type RecurringPayment } from "@/lib/db";
import { eq, and, lte } from "drizzle-orm";
import { recurringPaymentSchema } from "@/types/forms";
import { revalidatePath } from "next/cache";
import { addDays, addWeeks, addMonths, addYears, isBefore, setHours, setMinutes, setDate, getDay, getMonth } from "date-fns";
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
    const [hours, minutes] = data.cycleConfig.time.split(':').map(Number);
    const now = new Date();

    // If firstBillDate is in the future, that's the next payment
    if (firstBillDate > now) {
      nextPaymentDate = setHours(firstBillDate, hours);
      nextPaymentDate = setMinutes(nextPaymentDate, minutes);
    } else {
      // Calculate how many months since firstBillDate
      const monthsDiff = (now.getFullYear() - firstBillDate.getFullYear()) * 12 +
        (now.getMonth() - firstBillDate.getMonth());

      // Next payment is monthsDiff + 1 from firstBillDate
      nextPaymentDate = addMonths(firstBillDate, monthsDiff + 1);

      // Set the day to match firstBillDate's day
      const paymentDay = firstBillDate.getDate();
      const targetDay = Math.min(paymentDay, getDaysInMonth(nextPaymentDate));
      nextPaymentDate = setDate(nextPaymentDate, targetDay);
      nextPaymentDate = setHours(nextPaymentDate, hours);
      nextPaymentDate = setMinutes(nextPaymentDate, minutes);
    }
  } else if (data.paymentType === "subscription" && data.typeSpecific.paymentDay) {
    // For subscriptions, use paymentDay (day of month 1-31)
    const [hours, minutes] = data.cycleConfig.time.split(':').map(Number);
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

  // Calculate how many payments have already passed (including today)
  let paymentCount = 0;
  let currentPaymentDate = new Date(firstBillDate);

  while (currentPaymentDate <= now && paymentCount < totalPayments) {
    paymentCount++;
    currentPaymentDate = addMonths(firstBillDate, paymentCount);
  }

  // paymentCount now contains the number of payments that should have been made
  // We need paymentCount - 1 past transactions (the current one at index 0 already counts)
  const pastPayments = paymentCount - 1;

  if (pastPayments <= 0) {
    return;
  }

  // Calculate owedAmount: totalAmount - (monthlyAmount * paymentsMade)
  const paymentsMade = paymentCount - 1;
  const amountPaid = monthlyAmount.times(paymentsMade);
  const owedAmount = new Decimal(typeSpecific.totalAmount).minus(amountPaid);

  const tagIdsString = typeSpecific.tagIds && typeSpecific.tagIds.length > 0
    ? typeSpecific.tagIds.join(',')
    : null;

  // Create transactions for each past payment
  for (let i = 0; i < pastPayments; i++) {
    const paymentDate = addMonths(firstBillDate, i + 1);
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
  const [hours, minutes] = config.time.split(':').map(Number);
  let nextDate = new Date(currentDate);

  // Check if this payment uses perMonthDays (specific day per month)
  const hasPerMonthDays = config.perMonthDays && Object.keys(config.perMonthDays).length > 0;

  switch (config.type) {
    case 'daily':
      nextDate = addDays(nextDate, config.interval);
      break;
    case 'weekly':
      nextDate = addWeeks(nextDate, config.interval);
      break;
    case 'monthly':
      if (hasPerMonthDays) {
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

// Get the next payment date for a specific occurrence
export async function getNextPaymentDateForOccurrence(payment: RecurringPayment): Promise<Date> {
  const config = payment.cycleConfig as CycleConfig;
  const typeSpecific = payment.typeSpecific as TypeSpecificData;
  const now = new Date();

  // For by_term payments, calculate based on firstBillDate
  if (payment.paymentType === "by_term" && typeSpecific.firstBillDate) {
    const firstBillDate = new Date(typeSpecific.firstBillDate);
    const [hours, minutes] = config.time.split(':').map(Number);

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

    // Start from firstBillDate and add months to get to now, then add one more
    nextDate = addMonths(firstBillDate, monthsDiff + 1);

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
        lte(recurringPayments.nextPaymentDate, now)
      )
    );

  const results: Array<{ id: string; success: boolean; error?: string }> = [];
  let processed = 0;

  for (const payment of duePayments) {
    try {
      // Calculate next payment date
      const nextDate = await getNextPaymentDateForOccurrence(payment);

      // Update the payment with new next payment date
      await drizzleDb
        .update(recurringPayments)
        .set({
          nextPaymentDate: nextDate,
          updatedAt: new Date(),
        })
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
        const storedDay = hasStoredMonth ? config.perMonthDays[monthKey] : null;
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
