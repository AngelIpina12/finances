"use server";

import { auth } from "@/lib/auth";
import { getAccounts } from "./account-actions";
import { getTransactions } from "./transaction-actions";
import { getBudgetProgress, type BudgetProgress } from "./budget-actions";
import { simulateProjectedBalances } from "./simulation-actions";
import type { SimulationResult } from "@/types/simulation";
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  format,
} from "date-fns";
import type { Transaction } from "@/lib/db/schema";

export interface DashboardSummary {
  totalBalance: number;
  monthlyIncome: number;
  monthlySpending: number;
  budgetRemaining: number;
  projectedBalance: number;
  simulation: SimulationResult;
  budgetProgress: BudgetProgress[];
  expenseByCategory: { category: string; amount: number }[];
  incomeVsExpensesMonthly: { month: string; income: number; expense: number }[];
}

function getLast6MonthsData(
  transactions: Transaction[]
): { month: string; income: number; expense: number }[] {
  const result: { month: string; income: number; expense: number }[] = [];

  for (let i = 5; i >= 0; i--) {
    const monthDate = subMonths(new Date(), i);
    const monthStart = startOfMonth(monthDate);
    const monthEnd = endOfMonth(monthDate);

    const monthlyTransactions = transactions.filter((t) => {
      const date = new Date(t.date);
      return date >= monthStart && date <= monthEnd;
    });

    const income = monthlyTransactions
      .filter((t) => t.type === "income")
      .reduce((sum, t) => sum + parseFloat(String(t.amount)), 0);

    const expense = monthlyTransactions
      .filter((t) => t.type === "expense")
      .reduce((sum, t) => sum + parseFloat(String(t.amount)), 0);

    result.push({
      month: format(monthDate, "MMM"),
      income,
      expense,
    });
  }

  return result;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const [accounts, transactions, budgetProgress, simulation] =
    await Promise.all([
      getAccounts(),
      getTransactions(),
      getBudgetProgress(),
      simulateProjectedBalances("30days"),
    ]);

  const totalBalance = accounts.reduce(
    (sum, acc) => sum + parseFloat(String(acc.balance)),
    0
  );

  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const monthlyTransactions = transactions.filter((t) => {
    const date = new Date(t.date);
    return date >= monthStart && date <= monthEnd;
  });

  const monthlyIncome = monthlyTransactions
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + parseFloat(String(t.amount)), 0);

  const monthlySpending = monthlyTransactions
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + parseFloat(String(t.amount)), 0);

  const budgetRemaining = budgetProgress.reduce(
    (sum, b) => sum + Math.max(b.remaining, 0),
    0
  );

  const projectedBalance =
    simulation.totalBalanceDataPoints.length > 0
      ? simulation.totalBalanceDataPoints[
          simulation.totalBalanceDataPoints.length - 1
        ].balance
      : totalBalance;

  // Expense by category
  const expenseMap = new Map<string, number>();
  for (const t of monthlyTransactions.filter((t) => t.type === "expense")) {
    const cat = t.category || "Other";
    expenseMap.set(cat, (expenseMap.get(cat) || 0) + parseFloat(String(t.amount)));
  }
  const expenseByCategory = Array.from(expenseMap.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  const incomeVsExpensesMonthly = getLast6MonthsData(transactions);

  return {
    totalBalance,
    monthlyIncome,
    monthlySpending,
    budgetRemaining,
    projectedBalance,
    simulation,
    budgetProgress,
    expenseByCategory,
    incomeVsExpensesMonthly,
  };
}
