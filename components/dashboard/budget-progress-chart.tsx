"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Progress } from "@/components/ui/progress";
import {
  ChartContainer,
  ChartTooltip,
  ChartConfig,
} from "@/components/ui/chart";

interface BudgetProgress {
  budget: {
    id: string;
    name: string;
    amount: string;
    category: string | null;
  };
  spent: number;
  percentage: number;
  remaining: number;
}

interface BudgetProgressChartProps {
  data: BudgetProgress[];
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function getProgressColor(percentage: number): string {
  if (percentage >= 100) return "bg-red-500";
  if (percentage >= 80) return "bg-yellow-500";
  return "bg-green-500";
}

function getAlertColor(percentage: number): string {
  if (percentage >= 100) return "text-red-600 dark:text-red-400";
  if (percentage >= 80) return "text-yellow-600 dark:text-yellow-400";
  return "text-green-600 dark:text-green-400";
}

export function BudgetProgressChart({ data }: BudgetProgressChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-muted-foreground">
        No budget data available
      </div>
    );
  }

  const chartData = data.map((b) => ({
    name: b.budget.name,
    spent: b.spent,
    budget: parseFloat(b.budget.amount),
    percentage: Math.min(b.percentage, 100),
  }));

  const chartConfig: ChartConfig = {
    budget: {
      label: "Budget",
      color: "hsl(var(--chart-1))",
    },
  };

  return (
    <div className="space-y-4">
      {data.map((budgetProgress) => {
        const budgetAmount = parseFloat(budgetProgress.budget.amount);
        const isOverBudget = budgetProgress.percentage >= 100;
        const isNearLimit = budgetProgress.percentage >= 80;

        return (
          <div key={budgetProgress.budget.id} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isOverBudget && (
                  <span className="text-red-500">⚠️</span>
                )}
                <span className="font-medium">{budgetProgress.budget.name}</span>
                <span className="text-xs text-muted-foreground">
                  ({budgetProgress.budget.category})
                </span>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className={getAlertColor(budgetProgress.percentage)}>
                  {formatCurrency(budgetProgress.spent)} / {formatCurrency(budgetAmount)}
                </span>
                <span className={getAlertColor(budgetProgress.percentage)}>
                  {budgetProgress.percentage.toFixed(0)}%
                </span>
              </div>
            </div>
            <Progress
              value={Math.min(budgetProgress.percentage, 100)}
              indicatorClassName={getProgressColor(budgetProgress.percentage)}
            />
          </div>
        );
      })}
    </div>
  );
}
