"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartConfig,
  ChartLegendContent,
} from "@/components/ui/chart";

interface ExpenseCategory {
  category: string;
  amount: number;
}

interface ExpenseBreakdownChartProps {
  data: ExpenseCategory[];
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export function ExpenseBreakdownChart({ data }: ExpenseBreakdownChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        No expense data available
      </div>
    );
  }

  const chartConfig: ChartConfig = data.reduce(
    (acc, item, index) => ({
      ...acc,
      [item.category]: {
        label: item.category,
        color: COLORS[index % COLORS.length],
      },
    }),
    {}
  );

  return (
    <ChartContainer config={chartConfig} className="h-[300px] w-full">
      <PieChart>
        <Pie
          data={data}
          dataKey="amount"
          nameKey="category"
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={2}
        >
          {data.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={COLORS[index % COLORS.length]}
            />
          ))}
        </Pie>
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="dot"
              formatter={(value, name) => [
                formatCurrency(Number(value)),
                String(name),
              ]}
            />
          }
        />
        <ChartLegendContent />
      </PieChart>
    </ChartContainer>
  );
}
