"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartConfig,
} from "@/components/ui/chart";
import type { Category } from "@/lib/db/schema";

interface Allocation {
  categoryId: string;
  amount: string;
}

interface CategoryBudgetChartProps {
  allocations: Allocation[];
  categories: Category[];
  totalBudget: number;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

const DEFAULT_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "#8884d8",
  "#82ca9d",
  "#ffc658",
  "#ff7c7c",
  "#87ceeb",
];

export function CategoryBudgetChart({
  allocations,
  categories,
  totalBudget,
}: CategoryBudgetChartProps) {
  const chartData = allocations
    .map((a) => {
      const category = categories.find((c) => c.id === a.categoryId);
      return {
        name: category?.name || "Unknown",
        value: parseFloat(a.amount) || 0,
        color: category?.color || DEFAULT_COLORS[allocations.indexOf(a) % DEFAULT_COLORS.length],
      };
    })
    .filter((d) => d.value > 0);

  const chartConfig: ChartConfig = chartData.reduce(
    (acc, item, index) => ({
      ...acc,
      [item.name]: { label: item.name, color: item.color },
    }),
    {}
  );

  if (chartData.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-muted-foreground">
        No allocations to display
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="h-[200px]">
        <ChartContainer config={chartConfig} className="h-full w-full">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={80}
              paddingAngle={2}
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <ChartTooltip
              formatter={(value) => [formatCurrency(Number(value)), "Amount"]}
            />
          </PieChart>
        </ChartContainer>
      </div>

      {/* Legend with amounts */}
      <div className="grid grid-cols-2 gap-2">
        {chartData.map((item) => (
          <div key={item.name} className="flex items-center gap-2 text-sm">
            <div
              className="h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: item.color }}
            />
            <span className="truncate">{item.name}</span>
            <span className="ml-auto text-muted-foreground">
              {formatCurrency(item.value)}
            </span>
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="border-t pt-2 flex justify-between font-medium">
        <span>Total</span>
        <span>{formatCurrency(totalBudget)}</span>
      </div>
    </div>
  );
}
