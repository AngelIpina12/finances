"use client";

import { useEffect, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, RefreshCw, Check } from "lucide-react";
import { getCategories } from "@/server/actions/category-actions";
import { getRecurringPayments } from "@/server/actions/recurring-actions";
import type { Category } from "@/lib/db/schema";
import type { RecurringPayment } from "@/lib/db/schema";
import { CategoryBudgetChart } from "../category-budget-chart";

interface CategoriesStepProps {
  form: UseFormReturn<any>;
}

interface AllocationItem {
  categoryId: string;
  amount: string;
  isRecurring?: boolean;
  recurringId?: string;
  recurringType?: "by_term" | "subscription";
  recurringName?: string;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function calculateMonthlyAmount(payment: RecurringPayment): number {
  if (!payment.cycleConfig) return 0;

  const config = payment.cycleConfig as any;
  const interval = config.interval || 1;

  switch (config.type) {
    case "monthly":
      return 1 / interval;
    case "weekly":
      return 4.33 / interval;
    case "yearly":
      return 1 / 12 / interval;
    case "quarterly":
      return 1 / 3 / interval;
    default:
      return 1 / interval;
  }
}

export function CategoriesStep({ form }: CategoriesStepProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [recurringPayments, setRecurringPayments] = useState<RecurringPayment[]>([]);
  const [selectedRecurringIds, setSelectedRecurringIds] = useState<Set<string>>(new Set());
  const [isLoadingRecurring, setIsLoadingRecurring] = useState(false);
  const allocations = form.watch("allocations") || [];
  const budgetType = form.watch("type");
  const ccAccounts = form.watch("ccAccounts") || [];

  // Get categories already assigned to CC
  const ccAssignedCategoryIds = new Set(
    ccAccounts.flatMap((cc: any) =>
      cc.categoryAllocations?.map((a: any) => a.categoryId).filter(Boolean) || []
    )
  );

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

  const totalAmount = allocations.reduce(
    (sum: number, a: any) => sum + (parseFloat(a.amount) || 0),
    0
  ) + selectedRecurringTotal;

  // Update form amount when totals change
  useEffect(() => {
    form.setValue("amount", totalAmount.toString());
  }, [totalAmount, form]);

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
                  <Label className="text-sm font-medium">By Term (MSI)</Label>
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
                      className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                        isSelected
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
                  <Label className="text-sm font-medium">Subscriptions</Label>
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
                      className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                        isSelected
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
