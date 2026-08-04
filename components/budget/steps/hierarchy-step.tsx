"use client";

import { UseFormReturn } from "react-hook-form";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface HierarchyStepProps {
  form: UseFormReturn<any>;
}

const ROLLOVER_OPTIONS = [
  { value: "disabled", label: "No rollover" },
  { value: "carry_unused", label: "Carry unused forward" },
  { value: "carry_unused_plus_overspend", label: "Carry unused + overspend" },
  { value: "carry_overspend_only", label: "Carry overspend only" },
];

export function HierarchyStep({ form }: HierarchyStepProps) {
  const isGlobal = form.watch("isGlobal");

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
          className={`w-full p-4 border rounded-lg text-left transition-colors ${
            isGlobal
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50"
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                isGlobal ? "border-primary bg-primary" : "border-muted-foreground"
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
          className={`w-full p-4 border rounded-lg text-left transition-colors ${
            !isGlobal
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50"
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                !isGlobal ? "border-primary bg-primary" : "border-muted-foreground"
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
}
