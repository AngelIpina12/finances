"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, ArrowUpCircle, ArrowDownCircle, Trash2, ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { z } from "zod";
import {
  createTransaction,
  deleteTransaction,
  getTransactions,
} from "@/server/actions/transaction-actions";
import { getAccounts } from "@/server/actions/account-actions";
import { getCategories } from "@/server/actions/category-actions";
import { getTagsByCategory } from "@/server/actions/tag-actions";
import type { Transaction, Account, Category, Tag } from "@/lib/db/schema";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";

const transactionFormSchema = z.object({
  accountId: z.string().min(1, "La cuenta de origen es requerida"),
  type: z.enum(["income", "expense", "transfer"]),
  categoryId: z.string().optional(),
  amount: z.string().min(1, "El monto es requerido"),
  description: z.string().optional(),
  tagIds: z.array(z.string()).optional(),
  date: z.date(),
  transferAccountId: z.string().optional(),
});

type TransactionFormData = z.infer<typeof transactionFormSchema>;

type TransactionStep = "type" | "category" | "form";

const TYPE_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  income: "default",
  expense: "destructive",
  transfer: "secondary",
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  income: <ArrowUpCircle className="h-4 w-4 text-green-500" />,
  expense: <ArrowDownCircle className="h-4 w-4 text-red-500" />,
  transfer: <ArrowLeftRight className="h-4 w-4 text-blue-500" />,
};

function formatCurrency(amount: string): string {
  const num = parseFloat(amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(num);
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryTags, setCategoryTags] = useState<Record<string, Tag[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filterAccountId, setFilterAccountId] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");

  // Modal state - 3 step flow
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<TransactionStep>("type");
  const [selectedType, setSelectedType] = useState<"income" | "expense" | "transfer" | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  const form = useForm<TransactionFormData>({
    resolver: zodResolver(transactionFormSchema),
    defaultValues: {
      accountId: "",
      type: "expense",
      categoryId: "",
      amount: "",
      description: "",
      tagIds: [],
      date: new Date(),
    },
  });

  async function fetchData() {
    try {
      setIsLoading(true);
      const [txnsData, accntsData, catsData] = await Promise.all([
        getTransactions(),
        getAccounts(),
        getCategories(),
      ]);
      setTransactions(txnsData);
      setAccounts(accntsData);
      setCategories(catsData);
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

  // Fetch tags when category is selected
  useEffect(() => {
    async function fetchTags() {
      if (selectedCategoryId) {
        try {
          const tags = await getTagsByCategory(selectedCategoryId);
          setCategoryTags((prev) => ({ ...prev, [selectedCategoryId!]: tags }));
        } catch (err) {
          console.error("Failed to fetch tags:", err);
        }
      }
    }
    fetchTags();
  }, [selectedCategoryId]);

  async function onSubmit(data: TransactionFormData) {
    try {
      setIsSubmitting(true);
      await createTransaction({
        accountId: data.accountId,
        type: data.type,
        categoryId: data.categoryId || undefined,
        amount: data.amount,
        description: data.description,
        tagIds: data.tagIds,
        date: data.date,
        transferAccountId: data.transferAccountId,
      });
      closeModal();
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create transaction");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      setIsSubmitting(true);
      await deleteTransaction(id);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete transaction");
    } finally {
      setIsSubmitting(false);
    }
  }

  function closeModal() {
    setIsModalOpen(false);
    setModalStep("type");
    setSelectedType(null);
    setSelectedCategoryId(null);
    form.reset({
      accountId: "",
      type: "expense",
      categoryId: "",
      amount: "",
      description: "",
      tagIds: [],
      date: new Date(),
      transferAccountId: "",
    });
  }

  function handleTypeSelect(type: "income" | "expense" | "transfer") {
    setSelectedType(type);
    form.setValue("type", type);
    // Transfers skip category selection
    if (type === "transfer") {
      setModalStep("form");
    } else {
      setModalStep("category");
    }
  }

  function handleCategorySelect(categoryId: string) {
    setSelectedCategoryId(categoryId);
    form.setValue("categoryId", categoryId);
    setModalStep("form");
  }

  function handleTagToggle(tagId: string) {
    const currentTags = form.getValues("tagIds") || [];
    if (currentTags.includes(tagId)) {
      form.setValue(
        "tagIds",
        currentTags.filter((id) => id !== tagId)
      );
    } else {
      form.setValue("tagIds", [...currentTags, tagId]);
    }
  }

  const filteredTransactions = transactions.filter((txn) => {
    if (filterAccountId !== "all" && txn.accountId !== filterAccountId) return false;
    if (filterType !== "all" && txn.type !== filterType) return false;
    return true;
  });

  const totals = filteredTransactions.reduce(
    (acc, txn) => {
      const amount = parseFloat(txn.amount) || 0;
      if (txn.type === "income") acc.income += amount;
      else if (txn.type === "expense") acc.expense += amount;
      // transfers are neutral - no effect on totals
      return acc;
    },
    { income: 0, expense: 0 }
  );

  const getAccountName = (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    return account?.name || "Unknown";
  };

  const getCategoryName = (categoryId: string | null) => {
    if (!categoryId) return "Sin categoría";
    const category = categories.find((c) => c.id === categoryId);
    return category?.name || "Sin categoría";
  };

  const filteredCategories = categories.filter(
    (cat) => cat.type === selectedType && !cat.parentId
  );

  const currentTags = selectedCategoryId ? categoryTags[selectedCategoryId] || [] : [];

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
        <h1 className="text-3xl font-bold">Transacciones</h1>
        <Button onClick={() => setIsModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Agregar Transacción
        </Button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-red-500 dark:bg-red-900/20">
          {error}
        </div>
      )}

      {/* Transaction Modal - 3 Step Flow */}
      <Dialog open={isModalOpen} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {modalStep === "type"
                ? "Nueva Transacción"
                : modalStep === "category"
                ? "Selecciona una Categoría"
                : "Completar Transacción"}
            </DialogTitle>
            <DialogDescription>
              {modalStep === "type"
                ? "¿Es un ingreso, egreso o una transferencia?"
                : modalStep === "category"
                ? `Categorías de ${selectedType === "income" ? "ingreso" : "egreso"}`
                : selectedType === "transfer"
                ? "Completa los datos de la transferencia."
                : "Completa los datos de la transacción."}
            </DialogDescription>
          </DialogHeader>

          {/* Step 1: Type Selection */}
          {modalStep === "type" && (
            <div className="grid grid-cols-3 gap-4 py-4">
              <button
                type="button"
                onClick={() => handleTypeSelect("income")}
                className="flex flex-col items-center justify-center rounded-lg border-2 border-border p-8 hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
              >
                <ArrowUpCircle className="h-12 w-12 text-green-500 mb-3" />
                <span className="text-lg font-medium">Ingreso</span>
                <span className="text-sm text-muted-foreground mt-1">
                  Dinero que recibes
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleTypeSelect("expense")}
                className="flex flex-col items-center justify-center rounded-lg border-2 border-border p-8 hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <ArrowDownCircle className="h-12 w-12 text-red-500 mb-3" />
                <span className="text-lg font-medium">Egreso</span>
                <span className="text-sm text-muted-foreground mt-1">
                  Dinero que gastas
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleTypeSelect("transfer")}
                className="flex flex-col items-center justify-center rounded-lg border-2 border-border p-8 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
              >
                <ArrowLeftRight className="h-12 w-12 text-blue-500 mb-3" />
                <span className="text-lg font-medium">Transferencia</span>
                <span className="text-sm text-muted-foreground mt-1">
                  Entre cuentas
                </span>
              </button>
            </div>
          )}

          {/* Step 2: Category Selection */}
          {modalStep === "category" && (
            <div className="py-4">
              <Button
                variant="ghost"
                onClick={() => setModalStep("type")}
                className="mb-4"
              >
                ← Volver
              </Button>
              {filteredCategories.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-2">
                    No hay categorías de {selectedType === "income" ? "ingreso" : "egreso"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Crea una categoría primero.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {filteredCategories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => handleCategorySelect(category.id)}
                      className="flex items-center gap-3 p-4 rounded-lg border-2 border-border hover:border-primary hover:bg-accent transition-colors text-left"
                    >
                      <div
                        className="h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: category.color || "#3B82F6" }}
                      >
                        {category.iconUrl ? (
                          <img
                            src={category.iconUrl}
                            alt={category.name}
                            className="h-6 w-6 object-contain"
                          />
                        ) : (
                          <span className="text-lg">
                            {category.type === "income" ? "📈" : "📉"}
                          </span>
                        )}
                      </div>
                      <span className="font-medium">{category.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Transaction Form */}
          {modalStep === "form" && (
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
              {/* Category display - hidden for transfers */}
              {selectedType !== "transfer" && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                  <div
                    className="h-8 w-8 rounded-md flex items-center justify-center"
                    style={{
                      backgroundColor:
                        categories.find((c) => c.id === selectedCategoryId)?.color ||
                        "#3B82F6",
                    }}
                  >
                    {selectedCategoryId &&
                    categories.find((c) => c.id === selectedCategoryId)?.iconUrl ? (
                      <img
                        src={
                          categories.find((c) => c.id === selectedCategoryId)?.iconUrl!
                        }
                        alt=""
                        className="h-5 w-5 object-contain"
                      />
                    ) : (
                      <span className="text-sm">
                        {selectedType === "income" ? "📈" : "📉"}
                      </span>
                    )}
                  </div>
                  <span className="font-medium">
                    {getCategoryName(selectedCategoryId)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => setModalStep("category")}
                  >
                    Cambiar
                  </Button>
                </div>
              )}

              {/* Transfer header */}
              {selectedType === "transfer" && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                  <ArrowLeftRight className="h-5 w-5 text-blue-500" />
                  <span className="font-medium text-blue-700 dark:text-blue-300">
                    Transferencia entre cuentas
                  </span>
                </div>
              )}

              {/* Account (From for transfer) */}
              <div className="space-y-2">
                <Label>{selectedType === "transfer" ? "Desde" : "Cuenta"}</Label>
                <Select
                  onValueChange={(value) => form.setValue("accountId", value)}
                  defaultValue={form.getValues("accountId")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar cuenta" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.accountId && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.accountId.message}
                  </p>
                )}
              </div>

              {/* Transfer Account (To) */}
              {selectedType === "transfer" && (
                <div className="space-y-2">
                  <Label>Hacia</Label>
                  <Select
                    onValueChange={(value) => form.setValue("transferAccountId", value)}
                    defaultValue={form.getValues("transferAccountId")}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar cuenta destino" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts
                        .filter((account) => account.id !== form.getValues("accountId"))
                        .map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {form.formState.errors.transferAccountId && (
                    <p className="text-sm text-red-500">
                      {form.formState.errors.transferAccountId.message}
                    </p>
                  )}
                </div>
              )}

              {/* Amount */}
              <div className="space-y-2">
                <Label htmlFor="amount">Monto</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  {...form.register("amount")}
                />
                {form.formState.errors.amount && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.amount.message}
                  </p>
                )}
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">Descripción (Opcional)</Label>
                <Input
                  id="description"
                  placeholder="Agregar una descripción..."
                  {...form.register("description")}
                />
              </div>

              {/* Tags - hidden for transfers */}
              {currentTags.length > 0 && selectedType !== "transfer" && (
                <div className="space-y-2">
                  <Label>Etiquetas</Label>
                  <div className="flex flex-wrap gap-2">
                    {currentTags.map((tag) => {
                      const isSelected = (form.getValues("tagIds") || []).includes(
                        tag.id
                      );
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => handleTagToggle(tag.id)}
                          className={cn(
                            "px-3 py-1 rounded-full text-sm transition-colors",
                            isSelected
                              ? "bg-primary text-primary-foreground"
                              : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                          )}
                        >
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Date */}
              <div className="space-y-2">
                <Label>Fecha</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !form.watch("date") && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {form.watch("date") ? (
                        format(form.watch("date"), "PPP")
                      ) : (
                        <span>Seleccionar fecha</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={form.watch("date")}
                      onSelect={(date) => {
                        if (date) {
                          form.setValue("date", date, { shouldDirty: true });
                        }
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>

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
                  {isSubmitting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {selectedType === "transfer" ? "Crear Transferencia" : "Crear Transacción"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Ingresos</CardTitle>
            <ArrowUpCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">
              {formatCurrency(totals.income.toString())}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Egresos</CardTitle>
            <ArrowDownCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">
              {formatCurrency(totals.expense.toString())}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Neto</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`text-2xl font-bold ${
                totals.income - totals.expense >= 0
                  ? "text-green-600"
                  : "text-red-600"
              }`}
            >
              {formatCurrency((totals.income - totals.expense).toString())}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <Select
          value={filterAccountId}
          onValueChange={setFilterAccountId}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filtrar por cuenta" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las Cuentas</SelectItem>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Filtrar por tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los Tipos</SelectItem>
            <SelectItem value="income">Ingreso</SelectItem>
            <SelectItem value="expense">Egreso</SelectItem>
            <SelectItem value="transfer">Transferencia</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Transactions Table */}
      {filteredTransactions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="mb-4 text-sm text-muted-foreground">
              No hay transacciones
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Cuenta</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransactions.map((txn) => (
                <TableRow key={txn.id}>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(txn.date), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>{getAccountName(txn.accountId)}</TableCell>
                  <TableCell>
                    <Badge variant={TYPE_COLORS[txn.type]}>
                      <span className="mr-1">{TYPE_ICONS[txn.type]}</span>
                      {txn.type === "income" ? "Ingreso" : txn.type === "expense" ? "Egreso" : "Transferencia"}
                    </Badge>
                  </TableCell>
                  <TableCell>{getCategoryName(txn.categoryId)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {txn.description || "—"}
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium ${
                      txn.type === "income"
                        ? "text-green-600"
                        : txn.type === "expense"
                        ? "text-red-600"
                        : ""
                    }`}
                  >
                    {txn.type === "expense" ? "-" : txn.type === "income" ? "+" : ""}
                    {formatCurrency(txn.amount)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(txn.id)}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
