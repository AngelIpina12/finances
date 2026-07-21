"use server";

import { auth } from "@/lib/auth";
import { drizzleDb, budgets, transactions, type Budget } from "@/lib/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { budgetSchema } from "@/types/forms";
import { revalidatePath } from "next/cache";
import { startOfWeek, startOfMonth, startOfYear, endOfWeek, endOfMonth, endOfYear } from "date-fns";

export interface BudgetProgress {
  budget: Budget;
  spent: number;
  percentage: number;
  remaining: number;
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

export async function createBudget(data: {
  name: string;
  amount: string;
  period: "weekly" | "monthly" | "yearly";
  category: string;
  startDate: Date;
}): Promise<Budget> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const parsed = budgetSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }

  const [newBudget] = await drizzleDb
    .insert(budgets)
    .values({
      userId: session.user.id,
      name: parsed.data.name,
      amount: parsed.data.amount,
      period: parsed.data.period,
      category: parsed.data.category,
      startDate: parsed.data.startDate,
    })
    .returning();

  revalidatePath("/budgets");
  return newBudget;
}

export async function updateBudget(
  id: string,
  data: {
    name?: string;
    amount?: string;
    period?: "weekly" | "monthly" | "yearly";
    category?: string;
    startDate?: Date;
  }
): Promise<Budget> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Verify ownership
  const budget = await getBudget(id);
  if (!budget) throw new Error("Budget not found");

  const [updated] = await drizzleDb
    .update(budgets)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(budgets.id, id),
        eq(budgets.userId, session.user.id)
      )
    )
    .returning();

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

// Get the date range for a period
function getPeriodRange(period: "weekly" | "monthly" | "yearly", date: Date = new Date()) {
  switch (period) {
    case "weekly":
      return {
        start: startOfWeek(date, { weekStartsOn: 1 }),
        end: endOfWeek(date, { weekStartsOn: 1 }),
      };
    case "monthly":
      return {
        start: startOfMonth(date),
        end: endOfMonth(date),
      };
    case "yearly":
      return {
        start: startOfYear(date),
        end: endOfYear(date),
      };
  }
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
    const { start, end } = getPeriodRange(budget.period as "weekly" | "monthly" | "yearly", now);

    // Calculate spent amount for this category in the current period
    const spentResult = await drizzleDb
      .select({
        total: sql<string>`COALESCE(SUM(${transactions.amount}::numeric), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, session.user.id),
          eq(transactions.type, "expense"),
          budget.category ? eq(transactions.category, budget.category) : sql`1=1`,
          gte(transactions.date, start),
          lte(transactions.date, end)
        )
      );

    const spent = parseFloat(spentResult[0]?.total || "0");
    const budgetAmount = parseFloat(budget.amount);
    const percentage = budgetAmount > 0 ? (spent / budgetAmount) * 100 : 0;
    const remaining = budgetAmount - spent;

    results.push({
      budget,
      spent,
      percentage: Math.min(percentage, 100),
      remaining,
    });
  }

  return results;
}
