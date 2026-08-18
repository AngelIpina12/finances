"use client";

import ReactDOM from "react-dom";
import type { CashFlowProjection } from "@/server/actions/recurring-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface ProjectionTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
  projection?: CashFlowProjection;
  coordinate?: { x?: number; y?: number };
}

function formatCurrencySimple(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function TooltipContent({
  label,
  totalIncome,
  totalExpenses,
  hasExpenses,
  hasIncome,
  projection,
}: {
  label: string;
  totalIncome: number;
  totalExpenses: number;
  hasExpenses: boolean;
  hasIncome: boolean;
  projection: CashFlowProjection | undefined;
}) {
  if (!hasExpenses && !hasIncome) {
    return (
      <Card className="w-64 shadow-lg border-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">{label}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Income:</span>
            <span className="font-medium text-green-600">{formatCurrencySimple(totalIncome)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Expenses:</span>
            <span className="font-medium text-red-600">{formatCurrencySimple(totalExpenses)}</span>
          </div>
          <Separator />
          <div className="flex justify-between font-medium">
            <span>Net Cash Flow:</span>
            <span className={totalIncome - totalExpenses >= 0 ? "text-green-600" : "text-red-600"}>
              {formatCurrencySimple(totalIncome - totalExpenses)}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-80 shadow-lg border-2">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{label}</CardTitle>
      </CardHeader>
      <div className="max-h-96 overflow-y-auto">
        <CardContent className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Income:</span>
              <span className="font-medium text-green-600">
                {formatCurrencySimple(totalIncome)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expenses:</span>
              <span className="font-medium text-red-600">
                {formatCurrencySimple(totalExpenses)}
              </span>
            </div>
          </div>

          {/* Expense Breakdown by Credit Card */}
          {hasExpenses && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Expenses by Credit Card</h4>
              <Separator />
              {projection!.expenseBreakdown.map((cc, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between text-sm items-center">
                    <span className="font-medium">{cc.creditAccountName}</span>
                    <span className="text-red-600 font-medium">{formatCurrencySimple(cc.total)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Billing day: {cc.billingDate}
                  </p>
                  <ul className="text-xs space-y-0.5 pl-2">
                    {cc.items.map((item, i) => (
                      <li key={i} className="flex justify-between gap-4 truncate">
                        <span className="truncate">{item.name}</span>
                        <span className="text-right shrink-0">
                          {formatCurrencySimple(item.amount)}
                          {item.paymentNumber && item.totalPayments && (
                            <span className="text-muted-foreground ml-1">
                              ({item.paymentNumber}/{item.totalPayments})
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* Income Breakdown by Type */}
          {hasIncome && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Income by Type</h4>
              <Separator />
              {projection!.incomeBreakdown.map((type, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between text-sm items-center">
                    <span className="font-medium">{type.label}</span>
                    <span className="text-green-600 font-medium">{formatCurrencySimple(type.total)}</span>
                  </div>
                  <ul className="text-xs space-y-0.5 pl-2">
                    {type.items.map((item, i) => (
                      <li key={i} className="flex justify-between gap-4 truncate">
                        <span className="truncate">
                          {item.name}
                          {item.accountName && (
                            <span className="text-muted-foreground ml-1">({item.accountName})</span>
                          )}
                        </span>
                        <span className="text-right shrink-0">{formatCurrencySimple(item.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </div>
    </Card>
  );
}

export function ProjectionTooltip({
  active,
  payload,
  label,
  projection,
  coordinate,
}: ProjectionTooltipProps) {
  if (!active || !payload?.length) return null;

  const totalIncome = payload.find(p => p.dataKey === "projectedIncome")?.value || 0;
  const totalExpenses = payload.find(p => p.dataKey === "projectedExpenses")?.value || 0;

  const hasExpenses = !!(projection?.expenseBreakdown && projection.expenseBreakdown.length > 0);
  const hasIncome = !!(projection?.incomeBreakdown && projection.incomeBreakdown.length > 0);

  if (typeof document === "undefined") return null;

  const content = (
    <div
      className="z-50"
      style={{
        position: "fixed",
        left: coordinate?.x ?? 0,
        top: (coordinate?.y ?? 0) + 20,
        pointerEvents: "none",
      }}
    >
      <TooltipContent
        label={label ?? ""}
        totalIncome={totalIncome}
        totalExpenses={totalExpenses}
        hasExpenses={hasExpenses}
        hasIncome={hasIncome}
        projection={projection}
      />
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}
