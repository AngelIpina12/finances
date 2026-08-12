"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Pencil, Trash2, TrendingUp, PiggyBank, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { z } from "zod";
import {
  getFixedIncomeAccounts,
  createFixedIncomeAccount,
  updateFixedIncomeAccount,
  deleteFixedIncomeAccount,
} from "@/server/actions/fixed-income-actions";
import { getAccounts } from "@/server/actions/account-actions";
import type { FixedIncomeAccount, Account } from "@/lib/db/schema";
import Decimal from "decimal.js";

const fixedIncomeFormSchema = z.object({
  name: z.string().min(1, "El nombre es requerido").max(100),
  linkedAccountId: z.string().uuid("Selecciona una cuenta"),
  currency: z.enum(["USD", "EUR", "GBP", "MXN"]),
  initialInterestRate: z.string().min(1, "La tasa de interés es requerida"),
  initialAmountLimit: z.string().min(1, "El límite de cantidad es requerido"),
  originalPrincipal: z.string().min(1, "El capital original es requerido"),
  hasSecondTier: z.boolean(),
  secondInterestRate: z.string().optional(),
  secondAmountLimit: z.string().optional().nullable(),
  compoundFirstTier: z.boolean(),
});

type FixedIncomeFormData = z.infer<typeof fixedIncomeFormSchema>;

type FixedIncomeAccountWithLinked = FixedIncomeAccount & { linkedAccount?: Account };

interface InterestCalculationResult {
  tier1Interest: string;
  tier2Interest: string;
  totalDailyInterest: string;
  effectiveRate: string;
  tier1Balance: string;
  tier2Balance: string;
  tier1BalanceProjected: string;
  tier2BalanceProjected: string;
}

function formatCurrency(amount: string, currency: string): string {
  const num = parseFloat(amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
  }).format(num);
}

function formatInterestSmall(amount: string, currency: string): string {
  // Show up to 4 decimal places so small Tier 2 interest is visible
  const num = parseFloat(amount);
  if (num === 0) return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
  }).format(0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(num);
}

function calculateEffectiveRate(
  balance: Decimal,
  initialRate: string,
  initialLimit: string,
  principalBase: string,
  accumulatedInterest: string,
  secondRate: string | null,
  secondLimit: string | null,
  compoundFirstTier: boolean,
  days: number = 1
): InterestCalculationResult {
  const balanceNum = new Decimal(balance);
  const initialRateNum = new Decimal(initialRate);
  const initialLimitNum = new Decimal(initialLimit);
  const principalBaseNum = new Decimal(principalBase);
  const secondRateNum = secondRate ? new Decimal(secondRate) : null;
  const secondLimitNum = secondLimit ? new Decimal(secondLimit) : null;

  let tier1Balance: Decimal;
  let tier2Balance: Decimal;

  // Determine if we have a second tier active
  const hasSecondTierActive = secondRateNum !== null;

  if (compoundFirstTier && !hasSecondTierActive) {
    // Compound without second tier: principal stays in Tier 1
    tier1Balance = balanceNum;
    tier2Balance = new Decimal(0);
  } else if (compoundFirstTier && hasSecondTierActive) {
    // Compound WITH second tier: derive principals from current balance
    // Tier 1 = up to limit, Tier 2 = excess over limit
    tier1Balance = Decimal.min(balanceNum, initialLimitNum);
    tier2Balance = Decimal.max(new Decimal(0), balanceNum.minus(initialLimitNum));
  } else {
    // Simple interest (non-compound): derive principals from current balance
    tier1Balance = Decimal.min(balanceNum, initialLimitNum);
    tier2Balance = Decimal.max(new Decimal(0), balanceNum.minus(initialLimitNum));
  }

  const dailyRate1 = initialRateNum.dividedBy(365).dividedBy(100);
  let tier1Interest: Decimal;
  let tier2Interest = new Decimal(0);
  let tier2BalanceForCalc = tier2Balance;

  if (compoundFirstTier) {
    // Compound interest for Tier 1: principal * ((1 + rate/365)^days - 1)
    tier1Interest = tier1Balance.times(new Decimal(1).plus(dailyRate1).pow(days)).minus(tier1Balance);
  } else {
    // Simple interest for Tier 1
    tier1Interest = tier1Balance.times(dailyRate1).times(days);
  }

  if (tier2BalanceForCalc.greaterThan(0) && secondRateNum) {
    const dailyRate2 = secondRateNum.dividedBy(365).dividedBy(100);

    if (secondLimitNum) {
      tier2BalanceForCalc = Decimal.min(tier2BalanceForCalc, secondLimitNum);
    }

    // Tier 2 always uses simple interest
    tier2Interest = tier2BalanceForCalc.times(dailyRate2).times(days);
  }

  const totalDailyInterest = tier1Interest.plus(tier2Interest);
  const effectiveRate = totalDailyInterest.dividedBy(balanceNum).times(365).times(100);

  // Projected = principal + interest for each tier
  // For compound Tier 1: use compound formula
  // For simple Tier 2: use simple formula
  let tier1BalanceProjected: Decimal;
  let tier2BalanceProjected: Decimal;

  if (compoundFirstTier) {
    tier1BalanceProjected = tier1Balance.times(new Decimal(1).plus(dailyRate1).pow(days));
  } else {
    tier1BalanceProjected = tier1Balance.plus(tier1Interest);
  }

  if (tier2Balance.greaterThan(0)) {
    if (compoundFirstTier) {
      // When compound is active, Tier 2 = balance - Tier 1 projected, then apply simple interest
      const tier2Base = balanceNum.minus(tier1BalanceProjected);
      const dailyRate2 = secondRateNum!.dividedBy(365).dividedBy(100);
      tier2BalanceProjected = tier2Base.times(new Decimal(1).plus(dailyRate2.times(days)));
    } else {
      tier2BalanceProjected = tier2Balance.plus(tier2Interest);
    }
  } else {
    tier2BalanceProjected = new Decimal(0);
  }

  return {
    tier1Interest: tier1Interest.toString(),
    tier2Interest: tier2Interest.toString(),
    totalDailyInterest: totalDailyInterest.toString(),
    effectiveRate: effectiveRate.toString(),
    tier1Balance: tier1Balance.toString(),
    tier2Balance: tier2Balance.greaterThan(0) ? tier2Balance.toString() : "0",
    tier1BalanceProjected: tier1BalanceProjected.toString(),
    tier2BalanceProjected: tier2BalanceProjected.greaterThan(0) ? tier2BalanceProjected.toString() : "0",
  };
}

export default function InvestmentsPage() {
  const [activeTab, setActiveTab] = useState<"stocks" | "fixed_income">("fixed_income");
  const [fixedIncomeAccounts, setFixedIncomeAccounts] = useState<FixedIncomeAccountWithLinked[]>([]);
  const [debitAccounts, setDebitAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingAccount, setEditingAccount] = useState<FixedIncomeAccountWithLinked | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteAccountId, setDeleteAccountId] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const form = useForm<FixedIncomeFormData>({
    resolver: zodResolver(fixedIncomeFormSchema),
    defaultValues: {
      name: "",
      linkedAccountId: "",
      currency: "USD",
      initialInterestRate: "",
      initialAmountLimit: "",
      hasSecondTier: false,
      secondInterestRate: "",
      secondAmountLimit: "",
    },
  });

  async function fetchData() {
    try {
      setIsLoading(true);
      const [fiAccounts, accountsData] = await Promise.all([
        getFixedIncomeAccounts(),
        getAccounts(),
      ]);
      setFixedIncomeAccounts(fiAccounts);
      setDebitAccounts(accountsData.filter((a) => a.type === "debit"));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  function openCreateModal() {
    setIsEditMode(false);
    setEditingAccount(null);
    form.reset({
      name: "",
      linkedAccountId: "",
      currency: "USD",
      initialInterestRate: "",
      initialAmountLimit: "",
      originalPrincipal: "",
      hasSecondTier: false,
      secondInterestRate: "",
      secondAmountLimit: "",
      compoundFirstTier: true,
    });
    setIsModalOpen(true);
  }

  function openEditModal(account: FixedIncomeAccountWithLinked) {
    setIsEditMode(true);
    setEditingAccount(account);
    form.reset({
      name: account.name,
      linkedAccountId: account.linkedAccountId,
      currency: account.currency as "USD" | "EUR" | "GBP" | "MXN",
      initialInterestRate: account.initialInterestRate,
      initialAmountLimit: account.initialAmountLimit,
      originalPrincipal: account.originalPrincipal || "0",
      hasSecondTier: account.hasSecondTier === 1,
      secondInterestRate: account.secondInterestRate || "",
      secondAmountLimit: account.secondAmountLimit || "",
      compoundFirstTier: account.compoundFirstTier === 1,
    });
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setIsEditMode(false);
    setEditingAccount(null);
    setError(null);
  }

  async function onSubmit(data: FixedIncomeFormData) {
    try {
      setIsSubmitting(true);
      setError(null);

      if (isEditMode && editingAccount) {
        await updateFixedIncomeAccount(editingAccount.id, {
          name: data.name,
          initialInterestRate: data.initialInterestRate,
          initialAmountLimit: data.initialAmountLimit,
          hasSecondTier: data.hasSecondTier,
          secondInterestRate: data.secondInterestRate || undefined,
          secondAmountLimit: data.secondAmountLimit || undefined,
          compoundFirstTier: data.compoundFirstTier,
        });
      } else {
        await createFixedIncomeAccount({
          name: data.name,
          linkedAccountId: data.linkedAccountId,
          currency: data.currency,
          initialInterestRate: data.initialInterestRate,
          initialAmountLimit: data.initialAmountLimit,
          originalPrincipal: data.originalPrincipal,
          hasSecondTier: data.hasSecondTier,
          secondInterestRate: data.secondInterestRate || undefined,
          secondAmountLimit: data.secondAmountLimit || undefined,
          compoundFirstTier: data.compoundFirstTier,
        });
      }

      closeModal();
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error saving account");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteAccountId) return;
    try {
      await deleteFixedIncomeAccount(deleteAccountId);
      setDeleteAccountId(null);
      setIsDeleteDialogOpen(false);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete account");
    }
  }

  const watchedHasSecondTier = form.watch("hasSecondTier");
  const watchedLinkedAccountId = form.watch("linkedAccountId");
  const watchedInitialRate = form.watch("initialInterestRate");
  const watchedInitialLimit = form.watch("initialAmountLimit");
  const watchedSecondRate = form.watch("secondInterestRate");
  const watchedSecondLimit = form.watch("secondAmountLimit");

  const selectedDebitAccount = debitAccounts.find((a) => a.id === watchedLinkedAccountId);
  const selectedDebitBalance = selectedDebitAccount ? new Decimal(selectedDebitAccount.balance) : new Decimal(0);

  // Use account values when editing, otherwise use form values for new accounts
  const previewOriginalPrincipal = isEditMode && editingAccount ? editingAccount.originalPrincipal || "0" : "0";
  const previewPrincipalBase = isEditMode && editingAccount ? (editingAccount as any).principalBase || previewOriginalPrincipal : previewOriginalPrincipal;
  const previewAccumulatedInterest = isEditMode && editingAccount ? editingAccount.accumulatedInterest || "0" : "0";
  const previewCompoundFirstTier = isEditMode && editingAccount ? editingAccount.compoundFirstTier === 1 : true;
  const previewLastAccrualDate = isEditMode && editingAccount ? editingAccount.lastAccrualDate : null;

  // Show projected balances (with compound interest) when compoundFirstTier is enabled
  const showProjectedBalances = previewCompoundFirstTier;

  // Preview "what if": when compoundFirstTier is true, Tier 1 = full balance (ignoring limit)
  const previewTier1Balance = previewCompoundFirstTier ? selectedDebitBalance : new Decimal(previewOriginalPrincipal);

  // When compound is active, show 3 days of projected compound growth in the preview
  const previewDays = previewCompoundFirstTier ? 3 : 1;

  const previewCalculation =
    selectedDebitBalance.greaterThan(0) && watchedInitialRate && watchedInitialLimit
      ? calculateEffectiveRate(
          selectedDebitBalance,
          watchedInitialRate,
          watchedInitialLimit,
          previewPrincipalBase,
          previewAccumulatedInterest,
          watchedHasSecondTier ? (watchedSecondRate || null) : null,
          watchedSecondLimit || null,
          previewCompoundFirstTier,
          previewDays
        )
      : null;

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
        <h1 className="text-3xl font-bold">Investments</h1>
        {activeTab === "fixed_income" && (
          <Button onClick={openCreateModal}>
            <Plus className="mr-2 h-4 w-4" />
            Agregar Renta Fija
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-red-500 dark:bg-red-900/20">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        <button
          onClick={() => setActiveTab("stocks")}
          className={cn(
            "px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "stocks"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <TrendingUp className="mr-2 h-4 w-4 inline" />
          Acciones / ETFs
        </button>
        <button
          onClick={() => setActiveTab("fixed_income")}
          className={cn(
            "px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "fixed_income"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <PiggyBank className="mr-2 h-4 w-4 inline" />
          Renta Fija
        </button>
      </div>

      {/* Stocks/ETFs Tab - Placeholder */}
      {activeTab === "stocks" && (
        <Card>
          <CardHeader>
            <CardTitle>Portfolio</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground py-8 text-center">
             coming soon...
            </p>
          </CardContent>
        </Card>
      )}

      {/* Fixed Income Tab */}
      {activeTab === "fixed_income" && (
        <>
          {fixedIncomeAccounts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <PiggyBank className="mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="mb-2 text-lg font-medium">No hay cuentas de renta fija</h3>
                <p className="mb-4 text-sm text-muted-foreground">
                  Crea tu primera cuenta de renta fija para comenzar a trackear tus inversiones.
                </p>
                <Button onClick={openCreateModal}>
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar Renta Fija
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {fixedIncomeAccounts.map((account) => {
                const linkedBalance = account.linkedAccount
                  ? new Decimal(account.linkedAccount.balance)
                  : new Decimal(0);
                const calculation = calculateEffectiveRate(
                  linkedBalance,
                  account.initialInterestRate,
                  account.initialAmountLimit,
                  account.originalPrincipal || "0",
                  account.accumulatedInterest || "0",
                  account.hasSecondTier === 1 ? (account.secondInterestRate || null) : null,
                  account.secondAmountLimit || null,
                  account.compoundFirstTier === 1
                );

                return (
                  <Card key={account.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <PiggyBank className="h-5 w-5 text-green-500" />
                          <CardTitle className="text-lg">{account.name}</CardTitle>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditModal(account)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setDeleteAccountId(account.id);
                              setIsDeleteDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Linked Account */}
                      <div className="text-sm">
                        <span className="text-muted-foreground">Cuenta vinculada: </span>
                        <span className="font-medium">{account.linkedAccount?.name || "N/A"}</span>
                      </div>

                      {/* Current Balance */}
                      <div>
                        <p className="text-sm text-muted-foreground">Balance Actual</p>
                        <p className="text-2xl font-bold">
                          {formatCurrency(account.linkedAccount?.balance || "0", account.currency)}
                        </p>
                      </div>

                      {/* Accumulated Interest */}
                      <div>
                        <p className="text-sm text-muted-foreground">Interés Acumulado</p>
                        <p className="text-xl font-semibold text-green-600">
                          +{formatCurrency(account.accumulatedInterest, account.currency)}
                        </p>
                      </div>

                      {/* Effective Rate */}
                      <div className="rounded-lg bg-muted p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Tasa Efectiva</span>
                          <span className="text-xl font-bold">{parseFloat(calculation.effectiveRate).toFixed(2)}%</span>
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          Interés diario: +{formatInterestSmall(calculation.totalDailyInterest, account.currency)}
                        </div>
                      </div>

                      {/* Tier Breakdown */}
                      <div className="space-y-2 border-t pt-3">
                        <p className="text-sm font-medium">Configuración de Tasas</p>

                        <div className="rounded-md bg-green-50 dark:bg-green-900/20 p-2 text-sm">
                          <div className="flex justify-between">
                            <span>Tier 1: {account.initialInterestRate}%</span>
                            <span className="text-muted-foreground">≤ {formatCurrency(account.initialAmountLimit, account.currency)}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Genera: {formatCurrency(calculation.tier1Interest, account.currency)}/día
                          </div>
                        </div>

                        {account.hasSecondTier === 1 && account.secondInterestRate && (
                          <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 p-2 text-sm">
                            <div className="flex justify-between">
                              <span>Tier 2: {account.secondInterestRate}%</span>
                              <span className="text-muted-foreground">
                                {account.secondAmountLimit
                                  ? `≤ ${formatCurrency(account.secondAmountLimit, account.currency)}`
                                  : "Sin límite"}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Genera: {formatInterestSmall(calculation.tier2Interest, account.currency)}/día
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Create/Edit Modal */}
      <Dialog open={isModalOpen} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="sm:max-w-125 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isEditMode ? "Editar Cuenta de Renta Fija" : "Crear Cuenta de Renta Fija"}
            </DialogTitle>
            <DialogDescription>
              {isEditMode
                ? "Actualiza la configuración de tu cuenta de renta fija."
                : "Configura tu cuenta de renta fija con las tasas de interés."}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-500 dark:bg-red-900/20">
              {error}
            </div>
          )}

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}>
            {!isEditMode && (
              <div className="space-y-2">
                <Label>Cuenta Vinculada (Débito)</Label>
                <Select
                  value={form.watch("linkedAccountId")}
                  onValueChange={(value) => form.setValue("linkedAccountId", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona una cuenta de débito" />
                  </SelectTrigger>
                  <SelectContent>
                    {debitAccounts.length === 0 ? (
                      <SelectItem value="none" disabled>
                        No hay cuentas de débito disponibles
                      </SelectItem>
                    ) : (
                      debitAccounts.map((acc) => (
                        <SelectItem key={acc.id} value={acc.id}>
                          {acc.name} - {formatCurrency(acc.balance, acc.currency)}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {form.formState.errors.linkedAccountId && (
                  <p className="text-sm text-red-500">{form.formState.errors.linkedAccountId.message}</p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input
                id="name"
                placeholder="e.g., CETES, Fondos de Inversión"
                {...form.register("name")}
              />
              {form.formState.errors.name && (
                <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Moneda</Label>
                <Select
                  value={form.watch("currency")}
                  onValueChange={(value) => form.setValue("currency", value as FixedIncomeFormData["currency"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                    <SelectItem value="MXN">MXN</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Capital Original */}
            <div className="space-y-2">
              <Label htmlFor="originalPrincipal">Capital Original (Depósitos)</Label>
              <Input
                id="originalPrincipal"
                type="number"
                step="0.01"
                placeholder="e.g., 25000"
                {...form.register("originalPrincipal")}
              />
              <p className="text-xs text-muted-foreground">
                El monto de tu inversión inicial. Los intereses generados permanecen en este tier.
              </p>
              {form.formState.errors.originalPrincipal && (
                <p className="text-sm text-red-500">{form.formState.errors.originalPrincipal.message}</p>
              )}
            </div>

            {/* Tier 1 Configuration */}
            <div className="space-y-3 rounded-lg border p-4">
              <p className="font-medium">Tier 1 - Tasa de Interés sobre Capital + Intereses</p>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="initialInterestRate">Tasa de Interés Anual (%)</Label>
                  <Input
                    id="initialInterestRate"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 13"
                    {...form.register("initialInterestRate")}
                  />
                  {form.formState.errors.initialInterestRate && (
                    <p className="text-sm text-red-500">{form.formState.errors.initialInterestRate.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="initialAmountLimit">Límite de Cantidad</Label>
                  <Input
                    id="initialAmountLimit"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 25000"
                    {...form.register("initialAmountLimit")}
                  />
                  {form.formState.errors.initialAmountLimit && (
                    <p className="text-sm text-red-500">{form.formState.errors.initialAmountLimit.message}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Compound First Tier Switch */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="compoundFirstTier">Interés compuesto en Tier 1</Label>
                <p className="text-sm text-muted-foreground">
                  Activa para que el interés se acumule en el Tier 1 (compuesto). Desactiva para interés simple.
                </p>
              </div>
              <Switch
                id="compoundFirstTier"
                checked={form.watch("compoundFirstTier")}
                onCheckedChange={(checked) => form.setValue("compoundFirstTier", checked)}
              />
            </div>

            {/* Second Tier Switch */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="hasSecondTier">¿Dos tasas de interés?</Label>
                <p className="text-sm text-muted-foreground">
                  Activa si quieres diferentes tasas según el monto
                </p>
              </div>
              <Switch
                id="hasSecondTier"
                checked={form.watch("hasSecondTier")}
                onCheckedChange={(checked) => form.setValue("hasSecondTier", checked)}
              />
            </div>

            {/* Second Tier Configuration */}
            {watchedHasSecondTier && (
              <div className="space-y-3 rounded-lg border p-4">
                <p className="font-medium">Tier 2 - Segunda Tasa de Interés</p>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="secondInterestRate">Tasa de Interés Anual (%)</Label>
                    <Input
                      id="secondInterestRate"
                      type="number"
                      step="0.01"
                      placeholder="e.g., 6.5"
                      {...form.register("secondInterestRate")}
                    />
                    {form.formState.errors.secondInterestRate && (
                      <p className="text-sm text-red-500">{form.formState.errors.secondInterestRate.message}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="secondAmountLimit">Segundo Límite (Opcional)</Label>
                    <Input
                      id="secondAmountLimit"
                      type="number"
                      step="0.01"
                      placeholder="Vacío = sin límite"
                      {...form.register("secondAmountLimit")}
                    />
                    <p className="text-xs text-muted-foreground">
                      Si lo dejas vacío, no habrá límite superior
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Preview Calculation */}
            {previewCalculation && selectedDebitBalance.greaterThan(0) && (
              <div className="rounded-lg bg-muted p-4 space-y-2">
                <p className="font-medium flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Preview - Balance: {formatCurrency(selectedDebitBalance.toString(), form.watch("currency"))}
                </p>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Interés Diario Total</p>
                    <p className="font-semibold text-green-600">
                      +{formatCurrency(previewCalculation.totalDailyInterest, form.watch("currency"))}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Tasa Efectiva</p>
                    <p className="font-semibold">{parseFloat(previewCalculation.effectiveRate).toFixed(2)}%</p>
                  </div>
                </div>

                <div className="space-y-1 border-t pt-2 mt-2">
                  <div className="flex justify-between text-sm">
                    <span>Tier 1 ({form.watch("initialInterestRate")}%)</span>
                    <span className="font-medium">
                      {showProjectedBalances
                        ? formatCurrency(previewCalculation.tier1BalanceProjected, form.watch("currency"))
                        : formatCurrency(previewCalculation.tier1Balance, form.watch("currency"))}
                    </span>
                  </div>
                  {parseFloat(previewCalculation.tier2Balance) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span>Tier 2 ({form.watch("secondInterestRate") || "0"}%)</span>
                      <span className="font-medium">
                        {showProjectedBalances
                          ? formatCurrency(previewCalculation.tier2BalanceProjected, form.watch("currency"))
                          : formatCurrency(previewCalculation.tier2Balance, form.watch("currency"))}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={closeModal}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditMode ? "Actualizar" : "Crear"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={(open) => !open && setIsDeleteDialogOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar Cuenta de Renta Fija</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de eliminar esta cuenta de renta fija? Esta acción no se puede deshacer.
              El historial de intereses acumulado se perderá.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setIsDeleteDialogOpen(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-500 hover:bg-red-600">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
