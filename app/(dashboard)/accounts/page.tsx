"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Pencil, Trash2, Building2, DollarSign, Wallet, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { z } from "zod";
import { getAccounts, deleteAccount, createAccount, updateAccount, getAccount, getAccountDeletionPreview } from "@/server/actions/account-actions";
import { getAllCreditCardBillingCycles, type BillingCycleInfo } from "@/server/actions/credit-card-actions";
import type { Account } from "@/lib/db/schema";

const ACCOUNT_TYPES = [
  { value: "cash", label: "Efectivo" },
  { value: "debit", label: "Débito" },
  { value: "credit", label: "Crédito" },
] as const;

const ACCOUNT_TYPE_CONFIG = {
  cash: { label: "Efectivo", icon: DollarSign, color: "text-green-500" },
  debit: { label: "Débito", icon: Wallet, color: "text-blue-500" },
  credit: { label: "Crédito", icon: CreditCard, color: "text-purple-500" },
} as const;

const accountFormSchema = z.object({
  name: z.string().min(1, "El nombre es requerido").max(100),
  type: z.enum(["cash", "debit", "credit"]),
  currency: z.enum(["USD", "EUR", "GBP", "MXN"]),
  balance: z.string(),
  institution: z.string().optional(),
  note: z.string().optional(),
  color: z.string().optional(),
  iconUrl: z.string().optional(),
  countInAssets: z.boolean(),
  hideBalance: z.boolean(),
  creditLimit: z.string().optional(),
  owedAmount: z.string().optional(),
  billingDate: z.number().min(1).max(31).optional().nullable(),
  dueDate: z.number().min(1).max(31).optional().nullable(),
  paymentReminder: z.boolean(),
});

type AccountFormData = z.infer<typeof accountFormSchema>;

function formatCurrency(amount: string, currency: string): string {
  const num = parseFloat(amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
  }).format(num);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatBillingCycleInfo(info: BillingCycleInfo): string {
  const netOwed = parseFloat(info.netOwed) || 0;
  const owedAmount = parseFloat(info.owedAmount) || 0;
  const byTermMonthly = parseFloat(info.byTermMonthlyPayment) || 0;
  const previousCycleBalance = parseFloat(info.previousCycleBalance) || 0;
  const isShowingPreviousCycle = info.isShowingPreviousCycle;

  const lines = [
    `📅 Ciclo: ${formatDate(info.cycleStart)} - ${formatDate(info.cycleEnd)}`,
    `💳 Total cargos del mes: ${formatCurrency(info.totalCharges, info.currency)}`,
    `💵 Total pagos del mes: ${formatCurrency(info.totalPayments, info.currency)}`,
  ];

  // Show by_term monthly payment
  if (byTermMonthly > 0) {
    lines.push(`📝 Pago mensual plazos: ${formatCurrency(byTermMonthly.toString(), info.currency)}`);
  }

  // Show owedAmount if there's by_term payment balance
  if (owedAmount > 0) {
    lines.push(`📋 Resta MSI (plazos): ${formatCurrency(owedAmount.toString(), info.currency)}`);
  }

  // Total occupied = regular netOwed + MSI remaining balance
  const totalOccupied = netOwed + owedAmount;
  lines.push(
    ``,
    `💰 Total ocupado: ${formatCurrency(totalOccupied.toString(), info.currency)}`
  );

  // When showing previous cycle balance (unpaid from last cycle)
  if (isShowingPreviousCycle && previousCycleBalance > 0) {
    lines.push(
      ``,
      `⚠️ Saldo pendiente del ciclo anterior: ${formatCurrency(previousCycleBalance.toString(), info.currency)}`
    );
  }

  // Total to pay this month = regular charges + by_term monthly payment OR previous cycle balance if showing it
  const totalToPay = isShowingPreviousCycle ? previousCycleBalance : netOwed + byTermMonthly;
  lines.push(
    `📊 Total a pagar este mes: ${formatCurrency(totalToPay.toFixed(2), info.currency)}`
  );

  // Show future charges if any (>30 days from now)
  if (info.futureCharges && info.futureCharges.length > 0) {
    lines.push(``);
    lines.push(`⚠️ Cargos futuros:`);
    for (const fc of info.futureCharges) {
      lines.push(`  • ${fc.name}: ${formatCurrency(fc.amount, info.currency)} (${formatDate(fc.nextPaymentDate)})`);
    }
  }

  lines.push(
    ``,
    `⏰ Fecha límite de pago: ${formatDate(info.duePaymentDate)}`
  );

  return lines.join("\n");
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [billingCycles, setBillingCycles] = useState<Record<string, BillingCycleInfo>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteAccountId, setDeleteAccountId] = useState<string | null>(null);
  const [deletePreview, setDeletePreview] = useState<{
    transactionCount: number;
    activeRecurringPaymentsCount: number;
    recurringPayments: Array<{ id: string; name: string }>;
    investmentsCount: number;
    loansCount: number;
  } | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [modalStep, setModalStep] = useState<"type" | "form">("type");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<AccountFormData>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      name: "",
      type: "debit",
      currency: "USD",
      balance: "0.00",
      institution: "",
      note: "",
      color: "#3B82F6",
      iconUrl: "",
      countInAssets: true,
      hideBalance: false,
      creditLimit: "",
      owedAmount: "",
      billingDate: undefined,
      dueDate: undefined,
      paymentReminder: false,
    },
  });

  async function fetchAccounts() {
    try {
      setIsLoading(true);
      const [data, cycles] = await Promise.all([
        getAccounts(),
        getAllCreditCardBillingCycles(),
      ]);
      setAccounts(data);
      // Map billing cycles by account ID for easy lookup
      const cyclesMap: Record<string, BillingCycleInfo> = {};
      cycles.forEach((c) => {
        cyclesMap[c.accountId] = c;
      });
      setBillingCycles(cyclesMap);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchAccounts();
  }, []);

  async function handleDelete() {
    if (!deleteAccountId) return;
    try {
      await deleteAccount(deleteAccountId);
      setDeleteAccountId(null);
      setDeletePreview(null);
      setIsDeleteDialogOpen(false);
      await fetchAccounts();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete account");
    }
  }

  async function openDeleteDialog(accountId: string) {
    setDeleteAccountId(accountId);
    setIsLoadingPreview(true);
    setIsDeleteDialogOpen(true);
    try {
      const preview = await getAccountDeletionPreview(accountId);
      setDeletePreview({
        transactionCount: preview.transactionCount,
        activeRecurringPaymentsCount: preview.activeRecurringPaymentsCount,
        recurringPayments: preview.recurringPayments,
        investmentsCount: preview.investmentsCount,
        loansCount: preview.loansCount,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error loading preview");
      setIsDeleteDialogOpen(false);
    } finally {
      setIsLoadingPreview(false);
    }
  }

  function closeDeleteDialog() {
    setDeleteAccountId(null);
    setDeletePreview(null);
    setIsDeleteDialogOpen(false);
  }

  function openCreateModal() {
    setIsEditMode(false);
    setEditingAccount(null);
    setModalStep("type");
    form.reset({
      name: "",
      type: "debit",
      currency: "USD",
      balance: "0.00",
      institution: "",
      note: "",
      color: "#3B82F6",
      iconUrl: "",
      countInAssets: true,
      hideBalance: false,
      creditLimit: "",
      owedAmount: "",
      billingDate: undefined,
      dueDate: undefined,
      paymentReminder: false,
    });
    setIsModalOpen(true);
  }

  async function openEditModal(account: Account) {
    setIsEditMode(true);
    setEditingAccount(account);
    setIsModalOpen(true);

    // Load full account data
    try {
      const fullAccount = await getAccount(account.id);
      if (fullAccount) {
        form.reset({
          name: fullAccount.name,
          type: fullAccount.type as "cash" | "debit" | "credit",
          currency: fullAccount.currency as "USD" | "EUR" | "GBP" | "MXN",
          balance: fullAccount.balance,
          institution: fullAccount.institution || "",
          note: fullAccount.note || "",
          color: fullAccount.color || "#3B82F6",
          iconUrl: fullAccount.iconUrl || "",
          countInAssets: fullAccount.countInAssets === 1,
          hideBalance: fullAccount.hideBalance === 1,
          creditLimit: fullAccount.creditLimit || "",
          owedAmount: fullAccount.owedAmount || "",
          billingDate: fullAccount.billingDate || undefined,
          dueDate: fullAccount.dueDate || undefined,
          paymentReminder: fullAccount.paymentReminder === 1,
        });
        setModalStep("form");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error loading account");
    }
  }

  function closeModal() {
    setIsModalOpen(false);
    setIsEditMode(false);
    setEditingAccount(null);
    setModalStep("type");
    setError(null);
  }

  async function onSubmit(data: AccountFormData) {
    try {
      setIsSubmitting(true);
      setError(null);

      const submitData = {
        name: data.name,
        type: data.type,
        currency: data.currency,
        institution: data.institution || undefined,
        note: data.note || undefined,
        color: data.color || undefined,
        iconUrl: data.iconUrl || undefined,
        countInAssets: data.countInAssets,
        hideBalance: data.hideBalance,
        creditLimit: data.creditLimit || undefined,
        owedAmount: data.owedAmount || undefined,
        billingDate: data.billingDate || undefined,
        dueDate: data.dueDate || undefined,
        paymentReminder: data.paymentReminder,
      };

      if (isEditMode && editingAccount) {
        await updateAccount(editingAccount.id, {
          ...submitData,
          balance: data.balance,
        });
      } else {
        await createAccount({
          ...submitData,
          balance: data.balance,
        });
      }

      closeModal();
      await fetchAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error saving account");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleTypeSelect(type: "cash" | "debit" | "credit") {
    form.setValue("type", type);
    if (type === "cash") {
      form.setValue("iconUrl", "");
    }
    setModalStep("form");
  }

  const watchedType = form.watch("type");

  const accountsByType = {
    cash: accounts.filter((a) => a.type === "cash"),
    debit: accounts.filter((a) => a.type === "debit"),
    credit: accounts.filter((a) => a.type === "credit"),
  };

  // Only include cash and debit accounts for liquid balance (exclude credit cards)
  const liquidAccounts = accounts.filter(
    (acc) => (acc.type === "cash" || acc.type === "debit") && acc.hideBalance !== 1
  );
  const totalBalance = liquidAccounts.reduce(
    (sum, acc) => sum + (parseFloat(acc.balance) || 0),
    0
  );

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
        <h1 className="text-3xl font-bold">Cuentas</h1>
        <Button onClick={openCreateModal}>
          <Plus className="mr-2 h-4 w-4" />
          Agregar Cuenta
        </Button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-red-500 dark:bg-red-900/20">
          {error}
        </div>
      )}

      {/* Summary Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-medium">Balance Total</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">
            {formatCurrency(totalBalance.toString(), "USD")}
          </p>
          <p className="text-sm text-muted-foreground">
            En {accounts.length} cuenta{accounts.length !== 1 ? "s" : ""}
          </p>
        </CardContent>
      </Card>

      {/* Account Modal */}
      <Dialog open={isModalOpen} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="sm:max-w-125 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isEditMode ? "Editar Cuenta" : modalStep === "type" ? "Crear Cuenta" : "Crear Cuenta"}
            </DialogTitle>
            <DialogDescription>
              {isEditMode
                ? "Actualiza los datos de tu cuenta."
                : modalStep === "type"
                ? "Selecciona el tipo de cuenta que deseas crear."
                : `Creando cuenta de ${ACCOUNT_TYPES.find((t) => t.value === watchedType)?.label}`}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-500 dark:bg-red-900/20">
              {error}
            </div>
          )}

          {modalStep === "type" && !isEditMode ? (
            <div className="grid grid-cols-3 gap-4 py-4">
              {ACCOUNT_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => handleTypeSelect(type.value)}
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-border p-6 hover:border-primary hover:bg-accent transition-colors"
                >
                  <span className="text-2xl mb-2">
                    {type.value === "cash" ? "💵" : type.value === "debit" ? "💳" : "💳"}
                  </span>
                  <span className="font-medium">{type.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}>
              {/* Nombre */}
              <div className="space-y-2">
                <Label htmlFor="name">Nombre</Label>
                <Input
                  id="name"
                  placeholder="e.g., Cuenta Principal"
                  {...form.register("name")}
                />
                {form.formState.errors.name && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Moneda */}
                <div className="space-y-2">
                  <Label>Moneda</Label>
                  <Select
                    value={form.watch("currency")}
                    onValueChange={(value) =>
                      form.setValue("currency", value as AccountFormData["currency"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                      <SelectItem value="MXN">MXN</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Balance */}
                <div className="space-y-2">
                  <Label htmlFor="balance">Balance</Label>
                  <Input
                    id="balance"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    {...form.register("balance")}
                  />
                </div>
              </div>

              {/* Institución */}
              <div className="space-y-2">
                <Label htmlFor="institution">Institución (Opcional)</Label>
                <Input
                  id="institution"
                  placeholder="e.g., BBVA, Chase"
                  {...form.register("institution")}
                />
              </div>

              {/* Nota */}
              <div className="space-y-2">
                <Label htmlFor="note">Nota (Opcional)</Label>
                <Input
                  id="note"
                  placeholder="Agregar una nota..."
                  {...form.register("note")}
                />
              </div>

              {/* Color */}
              <div className="space-y-2">
                <Label htmlFor="color">Color</Label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    {...form.register("color")}
                    className="h-10 w-14 rounded border cursor-pointer"
                  />
                  <Input
                    id="color"
                    placeholder="#3B82F6"
                    {...form.register("color")}
                    className="flex-1"
                  />
                </div>
              </div>

              {/* Icono (para débito y crédito) */}
              {(watchedType === "debit" || watchedType === "credit") && (
                <div className="space-y-2">
                  <Label htmlFor="iconUrl">URL del Ícono (Opcional)</Label>
                  <Input
                    id="iconUrl"
                    placeholder="https://res.cloudinary.com/..."
                    {...form.register("iconUrl")}
                  />
                  <p className="text-xs text-muted-foreground">
                    Sube tu imagen a Cloudinary y pega la URL aquí.
                  </p>
                </div>
              )}

              {/* Switches para Débito, Efectivo y Crédito */}
              {(watchedType === "debit" || watchedType === "cash" || watchedType === "credit") && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="countInAssets">Contar en Activo</Label>
                      <p className="text-sm text-muted-foreground">
                        Incluir en valor neto, ingresos y gastos
                      </p>
                    </div>
                    <Switch
                      id="countInAssets"
                      checked={form.watch("countInAssets")}
                      onCheckedChange={(checked) =>
                        form.setValue("countInAssets", checked)
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="hideBalance">Ocultar saldo</Label>
                      <p className="text-sm text-muted-foreground">
                        No mostrar el saldo en la página de la cuenta
                      </p>
                    </div>
                    <Switch
                      id="hideBalance"
                      checked={form.watch("hideBalance")}
                      onCheckedChange={(checked) =>
                        form.setValue("hideBalance", checked)
                      }
                    />
                  </div>
                </>
              )}

              {/* Campos específicos para Crédito */}
              {watchedType === "credit" && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="creditLimit">Límite de Crédito</Label>
                      <Input
                        id="creditLimit"
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...form.register("creditLimit")}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="owedAmount">Adeudado</Label>
                      <Input
                        id="owedAmount"
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...form.register("owedAmount")}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="billingDate">Día de Facturación</Label>
                      <Select
                        value={form.watch("billingDate")?.toString() ?? ""}
                        onValueChange={(value) =>
                          form.setValue("billingDate", value ? parseInt(value) : undefined)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar día" />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                            <SelectItem key={day} value={day.toString()}>
                              {day}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="dueDate">Día de Vencimiento</Label>
                      <Select
                        value={form.watch("dueDate")?.toString() ?? ""}
                        onValueChange={(value) =>
                          form.setValue("dueDate", value ? parseInt(value) : undefined)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar día" />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                            <SelectItem key={day} value={day.toString()}>
                              {day}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="paymentReminder">Recordatorio de Pago</Label>
                      <p className="text-sm text-muted-foreground">
                        Recibir recordatorio antes del vencimiento
                      </p>
                    </div>
                    <Switch
                      id="paymentReminder"
                      checked={form.watch("paymentReminder")}
                      onCheckedChange={(checked) =>
                        form.setValue("paymentReminder", checked)
                      }
                    />
                  </div>
                </>
              )}

              <div className="flex justify-between pt-4">
                {!isEditMode && modalStep === "form" && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setModalStep("type")}
                    disabled={isSubmitting}
                  >
                    Atrás
                  </Button>
                )}
                <div className="ml-auto flex gap-2">
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
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Accounts by Type */}
      {accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-medium">No hay cuentas</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Crea tu primera cuenta para comenzar a rastrear tus finanzas.
            </p>
            <Button onClick={openCreateModal}>
              <Plus className="mr-2 h-4 w-4" />
              Agregar Cuenta
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          {/* Efectivo */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <DollarSign className={`h-5 w-5 ${ACCOUNT_TYPE_CONFIG.cash.color}`} />
                <CardTitle className="text-lg">Efectivo</CardTitle>
                <Badge variant="secondary" className="ml-auto">
                  {accountsByType.cash.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {accountsByType.cash.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No hay cuentas de efectivo
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="w-20">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accountsByType.cash.map((account) => (
                      <TableRow key={account.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: account.color || "#3B82F6" }}
                            />
                            <span className="font-medium">{account.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {account.hideBalance === 1 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            formatCurrency(account.balance, account.currency)
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
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
                              onClick={() => openDeleteDialog(account.id)}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Débito */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Wallet className={`h-5 w-5 ${ACCOUNT_TYPE_CONFIG.debit.color}`} />
                <CardTitle className="text-lg">Débito</CardTitle>
                <Badge variant="secondary" className="ml-auto">
                  {accountsByType.debit.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {accountsByType.debit.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No hay cuentas de débito
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="w-20">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accountsByType.debit.map((account) => (
                      <TableRow key={account.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: account.color || "#3B82F6" }}
                            />
                            <span className="font-medium">{account.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {account.hideBalance === 1 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            formatCurrency(account.balance, account.currency)
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
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
                              onClick={() => openDeleteDialog(account.id)}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Crédito */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <CreditCard className={`h-5 w-5 ${ACCOUNT_TYPE_CONFIG.credit.color}`} />
                <CardTitle className="text-lg">Crédito</CardTitle>
                <Badge variant="secondary" className="ml-auto">
                  {accountsByType.credit.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {accountsByType.credit.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No hay cuentas de crédito
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="w-20">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accountsByType.credit.map((account) => (
                      <TableRow key={account.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: account.color || "#3B82F6" }}
                            />
                            <span className="font-medium">{account.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {billingCycles[account.id] && (parseFloat(billingCycles[account.id].netOwed) > 0 || parseFloat(billingCycles[account.id].owedAmount) > 0 || parseFloat(billingCycles[account.id].byTermMonthlyPayment) > 0) && (
                              <Badge variant="destructive" className="text-xs font-medium">
                                ADEUDO
                              </Badge>
                            )}
                            {account.hideBalance === 1 ? (
                              <span className="text-muted-foreground">—</span>
                            ) : billingCycles[account.id] ? (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <span className="cursor-help underline decoration-dotted font-medium">
                                    {formatCurrency(
                                      billingCycles[account.id].isShowingPreviousCycle
                                        ? billingCycles[account.id].previousCycleBalance
                                        : (parseFloat(billingCycles[account.id].netOwed) + parseFloat(billingCycles[account.id].byTermMonthlyPayment)).toString(),
                                      account.currency
                                    )}
                                  </span>
                                </PopoverTrigger>
                                <PopoverContent className="w-80 whitespace-pre-line text-sm">
                                  <div className="space-y-2">
                                    <div className="font-semibold border-b pb-2">
                                      {account.name}
                                    </div>
                                    <div className="text-muted-foreground">
                                      {formatBillingCycleInfo(billingCycles[account.id])}
                                    </div>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            ) : (
                              <span className="font-medium">{formatCurrency(account.balance, account.currency)}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
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
                              onClick={() => openDeleteDialog(account.id)}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Delete Account Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={(open) => !open && closeDeleteDialog()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar Cuenta</AlertDialogTitle>
            <AlertDialogDescription asChild>
              {isLoadingPreview ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : deletePreview ? (
                <div className="space-y-3">
                  <p>
                    ¿Estás seguro de eliminar esta cuenta? Esta acción no se puede deshacer.
                  </p>
                  {deletePreview.transactionCount > 0 && (
                    <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3 text-sm">
                      <p className="font-medium text-blue-700 dark:text-blue-300">
                        📋 {deletePreview.transactionCount} transacción{deletePreview.transactionCount !== 1 ? "es" : ""} histórica{deletePreview.transactionCount !== 1 ? "s" : ""} se conservarán
                      </p>
                    </div>
                  )}
                  {deletePreview.activeRecurringPaymentsCount > 0 && (
                    <div className="space-y-2">
                      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-sm">
                        <p className="font-medium text-amber-700 dark:text-amber-300">
                          ⚠️ {deletePreview.activeRecurringPaymentsCount} pago{deletePreview.activeRecurringPaymentsCount !== 1 ? "s" : ""} recurrentes serán cancelado{deletePreview.activeRecurringPaymentsCount !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <ul className="ml-4 list-disc text-xs text-muted-foreground">
                        {deletePreview.recurringPayments.map((rp) => (
                          <li key={rp.id}>{rp.name}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {deletePreview.investmentsCount > 0 && (
                    <p className="text-sm text-muted-foreground">
                      💼 {deletePreview.investmentsCount} inversión{deletePreview.investmentsCount !== 1 ? "es" : ""} vinculada{deletePreview.investmentsCount !== 1 ? "s" : ""} se desvinculada{deletePreview.investmentsCount !== 1 ? "s" : ""}
                    </p>
                  )}
                  {deletePreview.loansCount > 0 && (
                    <p className="text-sm text-muted-foreground">
                      🏦 {deletePreview.loansCount} préstamo{deletePreview.loansCount !== 1 ? "s" : ""} vinculado{deletePreview.loansCount !== 1 ? "s" : ""} se{deletePreview.loansCount !== 1 ? "desvinculan" : "desvincula"}rá
                    </p>
                  )}
                </div>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeDeleteDialog}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-500 hover:bg-red-600"
              disabled={isLoadingPreview}
            >
              {isLoadingPreview ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Eliminar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
