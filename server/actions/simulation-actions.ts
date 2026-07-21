"use server";

import { auth } from "@/lib/auth";
import { drizzleDb, accounts, recurringPayments } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import Decimal from "decimal.js";
import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  startOfDay,
  isBefore,
  isAfter,
  isSameDay,
} from "date-fns";
import type {
  SimulationResult,
  AccountProjection,
  BalanceDataPoint,
  SimulationEvent,
  SimulationPeriod,
} from "@/types/simulation";

interface SimulationParams {
  start: Date;
  end: Date;
  granularity: "day" | "week" | "month";
}

function getSimulationParams(period: SimulationPeriod): SimulationParams {
  const today = startOfDay(new Date());
  switch (period) {
    case "30days":
      return { start: today, end: addDays(today, 30), granularity: "day" };
    case "90days":
      return { start: today, end: addDays(today, 90), granularity: "week" };
    case "12months":
      return { start: today, end: addMonths(today, 12), granularity: "month" };
  }
}

function calculateNextPaymentDate(
  currentDate: Date,
  frequency: string
): Date {
  switch (frequency) {
    case "daily":
      return addDays(currentDate, 1);
    case "weekly":
      return addWeeks(currentDate, 1);
    case "monthly":
      return addMonths(currentDate, 1);
    case "yearly":
      return addYears(currentDate, 1);
    default:
      return addMonths(currentDate, 1);
  }
}

function isDateInPeriodGranularity(
  date: Date,
  periodStart: Date,
  periodEnd: Date,
  granularity: "day" | "week" | "month"
): boolean {
  if (granularity === "day") {
    return (
      !isBefore(date, periodStart) &&
      (isBefore(date, periodEnd) || isSameDay(date, periodEnd))
    );
  } else if (granularity === "week") {
    let weekStart = periodStart;
    while (!isAfter(weekStart, periodEnd)) {
      const weekEnd = addDays(weekStart, 6);
      if (
        (isBefore(date, weekStart) === false || isSameDay(date, weekStart)) &&
        (isAfter(date, weekEnd) === false || isSameDay(date, weekEnd))
      ) {
        return true;
      }
      weekStart = addWeeks(weekStart, 1);
    }
    return false;
  } else {
    let monthStart = periodStart;
    while (!isAfter(monthStart, periodEnd)) {
      const monthEnd = addMonths(monthStart, 1);
      if (
        (isBefore(date, monthStart) === false || isSameDay(date, monthStart)) &&
        isBefore(date, monthEnd)
      ) {
        return true;
      }
      monthStart = addMonths(monthStart, 1);
    }
    return false;
  }
}

function isPeriodEndDate(
  date: Date,
  granularity: "day" | "week" | "month"
): boolean {
  if (granularity === "day") {
    return true;
  }
  if (granularity === "week") {
    return date.getDay() === 0; // Sunday
  }
  if (granularity === "month") {
    const tomorrow = addDays(date, 1);
    return tomorrow.getDate() === 1;
  }
  return false;
}

export async function simulateProjectedBalances(
  period: SimulationPeriod = "30days"
): Promise<SimulationResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userAccounts = await drizzleDb
    .select()
    .from(accounts)
    .where(eq(accounts.userId, session.user.id));

  const activePayments = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(
      and(
        eq(recurringPayments.userId, session.user.id),
        eq(recurringPayments.isActive, 1)
      )
    );

  const { start, end, granularity } = getSimulationParams(period);

  const accountProjections: AccountProjection[] = [];
  const totalBalanceDataPoints: BalanceDataPoint[] = [];

  // Initialize account states
  const accountStates = new Map<
    string,
    {
      balance: Decimal;
      name: string;
      currency: string;
      dataPoints: BalanceDataPoint[];
      events: SimulationEvent[];
    }
  >();

  for (const account of userAccounts) {
    accountStates.set(account.id, {
      balance: new Decimal(account.balance),
      name: account.name,
      currency: account.currency,
      dataPoints: [
        { date: start, balance: parseFloat(String(account.balance)) },
      ],
      events: [],
    });
  }

  // Track next payment dates for each payment
  const paymentNextDates = new Map<string, Date>();
  for (const payment of activePayments) {
    paymentNextDates.set(payment.id, new Date(payment.nextPaymentDate));
  }

  // Initial total balance snapshot
  const initialTotal = Array.from(accountStates.values()).reduce(
    (sum, state) => sum.plus(state.balance),
    new Decimal(0)
  );
  totalBalanceDataPoints.push({
    date: start,
    balance: initialTotal.toNumber(),
  });

  // Simulate each period
  let currentDate = new Date(start);

  while (isBefore(currentDate, end) || isSameDay(currentDate, end)) {
    // Process any payments due on this date
    for (const payment of activePayments) {
      const nextDate = paymentNextDates.get(payment.id)!;

      if (
        isDateInPeriodGranularity(nextDate, start, currentDate, granularity)
      ) {
        const accountState = accountStates.get(payment.accountId);
        if (accountState) {
          const paymentAmount = new Decimal(payment.amount);
          accountState.balance = accountState.balance.minus(paymentAmount);

          accountState.events.push({
            type: "expense",
            accountId: payment.accountId,
            accountName: accountState.name,
            paymentName: payment.name,
            amount: parseFloat(payment.amount),
            date: new Date(nextDate),
          });
        }

        // Schedule next occurrence
        paymentNextDates.set(
          payment.id,
          calculateNextPaymentDate(nextDate, payment.frequency)
        );
      }
    }

    // Record data point at period end
    if (isPeriodEndDate(currentDate, granularity)) {
      const totalBalance = Array.from(accountStates.values()).reduce(
        (sum, state) => sum.plus(state.balance),
        new Decimal(0)
      );

      totalBalanceDataPoints.push({
        date: new Date(currentDate),
        balance: totalBalance.toNumber(),
      });

      for (const [, state] of accountStates) {
        state.dataPoints.push({
          date: new Date(currentDate),
          balance: state.balance.toNumber(),
        });
      }
    }

    // Advance to next period
    currentDate =
      granularity === "day"
        ? addDays(currentDate, 1)
        : granularity === "week"
          ? addWeeks(currentDate, 1)
          : addMonths(currentDate, 1);
  }

  // Build result
  for (const account of userAccounts) {
    const state = accountStates.get(account.id);
    if (state) {
      accountProjections.push({
        accountId: account.id,
        accountName: state.name,
        initialBalance: parseFloat(String(account.balance)),
        currency: state.currency,
        dataPoints: state.dataPoints,
        events: state.events,
      });
    }
  }

  return {
    accountProjections,
    totalBalanceDataPoints,
    simulationRange: { start, end },
    periodLabel: period as SimulationResult["periodLabel"],
  };
}
