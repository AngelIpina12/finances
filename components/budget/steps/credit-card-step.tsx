"use client";

import { useState, useEffect } from "react";
import { UseFormReturn } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, CreditCard } from "lucide-react";
import { getUserCreditCards } from "@/server/actions/budget-cc-actions";
import { getCategories } from "@/server/actions/category-actions";
import type { Account, Category } from "@/lib/db/schema";

interface CreditCardStepProps {
  form: UseFormReturn<any>;
}

interface CCAllocation {
  categoryId: string;
  monthlyAmount: string;
}

interface CCAccountEntry {
  creditAccountId: string;
  categoryAllocations: CCAllocation[];
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function CreditCardStep({ form }: CreditCardStepProps) {
  const [creditCards, setCreditCards] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const ccAccounts = form.watch("ccAccounts") || [];
  const hasCCTracking = form.watch("hasCreditCardTracking");

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
  };

  const removeCategoryAllocation = (ccIndex: number, allocIndex: number) => {
    const updated = [...ccAccounts];
    updated[ccIndex].categoryAllocations = updated[ccIndex].categoryAllocations.filter(
      (_: any, i: number) => i !== allocIndex
    );
    form.setValue("ccAccounts", updated);
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
  };

  const totalMonthlySpending = ccAccounts.reduce((sum, cc) => {
    return sum + cc.categoryAllocations.reduce(
      (s, alloc) => s + (parseFloat(alloc.monthlyAmount) || 0),
      0
    );
  }, 0);

  // Get categories already assigned to CC
  const assignedCategoryIds = new Set(
    ccAccounts.flatMap(cc =>
      cc.categoryAllocations.map(a => a.categoryId).filter(Boolean)
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
