"use client";

import { UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface BasicInfoStepProps {
  form: UseFormReturn<any>;
}

const PERIOD_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annually", label: "Annually" },
];

export function BasicInfoStep({ form }: BasicInfoStepProps) {
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
              className={`w-3 h-3 rounded-full ${
                form.watch("type") === "income" ? "bg-green-500" : "bg-red-500"
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
}
