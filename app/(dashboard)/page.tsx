"use client";

import { useState, useEffect } from "react";
import { Loader2, TrendingUp, TrendingDown, Wallet, PiggyBank, CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardSummary } from "@/server/actions/dashboard-actions";
import { BalanceProjectionChart } from "@/components/dashboard/balance-projection-chart";
import { IncomeExpenseChart } from "@/components/dashboard/income-expense-chart";
import { ExpenseBreakdownChart } from "@/components/dashboard/expense-breakdown-chart";
import { BudgetProgressChart } from "@/components/dashboard/budget-progress-chart";
import type { DashboardSummary } from "@/server/actions/dashboard-actions";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
  icon: React.ReactNode;
  iconColor?: string;
}

function StatCard({ title, value, subtitle, icon, iconColor = "text-muted-foreground" }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <span className={iconColor}>{icon}</span>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        setLoading(true);
        const summary = await getDashboardSummary();
        setData(summary);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    }
    fetchDashboardData();
  }, []);

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-red-500 dark:bg-red-900/20">
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Your financial overview at a glance</p>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Balance"
          value={formatCurrency(data.totalBalance)}
          subtitle="Across all accounts"
          icon={<Wallet className="h-4 w-4" />}
          iconColor="text-blue-500"
        />
        <StatCard
          title="Monthly Income"
          value={formatCurrency(data.monthlyIncome)}
          subtitle="This month"
          icon={<TrendingUp className="h-4 w-4" />}
          iconColor="text-green-500"
        />
        <StatCard
          title="Monthly Spending"
          value={formatCurrency(data.monthlySpending)}
          subtitle="This month"
          icon={<TrendingDown className="h-4 w-4" />}
          iconColor="text-red-500"
        />
        <StatCard
          title="Budget Remaining"
          value={formatCurrency(data.budgetRemaining)}
          subtitle="Available budget"
          icon={<PiggyBank className="h-4 w-4" />}
          iconColor="text-yellow-500"
        />
      </div>

      {/* Balance Projection Chart */}
      {data.simulation.totalBalanceDataPoints.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5" />
              Balance Projection - {data.simulation.periodLabel}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BalanceProjectionChart
              dataPoints={data.simulation.totalBalanceDataPoints}
              periodLabel={data.simulation.periodLabel}
            />
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Projected balance based on your active recurring payments
            </p>
          </CardContent>
        </Card>
      )}

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Income vs Expense Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Income vs Expenses</CardTitle>
          </CardHeader>
          <CardContent>
            <IncomeExpenseChart data={data.incomeVsExpensesMonthly} />
          </CardContent>
        </Card>

        {/* Expense Breakdown Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Expense Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <ExpenseBreakdownChart data={data.expenseByCategory} />
          </CardContent>
        </Card>
      </div>

      {/* Budget Progress */}
      {data.budgetProgress.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Budget Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <BudgetProgressChart data={data.budgetProgress} />
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {data.budgetProgress.length === 0 &&
        data.simulation.totalBalanceDataPoints.length === 0 &&
        data.incomeVsExpensesMonthly.every((m) => m.income === 0 && m.expense === 0) && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Wallet className="mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="mb-2 text-lg font-medium">No data yet</h3>
              <p className="text-center text-sm text-muted-foreground">
                Start by adding accounts, transactions, and recurring payments to see your financial overview.
              </p>
            </CardContent>
          </Card>
        )}
    </div>
  );
}
