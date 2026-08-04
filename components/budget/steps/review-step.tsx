"use client";

import { UseFormReturn } from "react-hook-form";

interface ReviewStepProps {
  form: UseFormReturn<any>;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

const PERIOD_LABELS: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
};

const ROLLOVER_LABELS: Record<string, string> = {
  disabled: "Disabled",
  carry_unused: "Carry Unused",
  carry_unused_plus_overspend: "Carry Unused + Overspend",
  carry_overspend_only: "Carry Overspend Only",
};

export function ReviewStep({ form }: ReviewStepProps) {
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
                className={`ml-2 font-medium ${
                  data.type === "income" ? "text-green-600" : "text-red-600"
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
