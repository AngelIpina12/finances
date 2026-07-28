import { NextResponse } from "next/server";
import { drizzleDb, recurringPayments, accounts, transactions } from "@/lib/db";
import { eq, and, lte } from "drizzle-orm";
import { addDays, addWeeks, addMonths, addYears, setHours, setMinutes, setDate, getDay, getDaysInMonth } from "date-fns";
import Decimal from "decimal.js";

interface CycleConfig {
  type: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
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
  paymentDay?: number;
  endDate?: Date;
}

// This endpoint should be called daily by a cron job (e.g., Vercel Cron, GitHub Actions)
// It processes recurring payments that are due and creates transactions for them

export async function GET(request: Request) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();

    // Get all active recurring payments that are due
    const duePayments = await drizzleDb
      .select()
      .from(recurringPayments)
      .where(
        and(
          eq(recurringPayments.isActive, 1),
          lte(recurringPayments.nextPaymentDate, now)
        )
      );

    const results = [];

    for (const payment of duePayments) {
      try {
        const cycleConfig = payment.cycleConfig as CycleConfig;
        const typeSpecific = payment.typeSpecific as TypeSpecificData;

        // Calculate next payment date based on cycle config
        const nextDate = calculateNextPaymentDate(
          new Date(payment.nextPaymentDate!),
          cycleConfig
        );

        const tagIdsString = typeSpecific.tagIds && typeSpecific.tagIds.length > 0
          ? typeSpecific.tagIds.join(',')
          : null;
        const paymentDate = new Date(payment.nextPaymentDate!);

        // 1. INDEFINITE + TRANSACTION (income)
        if (payment.paymentType === 'indefinite' && typeSpecific.subtype === 'transaction') {
          const amount = parseFloat(typeSpecific.amount || '0');
          const accountId = typeSpecific.accountId;

          if (accountId && amount > 0) {
            const [account] = await drizzleDb
              .select()
              .from(accounts)
              .where(eq(accounts.id, accountId))
              .limit(1);

            if (account) {
              const newBalance = new Decimal(account.balance).plus(amount).toString();

              await drizzleDb
                .update(accounts)
                .set({ balance: newBalance, updatedAt: new Date() })
                .where(eq(accounts.id, accountId));

              await drizzleDb
                .insert(transactions)
                .values({
                  userId: payment.userId,
                  accountId: accountId,
                  type: 'income',
                  categoryId: typeSpecific.categoryId || null,
                  amount: amount.toString(),
                  description: `Recurring income: ${payment.name}`,
                  tagIds: tagIdsString,
                  recurringPaymentId: payment.id,
                  date: paymentDate,
                });
            }
          }
        }

        // 2. INDEFINITE + TRANSFER
        if (payment.paymentType === 'indefinite' && typeSpecific.subtype === 'transfer') {
          const amount = parseFloat(typeSpecific.amount || '0');
          const fromAccountId = typeSpecific.fromAccountId;
          const toAccountId = typeSpecific.toAccountId;

          if (fromAccountId && toAccountId && amount > 0) {
            const [fromAccount] = await drizzleDb
              .select()
              .from(accounts)
              .where(eq(accounts.id, fromAccountId))
              .limit(1);

            const [toAccount] = await drizzleDb
              .select()
              .from(accounts)
              .where(eq(accounts.id, toAccountId))
              .limit(1);

            if (fromAccount && toAccount) {
              const newFromBalance = new Decimal(fromAccount.balance).minus(amount).toString();
              const newToBalance = new Decimal(toAccount.balance).plus(amount).toString();

              await drizzleDb
                .update(accounts)
                .set({ balance: newFromBalance, updatedAt: new Date() })
                .where(eq(accounts.id, fromAccountId));

              await drizzleDb
                .update(accounts)
                .set({ balance: newToBalance, updatedAt: new Date() })
                .where(eq(accounts.id, toAccountId));

              await drizzleDb
                .insert(transactions)
                .values({
                  userId: payment.userId,
                  accountId: fromAccountId,
                  type: 'transfer',
                  amount: amount.toString(),
                  description: `Recurring transfer: ${payment.name}`,
                  tagIds: tagIdsString,
                  recurringPaymentId: payment.id,
                  date: paymentDate,
                });
            }
          }
        }

        // 3. SUBSCRIPTION (expense)
        if (payment.paymentType === 'subscription') {
          const amount = parseFloat(typeSpecific.price || '0');
          const accountId = typeSpecific.accountId;

          if (accountId && amount > 0) {
            const [account] = await drizzleDb
              .select()
              .from(accounts)
              .where(eq(accounts.id, accountId))
              .limit(1);

            if (account) {
              const newBalance = new Decimal(account.balance).minus(amount).toString();

              await drizzleDb
                .update(accounts)
                .set({ balance: newBalance, updatedAt: new Date() })
                .where(eq(accounts.id, accountId));

              await drizzleDb
                .insert(transactions)
                .values({
                  userId: payment.userId,
                  accountId: accountId,
                  type: 'expense',
                  categoryId: typeSpecific.categoryId || null,
                  amount: amount.toString(),
                  description: `Subscription: ${payment.name}`,
                  tagIds: tagIdsString,
                  recurringPaymentId: payment.id,
                  date: paymentDate,
                });
            }
          }
        }

        // 4. BY_TERM (expense on credit account, reduce credit limit if applicable)
        if (payment.paymentType === 'by_term') {
          const totalAmount = parseFloat(typeSpecific.totalAmount || '0');
          const totalPayments = typeSpecific.totalPayments || 1;
          const monthlyAmount = totalAmount / totalPayments;
          const creditAccountId = typeSpecific.creditAccountId;

          if (creditAccountId && monthlyAmount > 0) {
            const [creditAccount] = await drizzleDb
              .select()
              .from(accounts)
              .where(eq(accounts.id, creditAccountId))
              .limit(1);

            if (creditAccount) {
              // Create expense transaction
              await drizzleDb
                .insert(transactions)
                .values({
                  userId: payment.userId,
                  accountId: creditAccountId,
                  type: 'expense',
                  categoryId: typeSpecific.categoryId || null,
                  amount: monthlyAmount.toString(),
                  description: `${payment.name} (${typeSpecific.totalPayments || 0}/${typeSpecific.totalPayments || 0})`,
                  tagIds: tagIdsString,
                  recurringPaymentId: payment.id,
                  date: paymentDate,
                });

              // If reduceCreditLimit is enabled, reduce the credit limit
              if (typeSpecific.reduceCreditLimit && creditAccount.creditLimit) {
                const currentLimit = new Decimal(creditAccount.creditLimit || "0");
                const newLimit = currentLimit.minus(monthlyAmount);

                await drizzleDb
                  .update(accounts)
                  .set({ creditLimit: newLimit.toString(), updatedAt: new Date() })
                  .where(eq(accounts.id, creditAccountId));
              }
            }
          }
        }

        // Update next payment date
        await drizzleDb
          .update(recurringPayments)
          .set({
            nextPaymentDate: nextDate,
            updatedAt: new Date(),
          })
          .where(eq(recurringPayments.id, payment.id));

        results.push({
          id: payment.id,
          name: payment.name,
          paymentType: payment.paymentType,
          nextPaymentDate: nextDate,
          status: "processed",
        });
      } catch (error) {
        results.push({
          id: payment.id,
          name: payment.name,
          paymentType: payment.paymentType,
          status: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      processed: results.length,
      results,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error("Error processing recurring payments:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

function calculateNextPaymentDate(currentDate: Date, config: CycleConfig): Date {
  const [hours, minutes] = config.time.split(':').map(Number);
  let nextDate = new Date(currentDate);

  switch (config.type) {
    case 'daily':
      nextDate = addDays(nextDate, config.interval);
      break;
    case 'weekly':
      nextDate = addWeeks(nextDate, config.interval);
      break;
    case 'monthly':
      nextDate = addMonths(nextDate, config.interval);
      break;
    case 'yearly':
      nextDate = addYears(nextDate, config.interval);
      break;
    case 'custom':
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

  // Apply perMonthDays if configured for this specific month
  const monthKey = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
  if (config.perMonthDays && config.perMonthDays[monthKey] !== undefined) {
    const targetDay = config.perMonthDays[monthKey];
    nextDate = setDate(nextDate, Math.min(targetDay, getDaysInMonth(nextDate)));
  }

  nextDate = setHours(nextDate, hours);
  nextDate = setMinutes(nextDate, minutes);

  return nextDate;
}

function findNextDayOfWeek(date: Date, dayOfWeek: number): Date {
  const current = new Date(date);
  const currentDay = getDay(current);
  const daysUntilTarget = (dayOfWeek - currentDay + 7) % 7;
  if (daysUntilTarget === 0) return current;
  return addDays(current, daysUntilTarget);
}
