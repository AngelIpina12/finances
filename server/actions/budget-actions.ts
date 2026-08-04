"use server";

import { auth } from "@/lib/auth";
import { drizzleDb, budgets, transactions, budgetAllocations, budgetPeriods, type Budget, type BudgetAllocation, type BudgetPeriod } from "@/lib/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { budgetSchema, type BudgetInput, type BudgetAllocationInput } from "@/types/forms";
import { revalidatePath } from "next/cache";
import { startOfWeek, startOfMonth, startOfYear, startOfDay, startOfQuarter, endOfWeek, endOfMonth, endOfYear, endOfDay, endOfQuarter, addDays, addWeeks, addMonths, addQuarters, addYears } from "date-fns";
import Decimal from "decimal.js";
import { saveBudgetCreditCards } from "./budget-cc-actions";

export interface BudgetProgress {
  budget: Budget;
  allocations?: BudgetAllocation[];
  spent: number;
  percentage: number;
  remaining: number;
}

export interface BudgetWithAllocations extends Budget {
  allocations: BudgetAllocation[];
}

type RolloverType = "disabled" | "carry_unused" | "carry_unused_plus_overspend" | "carry_overspend_only";

// Rollover calculation helper
function calculateRollover(
  rolloverType: RolloverType,
  previousRemaining: Decimal,
  previousOverspend: Decimal
): Decimal {
  switch (rolloverType) {
    case "disabled":
      return new Decimal(0);
    case "carry_unused":
      return Decimal.max(previousRemaining, 0);
    case "carry_unused_plus_overspend":
      return previousRemaining;
    case "carry_overspend_only":
      return Decimal.min(previousRemaining, 0);
    default:
      return new Decimal(0);
  }
}

// Get period bounds based on period type
function getPeriodBounds(period: string, date: Date = new Date()): { start: Date; end: Date } {
  switch (period) {
    case "daily":
      return { start: startOfDay(date), end: endOfDay(date) };
    case "weekly":
      return { start: startOfWeek(date, { weekStartsOn: 1 }), end: endOfWeek(date, { weekStartsOn: 1 }) };
    case "monthly":
      return { start: startOfMonth(date), end: endOfMonth(date) };
    case "quarterly":
      return { start: startOfQuarter(date), end: endOfQuarter(date) };
    case "annually":
      return { start: startOfYear(date), end: endOfYear(date) };
    default:
      return { start: startOfMonth(date), end: endOfMonth(date) };
  }
}

// Advance date by period
function addPeriod(period: string, date: Date, count: number): Date {
  switch (period) {
    case "daily":
      return addDays(date, count);
    case "weekly":
      return addWeeks(date, count);
    case "monthly":
      return addMonths(date, count);
    case "quarterly":
      return addQuarters(date, count);
    case "annually":
      return addYears(date, count);
    default:
      return addMonths(date, count);
  }
}

export async function getBudgets(): Promise<Budget[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userBudgets = await drizzleDb
    .select()
    .from(budgets)
    .where(eq(budgets.userId, session.user.id));

  return userBudgets;
}

export async function getBudget(id: string): Promise<Budget | null> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const budget = await drizzleDb
    .select()
    .from(budgets)
    .where(
      and(
        eq(budgets.id, id),
        eq(budgets.userId, session.user.id)
      )
    )
    .limit(1);

  return budget[0] || null;
}

export async function getBudgetWithAllocations(id: string): Promise<BudgetWithAllocations | null> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const budget = await getBudget(id);
  if (!budget) return null;

  const allocations = await drizzleDb
    .select()
    .from(budgetAllocations)
    .where(eq(budgetAllocations.budgetId, id));

  return { ...budget, allocations };
}

export async function getBudgetAllocations(budgetId: string): Promise<BudgetAllocation[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  return drizzleDb
    .select()
    .from(budgetAllocations)
    .where(eq(budgetAllocations.budgetId, budgetId));
}

export async function createBudget(data: BudgetInput): Promise<Budget> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const parsed = budgetSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }

  const budgetData = parsed.data;

  const [newBudget] = await drizzleDb
    .insert(budgets)
    .values({
      userId: session.user.id,
      name: budgetData.name,
      amount: budgetData.amount,
      period: budgetData.period,
      type: budgetData.type,
      isGlobal: budgetData.isGlobal ? 1 : 0,
      isReusable: budgetData.isReusable ? 1 : 0,
      rolloverType: budgetData.rolloverType,
      categoryId: budgetData.categoryId || null,
      category: budgetData.category || null,
      startDate: budgetData.startDate,
      endDate: budgetData.endDate,
      hasCreditCardTracking: budgetData.hasCreditCardTracking ? 1 : 0,
    })
    .returning();

  // Create allocations if provided
  if (budgetData.allocations && budgetData.allocations.length > 0) {
    await drizzleDb.insert(budgetAllocations).values(
      budgetData.allocations.map(a => ({
        budgetId: newBudget.id,
        categoryId: a.categoryId,
        amount: a.amount,
      }))
    );
  }

  // Save CC configurations if CC tracking is enabled
  if (budgetData.hasCreditCardTracking && budgetData.ccAccounts && budgetData.ccAccounts.length > 0) {
    await saveBudgetCreditCards(newBudget.id, budgetData.ccAccounts);
  }

  revalidatePath("/budgets");
  return newBudget;
}

export async function updateBudget(
  id: string,
  data: Partial<BudgetInput>
): Promise<Budget> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Verify ownership
  const budget = await getBudget(id);
  if (!budget) throw new Error("Budget not found");

  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.amount !== undefined) updateData.amount = data.amount;
  if (data.period !== undefined) updateData.period = data.period;
  if (data.type !== undefined) updateData.type = data.type;
  if (data.isGlobal !== undefined) updateData.isGlobal = data.isGlobal ? 1 : 0;
  if (data.isReusable !== undefined) updateData.isReusable = data.isReusable ? 1 : 0;
  if (data.rolloverType !== undefined) updateData.rolloverType = data.rolloverType;
  if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.startDate !== undefined) updateData.startDate = data.startDate;
  if (data.endDate !== undefined) updateData.endDate = data.endDate;
  if (data.hasCreditCardTracking !== undefined) updateData.hasCreditCardTracking = data.hasCreditCardTracking ? 1 : 0;

  const [updated] = await drizzleDb
    .update(budgets)
    .set(updateData)
    .where(
      and(
        eq(budgets.id, id),
        eq(budgets.userId, session.user.id)
      )
    )
    .returning();

  // Update allocations if provided
  if (data.allocations !== undefined) {
    // Delete existing allocations
    await drizzleDb
      .delete(budgetAllocations)
      .where(eq(budgetAllocations.budgetId, id));

    // Insert new allocations
    if (data.allocations.length > 0) {
      await drizzleDb.insert(budgetAllocations).values(
        data.allocations.map(a => ({
          budgetId: id,
          categoryId: a.categoryId,
          amount: a.amount,
        }))
      );
    }
  }

  // Update CC configurations if provided
  if (data.ccAccounts !== undefined) {
    await saveBudgetCreditCards(id, data.ccAccounts);
  }

  revalidatePath("/budgets");
  return updated;
}

export async function deleteBudget(id: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  await drizzleDb
    .delete(budgets)
    .where(
      and(
        eq(budgets.id, id),
        eq(budgets.userId, session.user.id)
      )
    );

  revalidatePath("/budgets");
}

export async function getBudgetProgress(budgetId?: string): Promise<BudgetProgress[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userBudgets = budgetId
    ? [await getBudget(budgetId)].filter(Boolean) as Budget[]
    : await getBudgets();

  const now = new Date();
  const results: BudgetProgress[] = [];

  for (const budget of userBudgets) {
    const { start, end } = getPeriodBounds(budget.period, now);

    // Build the query conditions
    const queryConditions = [
      eq(transactions.userId, session.user.id),
      eq(transactions.type, budget.type || "expense"),
      gte(transactions.date, start),
      lte(transactions.date, end),
    ];

    // Add category filter if it's a category-level budget
    if (!budget.isGlobal && budget.categoryId) {
      queryConditions.push(eq(transactions.categoryId, budget.categoryId));
    }

    // Calculate spent amount for this period
    const spentResult = await drizzleDb
      .select({
        total: sql<string>`COALESCE(SUM(${transactions.amount}::numeric), 0)`,
      })
      .from(transactions)
      .where(and(...queryConditions));

    const spent = parseFloat(spentResult[0]?.total || "0");
    const budgetAmount = parseFloat(budget.amount);
    const percentage = budgetAmount > 0 ? (spent / budgetAmount) * 100 : 0;
    const remaining = budgetAmount - spent;

    // Get allocations if it's a category-level budget
    const allocations = budget.isGlobal ? await getBudgetAllocations(budget.id) : [];

    results.push({
      budget,
      allocations,
      spent,
      percentage: Math.min(percentage, 100),
      remaining,
    });
  }

  return results;
}

export async function calculateCategoryAllocations(
  budgetPeriod: string,
  budgetType: "income" | "expense",
  startDate: Date
): Promise<{ categoryId: string; categoryName: string; totalAmount: string }[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const { start, end } = getPeriodBounds(budgetPeriod, startDate);

  // Get categories of the matching type with transactions in this period
  const result = await drizzleDb
    .select({
      categoryId: transactions.categoryId,
      total: sql<string>`COALESCE(SUM(${transactions.amount}::numeric), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, session.user.id),
        eq(transactions.type, budgetType),
        gte(transactions.date, start),
        lte(transactions.date, end),
        // Only categories that have transactions in this period
      )
    )
    .groupBy(transactions.categoryId);

  // Get category names
  const categoryIds = result.map(r => r.categoryId).filter(Boolean);
  if (categoryIds.length === 0) return [];

  const categories = await drizzleDb
    .select({ id: budgets.id, name: budgets.name })
    .from(budgets)
    .where(sql`${budgets.id} IN (${sql.join(categoryIds.map(id => sql`${id}`), sql`, `)})`);

  return result
    .filter(r => r.categoryId)
    .map(r => {
      const category = categories.find(c => c.id === r.categoryId);
      return {
        categoryId: r.categoryId as string,
        categoryName: category?.name || "Unknown",
        totalAmount: r.total,
      };
    });
}
