"use client";

import { useState, useEffect } from "react";
import { Loader2, Plus, Pencil, Trash2, AlertTriangle, BarChart3, List, ArrowLeft, Check, ArrowRight, CalendarIcon, CreditCard, RefreshCw } from "lucide-react";
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
  updateBudget,
  createBudget,
} from "@/server/actions/budget-actions";
import {
  projectFullBudgetWithCC,
  projectFullFinancialPosition,
  type BudgetProjectionWithIncome,
  type FullBudgetProjectionResult,
} from "@/server/actions/budget-projection-actions";
import { getUserCreditCards, projectCreditCardDebt, type CCDebtProjection } from "@/server/actions/budget-cc-actions";
import { ProjectionControls, type Granularity } from "@/components/budget/projection-controls";
import type { BudgetProgress } from "@/server/actions/budget-actions";
import { addMonths, format, startOfDay } from "date-fns";
import { useForm, UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { budgetSchema, type BudgetInput } from "@/types/forms";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { getCategories } from "@/server/actions/category-actions";
import { Account } from "@/types";
import { Category, RecurringPayment } from "@/lib/db";
import { getRecurringPayments } from "@/server/actions/recurring-actions";
import { CategoryBudgetChart } from "@/components/budget/category-budget-chart";

interface CCAllocation {
  categoryId: string;
  monthlyAmount: string;
}

interface CCAccountEntry {
  creditAccountId: string;
  categoryAllocations: CCAllocation[];
}

type WizardStep = "basic" | "hierarchy" | "creditCards" | "categories" | "review";

const STEPS: WizardStep[] = ["basic", "hierarchy", "creditCards", "categories", "review"];

const PERIOD_LABELS: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Yearly",
};

const ROLLOVER_LABELS: Record<string, string> = {
  disabled: "Disabled",
  carry_unused: "Carry Unused",
  carry_unused_plus_overspend: "Carry Unused + Overspend",
  carry_overspend_only: "Carry Overspend Only",
};

const PERIOD_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annually", label: "Annually" },
];

const ROLLOVER_OPTIONS = [
  { value: "disabled", label: "No rollover" },
  { value: "carry_unused", label: "Carry unused forward" },
  { value: "carry_unused_plus_overspend", label: "Carry unused + overspend" },
  { value: "carry_overspend_only", label: "Carry overspend only" },
];

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
  const [editingBudget, setEditingBudget] = useState<BudgetProgress | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [deleteBudgetId, setDeleteBudgetId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<WizardStep>("basic");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recurringPayments, setRecurringPayments] = useState<RecurringPayment[]>([]);
  const [selectedRecurringIds, setSelectedRecurringIds] = useState<Set<string>>(new Set());
  const [isLoadingRecurring, setIsLoadingRecurring] = useState(false);

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

  const [creditCards, setCreditCards] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const form: UseFormReturn<any> = useForm({
    resolver: zodResolver(budgetSchema) as any,
    defaultValues: {
      name: editingBudget?.budget.name || "",
      amount: editingBudget?.budget.amount || "0",
      period: editingBudget?.budget.period as "daily" | "weekly" | "monthly" | "quarterly" | "annually" || "monthly",
      type: editingBudget?.budget.type as "income" | "expense" || "expense",
      isGlobal: editingBudget?.budget.isGlobal === 1 || true,
      isReusable: editingBudget?.budget.isReusable === 1 || false,
      rolloverType: editingBudget?.budget.rolloverType as any || "disabled",
      categoryId: editingBudget?.budget.categoryId || undefined || undefined,
      startDate: editingBudget?.budget.startDate || new Date(),
      allocations: editingBudget?.allocations?.map(a => ({
        categoryId: a.categoryId,
        amount: a.amount,
      })),
      autoCalculateAllocations: editingBudget?.budget.autoCalculateAllocations ?? false,
      hasCreditCardTracking: editingBudget?.budget.hasCreditCardTracking ?? false,
      ccAccounts: editingBudget?.budget.ccAccounts || [],
    }
  });

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

  const currentStepIndex = STEPS.indexOf(currentStep);
  const progress = ((currentStepIndex + 1) / STEPS.length) * 100;
  const isGlobal = form.watch("isGlobal");
  const hasCCTracking = form.watch("hasCreditCardTracking");
  const ccAccounts = form.watch("ccAccounts") || [];
  const allocations = form.watch("allocations") || [];
  const budgetType = form.watch("type");
  
  // Calculate totals for selected recurring payments
  const selectedByTermTotal = recurringPayments
    .filter((p) => p.paymentType === "by_term" && selectedRecurringIds.has(p.id))
    .reduce((sum, p) => {
      const typeSpecific = p.typeSpecific as any;
      const totalAmount = parseFloat(typeSpecific?.totalAmount || "0");
      const totalPayments = typeSpecific?.totalPayments || 1;
      return sum + (totalAmount / totalPayments);
    }, 0);

  const selectedSubscriptionTotal = recurringPayments
    .filter((p) => p.paymentType === "subscription" && selectedRecurringIds.has(p.id))
    .reduce((sum, p) => {
      const typeSpecific = p.typeSpecific as any;
      const price = parseFloat(typeSpecific?.price || "0");
      return sum + price;
    }, 0);
  const selectedRecurringTotal = selectedByTermTotal + selectedSubscriptionTotal;
  const totalAmount = allocations.reduce(
    (sum: number, a: any) => sum + (parseFloat(a.amount) || 0),
    0
  ) + selectedRecurringTotal;

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (viewMode === "projections") {
      fetchProjections();
    }
  }, [viewMode, startDate, endDate, granularity, monthsAhead]);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        const [cards, cats] = await Promise.all([
          getUserCreditCards(),
          getCategories("expense"),
        ]);
        setCreditCards(cards);
        setCategories(cats);
      } catch (e) {
        console.error("Failed to fetch data", e);
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, []);

  // Initialize with empty CC accounts if CC tracking enabled but no accounts set
  useEffect(() => {
    if (hasCCTracking && ccAccounts.length === 0) {
      form.setValue("ccAccounts", []);
    }
  }, [hasCCTracking, ccAccounts.length, form]);

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

  useEffect(() => {
    async function fetchData() {
      const cats = await getCategories(budgetType);
      setCategories(cats);

      setIsLoadingRecurring(true);
      try {
        const recurring = await getRecurringPayments();
        setRecurringPayments(recurring);
      } catch (e) {
        console.error("Failed to fetch recurring payments", e);
      } finally {
        setIsLoadingRecurring(false);
      }
    }
    fetchData();
  }, [budgetType]);

  // Update form amount when totals change
  useEffect(() => {
    form.setValue("amount", totalAmount.toString());
  }, [totalAmount, form]);

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

  const renderStep = () => {
    switch (currentStep) {
      case "basic":
        // return <BasicInfoStep form={form} />;
        return (
          <div className="space-y-6">
            <div className="space-y-2">
              <h3 className="text-lg font-medium">Budget Information</h3>
              <p className="text-sm text-muted-foreground">
                Set up the basic details for your budget.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Budget Name</Label>
              <Input
                id="name"
                placeholder="e.g., Monthly Food Budget, Weekly Salary"
                {...form.register("name")}
              />
              {form.formState.errors.name && (
                <p className="text-sm text-red-500">
                  {String(form.formState.errors.name?.message || "")}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Period</Label>
                <Select
                  value={form.watch("period")}
                  onValueChange={(value) => form.setValue("period", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERIOD_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Budget Type</Label>
                <div className="flex items-center gap-3 p-3 border rounded-lg">
                  <div
                    className={`w-3 h-3 rounded-full ${form.watch("type") === "income" ? "bg-green-500" : "bg-red-500"
                      }`}
                  />
                  <Switch
                    checked={form.watch("type") === "income"}
                    onCheckedChange={(checked) =>
                      form.setValue("type", checked ? "income" : "expense")
                    }
                  />
                  <span className="text-sm">
                    {form.watch("type") === "income" ? "Income" : "Expense"}
                  </span>
                </div>
              </div>
            </div>

            {/* Start Date */}
            <div className="space-y-2">
              <Label>Budget Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !form.watch("startDate") && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {form.watch("startDate")
                      ? format(form.watch("startDate"), "MMMM yyyy")
                      : "Select month"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={form.watch("startDate")}
                    onSelect={(date) => {
                      form.setValue("startDate", date || new Date());
                    }}
                  />
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">
                This determines which recurring payments are included based on their due dates.
              </p>
            </div>

            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="space-y-0.5">
                <Label htmlFor="isReusable">Auto-replicate budget</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically create a new period with the same amount when the current
                  period ends.
                </p>
              </div>
              <Switch
                id="isReusable"
                checked={form.watch("isReusable")}
                onCheckedChange={(checked) => form.setValue("isReusable", checked)}
              />
            </div>

            {/* Credit Card Tracking Toggle - only for expense budgets */}
            {form.watch("type") === "expense" && (
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-0.5">
                  <Label htmlFor="hasCreditCardTracking">Track credit card spending</Label>
                  <p className="text-sm text-muted-foreground">
                    Project credit card debt accumulation and payments based on recurring
                    payments and planned category spending.
                  </p>
                </div>
                <Switch
                  id="hasCreditCardTracking"
                  checked={form.watch("hasCreditCardTracking")}
                  onCheckedChange={(checked) => form.setValue("hasCreditCardTracking", checked)}
                />
              </div>
            )}
          </div>
        );
      case "hierarchy":
        // return <HierarchyStep form={form} />;
        return (
          <div className="space-y-6">
            <div className="space-y-2">
              <h3 className="text-lg font-medium">Budget Scope</h3>
              <p className="text-sm text-muted-foreground">
                Choose how this budget applies to your categories.
              </p>
            </div>

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => form.setValue("isGlobal", true)}
                className={`w-full p-4 border rounded-lg text-left transition-colors ${isGlobal
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
                  }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${isGlobal ? "border-primary bg-primary" : "border-muted-foreground"
                      }`}
                  >
                    {isGlobal && <div className="w-2 h-2 rounded-full bg-background" />}
                  </div>
                  <div>
                    <div className="font-medium">Global Budget</div>
                    <div className="text-sm text-muted-foreground">
                      Single budget amount for all transactions
                    </div>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => form.setValue("isGlobal", false)}
                className={`w-full p-4 border rounded-lg text-left transition-colors ${!isGlobal
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
                  }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${!isGlobal ? "border-primary bg-primary" : "border-muted-foreground"
                      }`}
                  >
                    {!isGlobal && <div className="w-2 h-2 rounded-full bg-background" />}
                  </div>
                  <div>
                    <div className="font-medium">Category-Level Budget</div>
                    <div className="text-sm text-muted-foreground">
                      Different amounts for each category
                    </div>
                  </div>
                </div>
              </button>
            </div>

            <div className="space-y-2">
              <Label>Rollover</Label>
              <Select
                value={form.watch("rolloverType")}
                onValueChange={(value) => form.setValue("rolloverType", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLLOVER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {form.watch("rolloverType") === "disabled" && "Budget resets to original amount each period"}
                {form.watch("rolloverType") === "carry_unused" && "Unused budget carries to next period"}
                {form.watch("rolloverType") === "carry_unused_plus_overspend" && "Both unused and overspend carry forward"}
                {form.watch("rolloverType") === "carry_overspend_only" && "Only overspend carries forward"}
              </p>
            </div>

            {!isGlobal && (
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  <strong>Next:</strong> You&apos;ll set specific amounts for each category.
                  The total will be your budget amount.
                </p>
              </div>
            )}
          </div>
        );
      case "creditCards":
        // return <CreditCardStep form={form} />;
        {
          const addCCAccount = () => {
            form.setValue("ccAccounts", [
              ...ccAccounts,
              { creditAccountId: "", categoryAllocations: [] },
            ]);
          };

          const removeCCAccount = (index: number) => {
            form.setValue(
              "ccAccounts",
              ccAccounts.filter((_: any, i: number) => i !== index)
            );
          };

          const updateCCAccount = (index: number, field: string, value: string) => {
            const updated = [...ccAccounts];
            updated[index] = { ...updated[index], [field]: value };
            form.setValue("ccAccounts", updated);
          };

          const addCategoryAllocation = (ccIndex: number) => {
            const updated = [...ccAccounts];
            updated[ccIndex].categoryAllocations.push({ categoryId: "", monthlyAmount: "" });
            form.setValue("ccAccounts", updated);
            form.trigger("ccAccounts");
          };

          const removeCategoryAllocation = (ccIndex: number, allocIndex: number) => {
            const updated = [...ccAccounts];
            updated[ccIndex].categoryAllocations = updated[ccIndex].categoryAllocations.filter(
              (_: any, i: number) => i !== allocIndex
            );
            form.setValue("ccAccounts", updated);
            form.trigger("ccAccounts");
          };

          const updateCategoryAllocation = (
            ccIndex: number,
            allocIndex: number,
            field: string,
            value: string
          ) => {
            const updated = [...ccAccounts];
            updated[ccIndex].categoryAllocations[allocIndex] = {
              ...updated[ccIndex].categoryAllocations[allocIndex],
              [field]: value,
            };
            form.setValue("ccAccounts", updated);
            form.trigger("ccAccounts");
          };

          const totalMonthlySpending = ccAccounts.reduce((sum: number, cc: typeof ccAccounts[number]) => {
            return sum + cc.categoryAllocations.reduce(
              (s: number, alloc: typeof cc.categoryAllocations[number]) => s + (parseFloat(alloc.monthlyAmount) || 0),
              0
            );
          }, 0);

          // Get categories already assigned to CC
          const assignedCategoryIds = new Set(
            ccAccounts.flatMap((cc: typeof ccAccounts[number]) =>
              cc.categoryAllocations.map((a: typeof cc.categoryAllocations[number]) => a.categoryId).filter(Boolean)
            )
          );

          if (!hasCCTracking) {
            return (
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-lg font-medium">Credit Card Debt Projections</h3>
                  <p className="text-sm text-muted-foreground">
                    Enable credit card tracking in the previous step to configure CC debt projections.
                  </p>
                </div>
              </div>
            );
          }

          if (isLoading) {
            return <div className="flex items-center justify-center p-8">Loading credit cards...</div>;
          }

          if (creditCards.length === 0) {
            return (
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-lg font-medium">Credit Card Debt Projections</h3>
                  <p className="text-sm text-muted-foreground">
                    No credit cards found. Add a credit card account first to enable CC debt tracking.
                  </p>
                </div>
              </div>
            );
          }

          return (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-lg font-medium">Credit Card Debt Projections</h3>
                <p className="text-sm text-muted-foreground">
                  Select credit cards and assign monthly spending amounts per category.
                  This will be used to project your debt accumulation.
                </p>
              </div>

              {/* Credit Card Selection */}
              {ccAccounts.map((cc: CCAccountEntry, ccIndex: number) => {
                const selectedCard = creditCards.find(c => c.id === cc.creditAccountId);

                return (
                  <div key={ccIndex} className="p-4 border rounded-lg space-y-4">
                    <div className="flex items-end gap-2">
                      <div className="flex-1 space-y-1">
                        <Label>Credit Card</Label>
                        <Select
                          value={cc.creditAccountId}
                          onValueChange={(v) => updateCCAccount(ccIndex, "creditAccountId", v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select credit card" />
                          </SelectTrigger>
                          <SelectContent>
                            {creditCards.map(card => (
                              <SelectItem key={card.id} value={card.id}>
                                {card.name} {(card.billingDate && card.dueDate) &&
                                  `(${card.billingDate}/${card.dueDate})`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeCCAccount(ccIndex)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>

                    {/* Category Allocations for this CC */}
                    {cc.creditAccountId && (
                      <div className="space-y-3 pl-4 border-l-2 border-muted">
                        <Label className="text-sm font-medium">Category Spending</Label>
                        {cc.categoryAllocations.map((alloc: CCAllocation, allocIndex: number) => {
                          const availableCategories = categories.filter(
                            cat => !assignedCategoryIds.has(cat.id) || alloc.categoryId === cat.id
                          );

                          return (
                            <div key={allocIndex} className="flex gap-2 items-end">
                              <div className="flex-1 space-y-1">
                                <Select
                                  value={alloc.categoryId}
                                  onValueChange={(v) => updateCategoryAllocation(ccIndex, allocIndex, "categoryId", v)}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select category" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {availableCategories.map(cat => (
                                      <SelectItem key={cat.id} value={cat.id}>
                                        {cat.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="w-32 space-y-1">
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={alloc.monthlyAmount}
                                  onChange={(e) => updateCategoryAllocation(ccIndex, allocIndex, "monthlyAmount", e.target.value)}
                                  placeholder="0.00"
                                />
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeCategoryAllocation(ccIndex, allocIndex)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          );
                        })}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => addCategoryAllocation(ccIndex)}
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Add Category
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}

              <Button type="button" variant="outline" onClick={addCCAccount} className="w-full">
                <CreditCard className="mr-2 h-4 w-4" />
                Add Credit Card
              </Button>

              {/* Summary */}
              {totalMonthlySpending > 0 && (
                <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">Total Monthly CC Spending</span>
                    <span className="text-2xl font-bold">
                      {formatCurrency(totalMonthlySpending)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    This amount will be added to your debt projections each month
                  </p>
                </div>
              )}
            </div>
          );
        }
      case "categories":
        // return <CategoriesStep form={form} />;
        {


          // Get categories already assigned to CC
          const ccAssignedCategoryIds = new Set(
            ccAccounts.flatMap((cc: any) =>
              cc.categoryAllocations?.map((a: any) => a.categoryId).filter(Boolean) || []
            )
          );

          const toggleRecurring = (id: string) => {
            const newSet = new Set(selectedRecurringIds);
            if (newSet.has(id)) {
              newSet.delete(id);
            } else {
              newSet.add(id);
            }
            setSelectedRecurringIds(newSet);
          };

          const addAllocation = () => {
            form.setValue("allocations", [
              ...allocations,
              { categoryId: "", amount: "" },
            ]);
          };

          const removeAllocation = (index: number) => {
            form.setValue(
              "allocations",
              allocations.filter((_: any, i: number) => i !== index)
            );
          };

          const updateAllocation = (index: number, field: string, value: string) => {
            const updated = [...allocations];
            updated[index] = { ...updated[index], [field]: value };
            form.setValue("allocations", updated);
          };

          const availableCategories = categories.filter(
            (c) =>
              !allocations.some((a: any) => a.categoryId === c.id && !a.isRecurring) &&
              !ccAssignedCategoryIds.has(c.id)
          );

          const byTermPayments = recurringPayments.filter((p) => p.paymentType === "by_term");
          const subscriptionPayments = recurringPayments.filter((p) => p.paymentType === "subscription");

          return (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-lg font-medium">Category Allocations</h3>
                <p className="text-sm text-muted-foreground">
                  Set amounts for each category. Select recurring payments to include.
                </p>
              </div>

              {/* Notice about CC-assigned categories */}
              {ccAssignedCategoryIds.size > 0 && (
                <div className="p-3 bg-muted/50 rounded-lg text-sm">
                  <p className="text-muted-foreground">
                    {ccAssignedCategoryIds.size} category(ies) are being tracked via credit cards
                    and are not shown here. Configure them in the Credit Card step.
                  </p>
                </div>
              )}

              {/* Recurring Payments Section */}
              <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                <div className="space-y-2">
                  <Label>Recurring Payments</Label>
                  <p className="text-xs text-muted-foreground">
                    Select which recurring payments to include in your budget
                  </p>
                </div>

                {isLoadingRecurring ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Loading recurring payments...
                  </div>
                ) : recurringPayments.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    No recurring payments found. Create them in the Recurring section.
                  </p>
                ) : (
                  <>
                    {/* By Term Payments */}
                    {byTermPayments.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={byTermPayments.length > 0 && byTermPayments.every((p) => selectedRecurringIds.has(p.id))}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  const allIds = new Set(selectedRecurringIds);
                                  byTermPayments.forEach(p => allIds.add(p.id));
                                  setSelectedRecurringIds(allIds);
                                } else {
                                  const remainingIds = new Set(selectedRecurringIds);
                                  byTermPayments.forEach(p => remainingIds.delete(p.id));
                                  setSelectedRecurringIds(remainingIds);
                                }
                              }}
                            />
                            <Label className="text-sm font-medium">By Term (MSI)</Label>
                          </div>
                          <span className="text-sm font-medium text-muted-foreground">
                            {formatCurrency(selectedByTermTotal)}
                          </span>
                        </div>
                        {byTermPayments.map((p) => {
                          const typeSpecific = p.typeSpecific as any;
                          const totalAmount = parseFloat(typeSpecific?.totalAmount || "0");
                          const totalPayments = typeSpecific?.totalPayments || 1;
                          const monthlyPayment = totalAmount / totalPayments;
                          const isSelected = selectedRecurringIds.has(p.id);

                          return (
                            <div
                              key={p.id}
                              className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${isSelected
                                ? "bg-primary/5 border-primary/30"
                                : "bg-background border-border"
                                }`}
                            >
                              <div className="flex items-center gap-3">
                                <Switch
                                  checked={isSelected}
                                  onCheckedChange={() => toggleRecurring(p.id)}
                                />
                                <div>
                                  <div className="font-medium text-sm">{p.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {totalPayments} payments of {formatCurrency(monthlyPayment)}/month
                                  </div>
                                </div>
                              </div>
                              {isSelected && (
                                <Badge variant="secondary" className="text-xs">
                                  {formatCurrency(monthlyPayment)}
                                </Badge>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Subscriptions */}
                    {subscriptionPayments.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={subscriptionPayments.length > 0 && subscriptionPayments.every((p) => selectedRecurringIds.has(p.id))}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  const allIds = new Set(selectedRecurringIds);
                                  subscriptionPayments.forEach(p => allIds.add(p.id));
                                  setSelectedRecurringIds(allIds);
                                } else {
                                  const remainingIds = new Set(selectedRecurringIds);
                                  subscriptionPayments.forEach(p => remainingIds.delete(p.id));
                                  setSelectedRecurringIds(remainingIds);
                                }
                              }}
                            />
                            <Label className="text-sm font-medium">Subscriptions</Label>
                          </div>
                          <span className="text-sm font-medium text-muted-foreground">
                            {formatCurrency(selectedSubscriptionTotal)}
                          </span>
                        </div>
                        {subscriptionPayments.map((p) => {
                          const typeSpecific = p.typeSpecific as any;
                          const price = parseFloat(typeSpecific?.price || "0");
                          const isSelected = selectedRecurringIds.has(p.id);

                          return (
                            <div
                              key={p.id}
                              className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${isSelected
                                ? "bg-primary/5 border-primary/30"
                                : "bg-background border-border"
                                }`}
                            >
                              <div className="flex items-center gap-3">
                                <Switch
                                  checked={isSelected}
                                  onCheckedChange={() => toggleRecurring(p.id)}
                                />
                                <div>
                                  <div className="font-medium text-sm">{p.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {formatCurrency(price)}/month
                                  </div>
                                </div>
                              </div>
                              {isSelected && (
                                <Badge variant="secondary" className="text-xs">
                                  {formatCurrency(price)}
                                </Badge>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Category Allocations */}
              <div className="space-y-3">
                {allocations
                  .filter((a: any) => !a.isRecurring)
                  .map((allocation: any, index: number) => {
                    const category = categories.find((c) => c.id === allocation.categoryId);
                    return (
                      <div
                        key={index}
                        className="flex gap-2 items-end p-3 border rounded-lg"
                      >
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs">Category</Label>
                          <Select
                            value={allocation.categoryId}
                            onValueChange={(v) => updateAllocation(index, "categoryId", v)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                            <SelectContent>
                              {availableCategories
                                .concat(
                                  allocation.categoryId
                                    ? [categories.find((c) => c.id === allocation.categoryId)!]
                                    : []
                                )
                                .filter(Boolean)
                                .map((cat) => (
                                  <SelectItem key={cat.id} value={cat.id}>
                                    {cat.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex-1 space-y-1">
                          <Label className="text-xs">Amount</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={allocation.amount}
                            onChange={(e) =>
                              updateAllocation(index, "amount", e.target.value)
                            }
                            placeholder="0.00"
                          />
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeAllocation(index)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    );
                  })}
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={addAllocation}
                className="w-full"
                disabled={availableCategories.length === 0}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Category
              </Button>

              {/* Budget Amount (calculated) */}
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="font-medium">Budget Amount</span>
                  <span className="text-2xl font-bold">
                    {formatCurrency(totalAmount)}
                  </span>
                </div>
                {selectedRecurringTotal > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Includes {formatCurrency(selectedRecurringTotal)} from {selectedRecurringIds.size} recurring payment(s)
                  </p>
                )}
              </div>

              {/* Chart Preview */}
              {allocations.length > 0 && totalAmount > 0 && (
                <CategoryBudgetChart
                  allocations={allocations.filter((a: any) => !a.isRecurring)}
                  categories={categories}
                  totalBudget={totalAmount}
                />
              )}
            </div>
          );
        }
      case "review":
        // return <ReviewStep form={form} />;
        {
          const data = form.getValues();

          return (
            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-lg font-medium">Review Budget</h3>
                <p className="text-sm text-muted-foreground">
                  Please review your budget settings before creating.
                </p>
              </div>

              <div className="space-y-4">
                {/* Basic Info */}
                <div className="p-4 border rounded-lg space-y-3">
                  <h4 className="font-medium">Basic Information</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Name:</span>
                      <span className="ml-2 font-medium">{data.name}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Type:</span>
                      <span
                        className={`ml-2 font-medium ${data.type === "income" ? "text-green-600" : "text-red-600"
                          }`}
                      >
                        {data.type === "income" ? "Income" : "Expense"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Period:</span>
                      <span className="ml-2 font-medium">
                        {PERIOD_LABELS[data.period]}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Amount:</span>
                      <span className="ml-2 font-medium">
                        {formatCurrency(parseFloat(data.amount) || 0)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Budget Settings */}
                <div className="p-4 border rounded-lg space-y-3">
                  <h4 className="font-medium">Budget Settings</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Hierarchy:</span>
                      <span className="ml-2 font-medium">
                        {data.isGlobal ? "Global" : "Category-Level"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Reusable:</span>
                      <span className="ml-2 font-medium">
                        {data.isReusable ? "Yes" : "No"}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Rollover:</span>
                      <span className="ml-2 font-medium">
                        {ROLLOVER_LABELS[data.rolloverType]}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Category Allocations */}
                {data.allocations && data.allocations.length > 0 && (
                  <div className="p-4 border rounded-lg space-y-3">
                    <h4 className="font-medium">Category Allocations</h4>
                    <div className="space-y-2">
                      {data.allocations.map((alloc: any, idx: number) => (
                        <div
                          key={idx}
                          className="flex justify-between text-sm items-center"
                        >
                          <span className="text-muted-foreground">
                            {alloc.categoryId || `Category ${idx + 1}`}
                          </span>
                          <span className="font-medium">
                            {formatCurrency(parseFloat(alloc.amount) || 0)}
                          </span>
                        </div>
                      ))}
                      <div className="border-t pt-2 flex justify-between font-medium">
                        <span>Total</span>
                        <span>
                          {formatCurrency(
                            data.allocations.reduce(
                              (sum: number, a: any) => sum + (parseFloat(a.amount) || 0),
                              0
                            )
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Auto Calculate */}
                {data.autoCalculateAllocations && (
                  <div className="p-4 border rounded-lg space-y-2">
                    <h4 className="font-medium">Automatic Calculation</h4>
                    <p className="text-sm text-muted-foreground">
                      Category totals will be calculated automatically based on
                      transaction history.
                    </p>
                  </div>
                )}

                {/* Credit Card Tracking */}
                {data.hasCreditCardTracking && data.ccAccounts && data.ccAccounts.length > 0 && (
                  <div className="p-4 border rounded-lg space-y-3">
                    <h4 className="font-medium">Credit Card Projections</h4>
                    <p className="text-xs text-muted-foreground">
                      Debt will be projected based on the following credit card allocations:
                    </p>
                    <div className="space-y-3">
                      {data.ccAccounts.map((cc: any, idx: number) => {
                        const totalForCard = cc.categoryAllocations?.reduce(
                          (sum: number, a: any) => sum + (parseFloat(a.monthlyAmount) || 0),
                          0
                        ) || 0;

                        return (
                          <div key={idx} className="space-y-2">
                            <div className="flex justify-between text-sm font-medium">
                              <span>{cc.creditAccountId || `Card ${idx + 1}`}</span>
                              <span>{formatCurrency(totalForCard)}/month</span>
                            </div>
                            {cc.categoryAllocations?.map((alloc: any, aIdx: number) => (
                              <div
                                key={aIdx}
                                className="flex justify-between text-xs pl-4 text-muted-foreground"
                              >
                                <span>{alloc.categoryId || `Category ${aIdx + 1}`}</span>
                                <span>{formatCurrency(parseFloat(alloc.monthlyAmount) || 0)}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        }
      default:
        return null;
    }
  };

  const goForward = () => {
    const idx = STEPS.indexOf(currentStep);
    if (idx < STEPS.length - 1) {
      const nextStep = STEPS[idx + 1];
      // Skip categories step if global
      if (nextStep === "categories" && isGlobal) {
        setCurrentStep("review");
        // Skip creditCards step if CC tracking is disabled
      } else if (nextStep === "creditCards" && !hasCCTracking) {
        setCurrentStep("categories");
      } else {
        setCurrentStep(nextStep);
      }
    }
  };

  const goBack = () => {
    const idx = STEPS.indexOf(currentStep);
    if (idx > 0) {
      const prevStep = STEPS[idx - 1];
      // Skip categories step if global
      if (prevStep === "categories" && isGlobal) {
        setCurrentStep("basic");
        // Skip creditCards step if CC tracking is disabled
      } else if (prevStep === "creditCards" && !hasCCTracking) {
        setCurrentStep("basic");
      } else {
        setCurrentStep(prevStep);
      }
    }
  };

  const onSubmit = async (data: any) => {
    try {
      setIsSubmitting(true);
      // Calculate amount from allocations if not global
      if (!data.isGlobal && data.allocations?.length > 0) {
        data.amount = data.allocations
          .reduce((sum: number, a: any) => sum + (parseFloat(a.amount) || 0), 0)
          .toString();
      }
      if (editingBudget?.budget.id) {
        await updateBudget(editingBudget?.budget.id, data);
      } else {
        await createBudget(data);
      }
      handleBudgetComplete();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save budget");
    } finally {
      setIsSubmitting(false);
    }
  };

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
              className={`px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors ${viewMode === "list"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted"
                }`}
            >
              <List className="h-4 w-4" />
              List
            </button>
            <button
              onClick={() => setViewMode("projections")}
              className={`px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors ${viewMode === "projections"
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

          <div className="space-y-6">
            <Progress value={progress} className="h-2" />

            <div className="min-h-[300px]">{renderStep()}</div>

            <div className="flex justify-between pt-4 border-t">
              <Button
                variant="outline"
                onClick={currentStepIndex === 0 ? () => setIsWizardOpen(false) : goBack}
                disabled={isSubmitting}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                {currentStepIndex === 0 ? "Cancel" : "Back"}
              </Button>

              {currentStep === "review" ? (
                <Button onClick={form.handleSubmit(onSubmit)} disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Check className="mr-2 h-4 w-4" />
                  {editingBudget?.budget.id ? "Update Budget" : "Create Budget"}
                </Button>
              ) : (
                <Button onClick={goForward}>
                  Next
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              )}
            </div>
          </div>


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
