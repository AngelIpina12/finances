"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Pencil, Trash2, RefreshCw, CalendarClock } from "lucide-react";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { z } from "zod";
import {
  createRecurringPayment,
  updateRecurringPayment,
  deleteRecurringPayment,
  toggleRecurringPayment,
  getRecurringPayments,
} from "@/server/actions/recurring-actions";
import { getAccounts } from "@/server/actions/account-actions";
import type { RecurringPayment, Account } from "@/lib/db/schema";
import { format, formatDistanceToNow } from "date-fns";
import { CATEGORIES } from "@/types/forms";

const recurringFormSchema = z.object({
  accountId: z.string().min(1, "Account is required"),
  name: z.string().min(1, "Name is required"),
  amount: z.string().min(1, "Amount is required"),
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  category: z.string().optional(),
  nextPaymentDate: z.date(),
});

type RecurringFormData = z.infer<typeof recurringFormSchema>;

const FREQUENCY_LABELS: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

function formatCurrency(amount: string): string {
  const num = parseFloat(amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(num);
}

export default function RecurringPage() {
  const [payments, setPayments] = useState<RecurringPayment[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingPayment, setEditingPayment] = useState<RecurringPayment | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null);

  const form = useForm<RecurringFormData>({
    resolver: zodResolver(recurringFormSchema),
    defaultValues: {
      accountId: "",
      name: "",
      amount: "",
      frequency: "monthly",
      category: "",
      nextPaymentDate: new Date(),
    },
  });

  async function fetchData() {
    try {
      setIsLoading(true);
      const [paymentsData, accountsData] = await Promise.all([
        getRecurringPayments(),
        getAccounts(),
      ]);
      setPayments(paymentsData);
      setAccounts(accountsData);
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

  // Sync form when editingPayment changes
  useEffect(() => {
    if (editingPayment) {
      form.reset({
        accountId: editingPayment.accountId,
        name: editingPayment.name,
        amount: editingPayment.amount,
        frequency: editingPayment.frequency as RecurringFormData["frequency"],
        category: editingPayment.category || "",
        nextPaymentDate: new Date(editingPayment.nextPaymentDate),
      });
      setIsDialogOpen(true);
    }
  }, [editingPayment, form]);

  async function onSubmit(data: RecurringFormData) {
    try {
      setIsSubmitting(true);
      if (editingPayment) {
        await updateRecurringPayment(editingPayment.id, data);
      } else {
        await createRecurringPayment(data);
      }
      form.reset();
      setEditingPayment(null);
      setIsDialogOpen(false);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggle(payment: RecurringPayment) {
    try {
      setIsSubmitting(true);
      await toggleRecurringPayment(payment.id);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to toggle");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deletePaymentId) return;
    try {
      setIsSubmitting(true);
      await deleteRecurringPayment(deletePaymentId);
      setDeletePaymentId(null);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setIsSubmitting(false);
    }
  }

  const categories = Array.from(new Set(CATEGORIES));

  const activePayments = payments.filter((p) => p.isActive === 1);
  const totalMonthly = activePayments.reduce((sum, p) => {
    let monthlyAmount = parseFloat(p.amount);
    switch (p.frequency) {
      case "daily":
        monthlyAmount *= 30;
        break;
      case "weekly":
        monthlyAmount *= 4;
        break;
      case "monthly":
        break;
      case "yearly":
        monthlyAmount /= 12;
        break;
    }
    return sum + monthlyAmount;
  }, 0);

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
        <h1 className="text-3xl font-bold">Recurring Payments</h1>
        <Dialog
          open={isDialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              setEditingPayment(null);
              setIsDialogOpen(false);
              form.reset();
            }
          }}
        >
          <DialogTrigger asChild>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Recurring
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingPayment ? "Edit Recurring Payment" : "New Recurring Payment"}
              </DialogTitle>
              <DialogDescription>
                Set up a payment that repeats automatically.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Payment Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., Netflix, Rent"
                  {...form.register("name")}
                />
                {form.formState.errors.name && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Account</Label>
                <Select
                  value={form.watch("accountId")}
                  onValueChange={(value) => form.setValue("accountId", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select account" />
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

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    placeholder="15.00"
                    {...form.register("amount")}
                  />
                  {form.formState.errors.amount && (
                    <p className="text-sm text-red-500">
                      {form.formState.errors.amount.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Frequency</Label>
                  <Select
                    value={form.watch("frequency")}
                    onValueChange={(value) =>
                      form.setValue("frequency", value as RecurringFormData["frequency"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select frequency" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="yearly">Yearly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={form.watch("category") || ""}
                  onValueChange={(value) => form.setValue("category", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingPayment(null);
                    setIsDialogOpen(false);
                    form.reset();
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {editingPayment ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-red-500 dark:bg-red-900/20">
          {error}
        </div>
      )}

      {/* Summary Card */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Active Payments
            </CardTitle>
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{activePayments.length}</p>
            <p className="text-xs text-muted-foreground">
              of {payments.length} total
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Monthly Estimate
            </CardTitle>
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(totalMonthly.toString())}</p>
            <p className="text-xs text-muted-foreground">per month</p>
          </CardContent>
        </Card>
      </div>

      {/* Payments Table */}
      {payments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <RefreshCw className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-medium">No recurring payments</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Set up automatic payments for subscriptions and regular expenses.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Next Payment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((payment) => {
                const nextDate = new Date(payment.nextPaymentDate);
                const isPast = nextDate < new Date();

                return (
                  <TableRow key={payment.id}>
                    <TableCell className="font-medium">{payment.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {payment.category || "Uncategorized"}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatCurrency(payment.amount)}</TableCell>
                    <TableCell>
                      {FREQUENCY_LABELS[payment.frequency] || payment.frequency}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{format(nextDate, "MMM d, yyyy")}</span>
                        <span className={`text-xs ${isPast ? "text-red-500" : "text-muted-foreground"}`}>
                          {isPast ? "Overdue" : formatDistanceToNow(nextDate, { addSuffix: true })}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggle(payment)}
                        className={
                          payment.isActive === 1
                            ? "text-green-600"
                            : "text-muted-foreground"
                        }
                      >
                        {payment.isActive === 1 ? "Active" : "Paused"}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingPayment(payment)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeletePaymentId(payment.id)}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Recurring Payment</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete &quot;{payment.name}&quot;?
                                This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={handleDelete}
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
    </div>
  );
}
