"use client";

import { useState, useEffect } from "react";
import { Loader2, Plus, Pencil, Trash2, AlertTriangle, BarChart3, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, LineChart, Line } from "recharts";
import {
  getBudgetProgress,
  deleteBudget,
} from "@/server/actions/budget-actions";
import {
  projectFullBudgetWithCC,
  projectFullFinancialPosition,
  type BudgetProjectionWithIncome,
  type FullBudgetProjectionResult,
} from "@/server/actions/budget-projection-actions";
import { projectCreditCardDebt, type CCDebtProjection } from "@/server/actions/budget-cc-actions";
import { BudgetWizard } from "@/components/budget/budget-wizard";
import { ProjectionControls, type Granularity } from "@/components/budget/projection-controls";
import type { BudgetProgress } from "@/server/actions/budget-actions";
import { addMonths, startOfDay } from "date-fns";

const PERIOD_LABELS: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Yearly",
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
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

export default function BudgetsPage() {
  const [budgets, setBudgets] = useState<BudgetProgress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetProgress | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [deleteBudgetId, setDeleteBudgetId] = useState<string | null>(null);

  // View state
  const [viewMode, setViewMode] = useState<"list" | "projections">("list");

  // Projection state
  const [projectionData, setProjectionData] = useState<BudgetProjectionWithIncome[]>([]);
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [startDate, setStartDate] = useState(addMonths(startOfDay(new Date()), -3));
  const [endDate, setEndDate] = useState(startOfDay(new Date()));
  const [isProjectionsLoading, setIsProjectionsLoading] = useState(false);
  const [monthsAhead, setMonthsAhead] = useState(3);
  const [ccDebtProjections, setCCDebtProjections] = useState<CCDebtProjection[]>([]);

  async function fetchData() {
    try {
      setIsLoading(true);
      const budgetData = await getBudgetProgress();
      setBudgets(budgetData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchProjections() {
    try {
      setIsProjectionsLoading(true);
      const data = await projectFullFinancialPosition(startDate, endDate, granularity);
      setProjectionData(data);

      // Also fetch CC debt projections
      const ccData = await projectCreditCardDebt("", monthsAhead);
      setCCDebtProjections(ccData);
    } catch (err) {
      console.error("Failed to load projections:", err);
    } finally {
      setIsProjectionsLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (viewMode === "projections") {
      fetchProjections();
    }
  }, [viewMode, startDate, endDate, granularity, monthsAhead]);

  async function handleDelete() {
    if (!deleteBudgetId) return;
    try {
      setIsSubmitting(true);
      await deleteBudget(deleteBudgetId);
      setDeleteBudgetId(null);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete budget");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleBudgetComplete() {
    setIsWizardOpen(false);
    setEditingBudget(null);
    fetchData();
  }

  // Calculate totals for list view
  const totalExpenseBudget = budgets
    .filter((b) => b.budget.type === "expense" || b.budget.type === null)
    .reduce((sum, b) => sum + parseFloat(b.budget.amount), 0);
  const totalExpenseSpent = budgets
    .filter((b) => b.budget.type === "expense" || b.budget.type === null)
    .reduce((sum, b) => sum + b.spent, 0);
  const totalIncomeBudget = budgets
    .filter((b) => b.budget.type === "income")
    .reduce((sum, b) => sum + parseFloat(b.budget.amount), 0);
  const totalIncomeSpent = budgets
    .filter((b) => b.budget.type === "income")
    .reduce((sum, b) => sum + b.spent, 0);

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Budgets</h1>
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex border rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode("list")}
              className={`px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors ${
                viewMode === "list"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
            >
              <List className="h-4 w-4" />
              List
            </button>
            <button
              onClick={() => setViewMode("projections")}
              className={`px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors ${
                viewMode === "projections"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
            >
              <BarChart3 className="h-4 w-4" />
              Projections
            </button>
          </div>

          <Button onClick={() => setIsWizardOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Budget
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-red-500 dark:bg-red-900/20">
          {error}
        </div>
      )}

      {/* Wizard Dialog */}
      <Dialog open={isWizardOpen} onOpenChange={setIsWizardOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingBudget ? "Edit Budget" : "Create New Budget"}
            </DialogTitle>
            <DialogDescription>
              {editingBudget
                ? "Update the details of your budget."
                : "Set up a new budget with customizable options."}
            </DialogDescription>
          </DialogHeader>
          <BudgetWizard
            onComplete={handleBudgetComplete}
            onCancel={() => setIsWizardOpen(false)}
            initialData={editingBudget ? {
              name: editingBudget.budget.name,
              amount: editingBudget.budget.amount,
              period: editingBudget.budget.period as "daily" | "weekly" | "monthly" | "quarterly" | "annually",
              type: editingBudget.budget.type as "income" | "expense",
              isGlobal: editingBudget.budget.isGlobal === 1,
              isReusable: editingBudget.budget.isReusable === 1,
              rolloverType: editingBudget.budget.rolloverType as any,
              categoryId: editingBudget.budget.categoryId || undefined,
              startDate: new Date(editingBudget.budget.startDate),
              allocations: editingBudget.allocations?.map(a => ({
                categoryId: a.categoryId,
                amount: a.amount,
              })),
            } : undefined}
            editingBudgetId={editingBudget?.budget.id}
          />
        </DialogContent>
      </Dialog>

      {/* List View */}
      {viewMode === "list" && (
        <>
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Expense Budget
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(totalExpenseBudget)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Expenses
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">
                  {formatCurrency(totalExpenseSpent)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Income Budget
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(totalIncomeBudget)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Income
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {formatCurrency(totalIncomeSpent)}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Overall Progress */}
          {totalExpenseBudget > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-medium">
                  Expense Budget Overview
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {formatCurrency(totalExpenseSpent)} of {formatCurrency(totalExpenseBudget)} spent
                  </span>
                  <span className={getAlertColor((totalExpenseSpent / totalExpenseBudget) * 100)}>
                    {((totalExpenseSpent / totalExpenseBudget) * 100).toFixed(1)}%
                  </span>
                </div>
                <Progress
                  value={Math.min((totalExpenseSpent / totalExpenseBudget) * 100, 100)}
                  indicatorClassName={getProgressColor((totalExpenseSpent / totalExpenseBudget) * 100)}
                />
              </CardContent>
            </Card>
          )}

          {/* Budgets Table */}
          {budgets.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <AlertTriangle className="mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="mb-2 text-lg font-medium">No budgets yet</h3>
                <p className="mb-4 text-sm text-muted-foreground">
                  Create a budget to start tracking your spending by category.
                </p>
                <Button onClick={() => setIsWizardOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Budget
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Budget</TableHead>
                    <TableHead className="text-right">Spent</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead className="w-25">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {budgets.map((budgetProgress) => {
                    const budgetAmount = parseFloat(budgetProgress.budget.amount);
                    const isOverBudget = budgetProgress.percentage >= 100;
                    const isIncome = budgetProgress.budget.type === "income";

                    return (
                      <TableRow key={budgetProgress.budget.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {isOverBudget && !isIncome && (
                              <AlertTriangle className="h-4 w-4 text-red-500" />
                            )}
                            {budgetProgress.budget.name}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={isIncome ? "text-green-600 border-green-600" : "text-red-600 border-red-600"}
                          >
                            {isIncome ? "Income" : "Expense"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {PERIOD_LABELS[budgetProgress.budget.period] ||
                            budgetProgress.budget.period}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(budgetAmount)}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={getAlertColor(budgetProgress.percentage)}>
                            {formatCurrency(budgetProgress.spent)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(Math.max(budgetProgress.remaining, 0))}
                        </TableCell>
                        <TableCell>
                          {!isIncome && (
                            <div className="flex items-center gap-2">
                              <Progress
                                value={Math.min(budgetProgress.percentage, 100)}
                                indicatorClassName={getProgressColor(budgetProgress.percentage)}
                                className="w-20"
                              />
                              <span
                                className={`text-sm ${getAlertColor(budgetProgress.percentage)}`}
                              >
                                {budgetProgress.percentage.toFixed(0)}%
                              </span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setEditingBudget(budgetProgress)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() =>
                                    setDeleteBudgetId(budgetProgress.budget.id)
                                  }
                                >
                                  <Trash2 className="h-4 w-4 text-red-500" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Budget</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete &quot;
                                    {budgetProgress.budget.name}&quot;? This action
                                    cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={handleDelete}
                                    disabled={isSubmitting}
                                    className="bg-red-500 hover:bg-red-600"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}

      {/* Projections View */}
      {viewMode === "projections" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Financial Projections</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ProjectionControls
                granularity={granularity}
                onGranularityChange={setGranularity}
                startDate={startDate}
                endDate={endDate}
                onStartDateChange={setStartDate}
                onEndDateChange={setEndDate}
                onRefresh={fetchProjections}
                isLoading={isProjectionsLoading}
                monthsAhead={monthsAhead}
                onMonthsAheadChange={setMonthsAhead}
              />
            </CardContent>
          </Card>

          {isProjectionsLoading ? (
            <div className="flex h-[300px] items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : projectionData.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <BarChart3 className="mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="mb-2 text-lg font-medium">No projection data</h3>
                <p className="text-sm text-muted-foreground">
                  Adjust the date range and granularity to see projections.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Projection Chart */}
              <Card>
                <CardHeader>
                  <CardTitle>Liquid Funds Projection</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={projectionData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                        <XAxis
                          dataKey="periodLabel"
                          tick={{ fontSize: 12 }}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          tick={{ fontSize: 12 }}
                          tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                        />
                        <Tooltip
                          formatter={(value: number) => [formatCurrency(value), ""]}
                          labelFormatter={(label) => `Period: ${label}`}
                        />
                        <Area
                          type="monotone"
                          dataKey="cumulativeLiquidFunds"
                          stroke="hsl(var(--chart-1))"
                          fill="hsl(var(--chart-1))"
                          fillOpacity={0.3}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Income vs Expenses Chart */}
              <div className="grid gap-6 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Income vs Expenses</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[250px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={projectionData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                          <XAxis
                            dataKey="periodLabel"
                            tick={{ fontSize: 10 }}
                            interval="preserveStartEnd"
                          />
                          <YAxis
                            tick={{ fontSize: 12 }}
                            tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                          />
                          <Tooltip
                            formatter={(value: number) => [formatCurrency(value), ""]}
                          />
                          <Legend />
                          <Bar
                            dataKey="projectedIncome"
                            name="Income"
                            fill="hsl(var(--chart-2))"
                          />
                          <Bar
                            dataKey="projectedExpenses"
                            name="Expenses"
                            fill="hsl(var(--chart-1))"
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                {/* Net Position */}
                <Card>
                  <CardHeader>
                    <CardTitle>Net Position</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[250px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={projectionData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                          <XAxis
                            dataKey="periodLabel"
                            tick={{ fontSize: 10 }}
                            interval="preserveStartEnd"
                          />
                          <YAxis
                            tick={{ fontSize: 12 }}
                            tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                          />
                          <Tooltip
                            formatter={(value: number) => [formatCurrency(value), ""]}
                          />
                          <Bar
                            dataKey="netPosition"
                            name="Net Position"
                            fill="hsl(var(--chart-3))"
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* CC Debt Projections Chart */}
              {ccDebtProjections.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Credit Card Debt Projections</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {ccDebtProjections.map((cc) => (
                      <div key={cc.creditAccountId} className="space-y-2">
                        <div className="flex justify-between items-center">
                          <h4 className="font-medium">{cc.accountName}</h4>
                          <span className="text-xs text-muted-foreground">
                            Billing: {cc.billingDate} / Due: {cc.dueDate}
                          </span>
                        </div>
                        <div className="h-[200px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={cc.projections}>
                              <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                              <XAxis
                                dataKey="periodLabel"
                                tick={{ fontSize: 10 }}
                                interval="preserveStartEnd"
                              />
                              <YAxis
                                tick={{ fontSize: 12 }}
                                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                              />
                              <Tooltip
                                formatter={(value: number) => [formatCurrency(value), ""]}
                              />
                              <Legend />
                              <Bar
                                dataKey="totalNewDebt"
                                name="New Debt"
                                fill="hsl(var(--chart-1))"
                              />
                              <Bar
                                dataKey="prePlannedSpending"
                                name="Pre-planned"
                                fill="hsl(var(--chart-4))"
                              />
                              <Line
                                type="monotone"
                                dataKey="cumulativeDebt"
                                name="Cumulative Debt"
                                stroke="hsl(var(--chart-3))"
                                strokeWidth={2}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    ))}

                    {/* Summary Table for CC */}
                    <div className="border-t pt-4">
                      <h4 className="font-medium mb-3">CC Debt Summary</h4>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Credit Card</TableHead>
                            <TableHead className="text-right">Monthly Payment</TableHead>
                            <TableHead className="text-right">Remaining MSI</TableHead>
                            <TableHead className="text-right">Final Debt</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ccDebtProjections.map((cc) => {
                            const lastProjection = cc.projections[cc.projections.length - 1];
                            const totalMonthlyPayment = cc.projections.reduce(
                              (sum, p) => sum + p.byTermMonthlyPayment + p.subscriptionTotal,
                              0
                            ) / cc.projections.length;
                            return (
                              <TableRow key={cc.creditAccountId}>
                                <TableCell className="font-medium">{cc.accountName}</TableCell>
                                <TableCell className="text-right">
                                  {formatCurrency(totalMonthlyPayment)}
                                </TableCell>
                                <TableCell className="text-right">
                                  {formatCurrency(lastProjection?.byTermRemaining || 0)}
                                </TableCell>
                                <TableCell className="text-right text-red-600 font-medium">
                                  {formatCurrency(lastProjection?.cumulativeDebt || 0)}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Projection Table */}
              <Card>
                <CardHeader>
                  <CardTitle>Detailed Projection</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Income Budget</TableHead>
                        <TableHead className="text-right">Income Actual</TableHead>
                        <TableHead className="text-right">Expense Budget</TableHead>
                        <TableHead className="text-right">Expense Actual</TableHead>
                        <TableHead className="text-right">Net Position</TableHead>
                        <TableHead className="text-right">Liquid Funds</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {projectionData.map((row, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">{row.periodLabel}</TableCell>
                          <TableCell className="text-right text-green-600">
                            {formatCurrency(row.incomeBudget)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(row.projectedIncome)}
                          </TableCell>
                          <TableCell className="text-right text-red-600">
                            {formatCurrency(row.expenseBudget)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(row.projectedExpenses)}
                          </TableCell>
                          <TableCell className={`text-right font-medium ${row.netPosition >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {formatCurrency(row.netPosition)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(row.cumulativeLiquidFunds)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
