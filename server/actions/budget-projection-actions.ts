"use server";

import { auth } from "@/lib/auth";
import { drizzleDb, budgets, transactions, budgetAllocations, fixedIncomeAccounts, accounts, categories } from "@/lib/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { addDays, addWeeks, addMonths, addQuarters, addYears, startOfDay, startOfWeek, startOfMonth, startOfQuarter, startOfYear, endOfDay, endOfWeek, endOfMonth, endOfQuarter, endOfYear } from "date-fns";
import { projectCreditCardDebt, type CCDebtProjection } from "./budget-cc-actions";

export interface BudgetProjectionResult {
  periodStart: Date;
  periodEnd: Date;
  allocatedAmount: number;
  projectedSpent: number;
  projectedRemaining: number;
  rolloverAmount: number;
  totalAvailable: number;
}

export interface BudgetProjectionWithIncome {
  periodStart: Date;
  periodEnd: Date;
  periodLabel: string;
  expenseBudget: number;
  incomeBudget: number;
  netBudget: number;
  projectedExpenses: number;
  projectedIncome: number;
  netPosition: number;
  liquidFundsChange: number;
  cumulativeLiquidFunds: number;
  // CC-related fields (optional, populated when CC tracking is enabled)
  ccDebtPayment?: number;
  ccNewDebt?: number;
  ccCumulativeDebt?: number;
}

type RolloverType = "disabled" | "carry_unused" | "carry_unused_plus_overspend" | "carry_overspend_only";

interface InterestCalculationResult {
  tier1Interest: string;
  tier2Interest: string;
  totalDailyInterest: string;
  effectiveRate: string;
  tier1Balance: string;
  tier2Balance: string;
}

// Replicated from fixed-income-actions.ts since it's not exported
function calculateInterestInternal(
  balance: Decimal,
  initialRate: Decimal,
  initialLimit: Decimal,
  secondRate: Decimal | null,
  secondLimit: Decimal | null
): InterestCalculationResult {
  const dailyRate1 = initialRate.dividedBy(365).dividedBy(100);
  const tier1Balance = Decimal.min(balance, initialLimit);
  const tier1Interest = tier1Balance.times(dailyRate1);

  let tier2Balance = balance.minus(initialLimit);
  let tier2Interest = new Decimal(0);

  if (tier2Balance.greaterThan(0) && secondRate) {
    const dailyRate2 = secondRate.dividedBy(365).dividedBy(100);

    if (secondLimit) {
      tier2Balance = Decimal.min(tier2Balance, secondLimit);
    }

    tier2Interest = tier2Balance.times(dailyRate2);
  }

  const totalDailyInterest = tier1Interest.plus(tier2Interest);
  const effectiveRate = totalDailyInterest.dividedBy(balance).times(365).times(100);

  return {
    tier1Interest: tier1Interest.toString(),
    tier2Interest: tier2Interest.toString(),
    totalDailyInterest: totalDailyInterest.toString(),
    effectiveRate: effectiveRate.toString(),
    tier1Balance: tier1Balance.toString(),
    tier2Balance: tier2Balance.toString(),
  };
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

// Get period bounds for granularity
function getPeriodBoundsFromGranularity(
  granularity: "day" | "week" | "month",
  date: Date
): { start: Date; end: Date } {
  switch (granularity) {
    case "day":
      return { start: startOfDay(date), end: endOfDay(date) };
    case "week":
      return { start: startOfWeek(date, { weekStartsOn: 1 }), end: endOfWeek(date, { weekStartsOn: 1 }) };
    case "month":
      return { start: startOfMonth(date), end: endOfMonth(date) };
  }
}

// Advance date by period
function advanceByGranularity(
  granularity: "day" | "week" | "month",
  date: Date
): Date {
  switch (granularity) {
    case "day":
      return addDays(date, 1);
    case "week":
      return addWeeks(date, 1);
    case "month":
      return addMonths(date, 1);
  }
}

// Advance date by period count
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

// Rollover calculation helper
function calculateRollover(
  rolloverType: RolloverType,
  previousRemaining: Decimal
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

// Format period label
function formatPeriodLabel(granularity: "day" | "week" | "month", start: Date, end: Date): string {
  const formatOptions: Intl.DateTimeFormatOptions = {};
  switch (granularity) {
    case "day":
      formatOptions.year = "numeric";
      formatOptions.month = "short";
      formatOptions.day = "numeric";
      break;
    case "week":
      formatOptions.year = "numeric";
      formatOptions.month = "short";
      formatOptions.day = "numeric";
      break;
    case "month":
      formatOptions.year = "numeric";
      formatOptions.month = "long";
      break;
  }
  return `${start.toLocaleDateString("en-US", formatOptions)} - ${end.toLocaleDateString("en-US", formatOptions)}`;
}

export async function projectBudgetForward(
  budgetId: string,
  periodsAhead: number = 6
): Promise<BudgetProjectionResult[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const budget = await drizzleDb
    .select()
    .from(budgets)
    .where(and(eq(budgets.id, budgetId), eq(budgets.userId, session.user.id)))
    .limit(1);

  if (!budget[0]) throw new Error("Budget not found");

  const b = budget[0];
  const budgetAmount = new Decimal(b.amount);
  const rolloverType = b.rolloverType as RolloverType;

  const projections: BudgetProjectionResult[] = [];
  let currentDate = new Date(b.startDate);
  let previousRemaining = new Decimal(0);

  for (let i = 0; i < periodsAhead; i++) {
    const { start, end } = getPeriodBounds(b.period, currentDate);

    // Calculate spent from transactions in this period
    const queryConditions = [
      eq(transactions.userId, session.user.id),
      eq(transactions.type, b.type || "expense"),
      gte(transactions.date, start),
      lte(transactions.date, end),
    ];

    if (!b.isGlobal && b.categoryId) {
      queryConditions.push(eq(transactions.categoryId, b.categoryId));
    }

    const spentResult = await drizzleDb
      .select({
        total: sql<string>`COALESCE(SUM(${transactions.amount}::numeric), 0)`,
      })
      .from(transactions)
      .where(and(...queryConditions));

    const projectedSpent = new Decimal(spentResult[0]?.total || "0");
    const allocatedAmount = b.isReusable ? budgetAmount : budgetAmount;

    // Calculate rollover
    const rolloverAmount = calculateRollover(rolloverType, previousRemaining);
    const totalAvailable = allocatedAmount.plus(rolloverAmount);
    const projectedRemaining = totalAvailable.minus(projectedSpent);

    projections.push({
      periodStart: start,
      periodEnd: end,
      allocatedAmount: allocatedAmount.toNumber(),
      projectedSpent: projectedSpent.toNumber(),
      projectedRemaining: projectedRemaining.toNumber(),
      rolloverAmount: rolloverAmount.toNumber(),
      totalAvailable: totalAvailable.toNumber(),
    });

    // For next iteration
    previousRemaining = projectedRemaining;
    currentDate = addPeriod(b.period, end, 1);
  }

  return projections;
}

export async function projectFullFinancialPosition(
  startDate: Date,
  endDate: Date,
  granularity: "day" | "week" | "month"
): Promise<BudgetProjectionWithIncome[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Get all active budgets
  const userBudgets = await drizzleDb
    .select()
    .from(budgets)
    .where(eq(budgets.userId, session.user.id));

  // Get fixed income accounts for interest projection
  const fixedIncomeAccts = await drizzleDb
    .select()
    .from(fixedIncomeAccounts)
    .where(eq(fixedIncomeAccounts.userId, session.user.id));

  // Get regular accounts for balance tracking
  const userAccounts = await drizzleDb
    .select()
    .from(accounts)
    .where(eq(accounts.userId, session.user.id));

  const results: BudgetProjectionWithIncome[] = [];
  let currentDate = startOfDay(startDate);
  let cumulativeLiquidFunds = 0;

  // Calculate initial liquid funds from account balances
  const totalAssets = userAccounts.reduce((sum, acc) => {
    if (acc.countInAssets && !acc.hideBalance) {
      return sum + parseFloat(acc.balance || "0");
    }
    return sum;
  }, 0);
  cumulativeLiquidFunds = totalAssets;

  while (currentDate < endDate) {
    const { start, end } = getPeriodBoundsFromGranularity(granularity, currentDate);

    // Sum expense budgets for this period
    const expenseBudgets = userBudgets
      .filter((b) => (b.type === "expense" || b.type === null))
      .reduce((sum, b) => sum.plus(b.amount), new Decimal(0));

    // Sum income budgets for this period
    const incomeBudgets = userBudgets
      .filter((b) => b.type === "income")
      .reduce((sum, b) => sum.plus(b.amount), new Decimal(0));

    // Calculate actual expenses from transactions
    const expenseResult = await drizzleDb
      .select({
        total: sql<string>`COALESCE(SUM(${transactions.amount}::numeric), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, session.user.id),
          eq(transactions.type, "expense"),
          gte(transactions.date, start),
          lte(transactions.date, end)
        )
      );

    // Calculate actual income from transactions
    const incomeResult = await drizzleDb
      .select({
        total: sql<string>`COALESCE(SUM(${transactions.amount}::numeric), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, session.user.id),
          eq(transactions.type, "income"),
          gte(transactions.date, start),
          lte(transactions.date, end)
        )
      );

    const projectedExpenses = new Decimal(expenseResult[0]?.total || "0");
    const projectedIncome = new Decimal(incomeResult[0]?.total || "0");

    // Calculate fixed income interest for this period
    let projectedInterest = new Decimal(0);
    for (const fi of fixedIncomeAccts) {
      const linkedAccount = userAccounts.find(
        (a) => a.id === fi.linkedAccountId
      );
      if (linkedAccount) {
        const balance = new Decimal(linkedAccount.balance || "0");
        if (balance.greaterThan(0)) {
          const initialRate = new Decimal(fi.initialInterestRate);
          const initialLimit = new Decimal(fi.initialAmountLimit);
          const secondRate = fi.secondInterestRate ? new Decimal(fi.secondInterestRate) : null;
          const secondLimit = fi.secondAmountLimit ? new Decimal(fi.secondAmountLimit) : null;

          const interestCalc = calculateInterestInternal(
            balance, initialRate, initialLimit, secondRate, secondLimit
          );

          // Multiply daily interest by days in period
          const daysInPeriod = Math.ceil(
            (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
          );
          projectedInterest = projectedInterest.plus(
            new Decimal(interestCalc.totalDailyInterest).times(daysInPeriod)
          );
        }
      }
    }

    const netBudget = incomeBudgets.minus(expenseBudgets);
    const netPosition = projectedIncome.minus(projectedExpenses);
    const liquidFundsChange = netPosition.plus(projectedInterest);
    cumulativeLiquidFunds += liquidFundsChange.toNumber();

    results.push({
      periodStart: start,
      periodEnd: end,
      periodLabel: formatPeriodLabel(granularity, start, end),
      expenseBudget: expenseBudgets.toNumber(),
      incomeBudget: incomeBudgets.toNumber(),
      netBudget: netBudget.toNumber(),
      projectedExpenses: projectedExpenses.toNumber(),
      projectedIncome: projectedIncome.toNumber(),
      netPosition: netPosition.toNumber(),
      liquidFundsChange: liquidFundsChange.toNumber(),
      cumulativeLiquidFunds,
    });

    // Advance to next period
    currentDate = advanceByGranularity(granularity, end);
  }

  return results;
}

// Combined projection result with CC debt
export interface FullBudgetProjectionResult {
  projections: BudgetProjectionWithIncome[];
  ccDebtProjections: CCDebtProjection[];
  totalCCDebt: number;
  netPositionAfterCC: number;
}

// Project full budget with credit card debt integration
export async function projectFullBudgetWithCC(
  startDate: Date,
  endDate: Date,
  granularity: "day" | "week" | "month",
  budgetId?: string
): Promise<FullBudgetProjectionResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Get regular financial position projections
  const projections = await projectFullFinancialPosition(startDate, endDate, granularity);

  // Get CC debt projections
  let ccDebtProjections: CCDebtProjection[] = [];
  let totalCCDebt = 0;

  // Get all budgets with CC tracking
  const userBudgets = await drizzleDb
    .select()
    .from(budgets)
    .where(eq(budgets.userId, session.user.id));

  const ccTrackingBudgets = userBudgets.filter(b => b.hasCreditCardTracking);

  // Collect unique budget IDs that have CC tracking
  const ccBudgetIds = [...new Set(ccTrackingBudgets.map(b => b.id))];

  // If specific budgetId provided, only use that one
  const targetBudgetIds = budgetId
    ? ccBudgetIds.filter(id => id === budgetId)
    : ccBudgetIds;

  for (const bid of targetBudgetIds) {
    const ccProjections = await projectCreditCardDebt(bid, Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
    ));
    ccDebtProjections.push(...ccProjections);
  }

  // Calculate total CC debt (last projection period cumulative)
  for (const cc of ccDebtProjections) {
    const lastProjection = cc.projections[cc.projections.length - 1];
    if (lastProjection) {
      totalCCDebt += lastProjection.cumulativeDebt;
    }
  }

  // Enrich projections with CC debt data per period
  const periodsCount = projections.length;
  for (let i = 0; i < periodsCount; i++) {
    const projection = projections[i];

    // Find CC data for this period index
    let periodCCDebtPayment = 0;
    let periodCCNewDebt = 0;
    let periodCCCumulativeDebt = 0;

    for (const cc of ccDebtProjections) {
      if (cc.projections[i]) {
        periodCCDebtPayment += cc.projections[i].byTermMonthlyPayment;
        periodCCNewDebt += cc.projections[i].totalNewDebt;
        periodCCCumulativeDebt = cc.projections[i].cumulativeDebt; // This is already cumulative
      }
    }

    projections[i] = {
      ...projection,
      ccDebtPayment: periodCCDebtPayment,
      ccNewDebt: periodCCNewDebt,
      ccCumulativeDebt: periodCCCumulativeDebt,
    };
  }

  // Calculate net position after CC
  const netPositionAfterCC = projections.reduce((sum, p) => {
    const netPos = p.netPosition - (p.ccDebtPayment || 0);
    return sum + netPos;
  }, 0);

  return {
    projections,
    ccDebtProjections,
    totalCCDebt,
    netPositionAfterCC,
  };
}
