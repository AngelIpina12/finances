"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Pencil, Trash2, RefreshCw, CalendarClock, ArrowRight, ArrowLeft } from "lucide-react";
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
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { z } from "zod";
import {
  createRecurringPayment,
  updateRecurringPayment,
  deleteRecurringPayment,
  toggleRecurringPayment,
  getRecurringPayments,
} from "@/server/actions/recurring-actions";
import { getAccounts } from "@/server/actions/account-actions";
import { getCategories } from "@/server/actions/category-actions";
import { getTagsByCategory } from "@/server/actions/tag-actions";
import type { RecurringPayment, Account, Category, Tag } from "@/lib/db/schema";
import { format, formatDistanceToNow } from "date-fns";
import { CalendarIcon } from "lucide-react";

// Types
type PaymentType = "indefinite" | "by_term" | "subscription";
type CycleType = "daily" | "weekly" | "monthly" | "yearly" | "custom";
type Subtype = "transaction" | "transfer" | "payroll";

interface CycleConfig {
  type: CycleType;
  interval: number;
  daysOfWeek?: number[];
  daysOfMonth?: number[];
  monthsOfYear?: number[];
  time: string;
  perMonthDays?: Record<string, number>; // key: "YYYY-MM", value: day of month
}

interface TypeSpecificData {
  subtype?: Subtype;
  accountId?: string;
  categoryId?: string;
  subcategoryId?: string;
  tagIds?: string[];
  amount?: string;
  fromAccountId?: string;
  toAccountId?: string;
  totalAmount?: string;
  totalPayments?: number;
  firstBillDate?: Date;
  creditAccountId?: string;
  reduceCreditLimit?: boolean;
  remainingBalance?: string;
  iconUrl?: string;
  price?: string;
  billingCycle?: string;
  paymentDay?: number;
  endDate?: Date;
  // Payroll income specific
  isPayroll?: boolean;
  payrollConfig?: {
    dayOfWeek: number; // 0=Sun, 1=Mon, ..., 6=Sat
    regularAmount: string;
    fifthWeekAmount?: string;
    hasFifthWeekAdjustment: boolean;
  };
}

// Form schemas
const cycleConfigSchema = z.object({
  type: z.enum(["daily", "weekly", "monthly", "yearly", "custom"]),
  interval: z.number().min(1),
  daysOfWeek: z.array(z.number()).optional(),
  daysOfMonth: z.array(z.number()).optional(),
  monthsOfYear: z.array(z.number()).optional(),
  time: z.string(),
  perMonthDays: z.record(z.string(), z.number()).optional(),
});

const indefiniteTransactionSchema = z.object({
  subtype: z.literal("transaction"),
  accountId: z.string().min(1, "Account is required"),
  categoryId: z.string().optional(),
  subcategoryId: z.string().optional(),
  tagIds: z.array(z.string()).optional(),
  amount: z.string().optional(), // Optional - for payroll, regularAmount is used instead
  isPayroll: z.boolean().optional(),
  payrollConfig: z.object({
    dayOfWeek: z.number().min(0).max(6),
    regularAmount: z.string().min(1, "Amount is required"),
    fifthWeekAmount: z.string().optional(),
    hasFifthWeekAdjustment: z.boolean(),
  }).optional(),
});

const indefiniteTransferSchema = z.object({
  subtype: z.literal("transfer"),
  fromAccountId: z.string().min(1, "From account is required"),
  toAccountId: z.string().min(1, "To account is required"),
  amount: z.string().min(1, "Amount is required"),
});

const byTermSchema = z.object({
  categoryId: z.string().optional(),
  subcategoryId: z.string().optional(),
  tagIds: z.array(z.string()).optional(),
  totalAmount: z.string().min(1, "Total amount is required"),
  totalPayments: z.number().min(1),
  firstBillDate: z.date(),
  creditAccountId: z.string().min(1, "Credit account is required"),
  reduceCreditLimit: z.boolean(),
  remainingBalance: z.string().optional(),
});

const subscriptionSchema = z.object({
  iconUrl: z.string().optional(),
  price: z.string().min(1, "Price is required"),
  accountId: z.string().optional(),
  categoryId: z.string().min(1, "Category is required"),
  tagIds: z.array(z.string()).optional(),
  billingCycle: z.enum(["weekly", "monthly", "quarterly", "yearly", "custom"]),
  billingConfig: cycleConfigSchema.optional(),
  paymentDay: z.number().min(1).max(31).optional(),
  endDate: z.date().optional(),
});

// Main form schema
const recurringFormSchema = z.object({
  paymentType: z.enum(["indefinite", "by_term", "subscription"]),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  cycleType: z.enum(["daily", "weekly", "monthly", "yearly", "custom"]),
  cycleConfig: cycleConfigSchema,
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  indefiniteTransaction: indefiniteTransactionSchema.optional(),
  indefiniteTransfer: indefiniteTransferSchema.optional(),
  byTerm: byTermSchema.optional(),
  subscription: subscriptionSchema.optional(),
});

type RecurringFormData = z.infer<typeof recurringFormSchema>;

// Tab types
type TabType = "all" | "indefinite" | "by_term" | "subscription";

const TYPE_LABELS: Record<string, string> = {
  indefinite: "Indefinite",
  by_term: "By Term",
  subscription: "Subscription",
};

const CYCLE_LABELS: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
  custom: "Custom",
};

const MONTH_NAMES = [
  { value: 1, label: "Jan" },
  { value: 2, label: "Feb" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Apr" },
  { value: 5, label: "May" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Aug" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Oct" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dec" },
];

// Generate months between start and end dates with interval support
function getMonthsInRange(startDate: Date, endDate: Date, interval: number = 1): Array<{ key: string; label: string; year: number; month: number }> {
  const months: Array<{ key: string; label: string; year: number; month: number }> = [];
  const current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  let monthIndex = 0;
  while (current <= end) {
    if (monthIndex % interval === 0) {
      const year = current.getFullYear();
      const month = current.getMonth() + 1;
      const key = `${year}-${String(month).padStart(2, '0')}`;
      const monthInfo = MONTH_NAMES.find(m => m.value === month);
      months.push({
        key,
        label: `${monthInfo?.label || ''} ${year}`,
        year,
        month,
      });
    }
    monthIndex++;
    current.setMonth(current.getMonth() + 1);
  }

  return months;
}

// Calculate total months in range
function getTotalMonthsInRange(startDate: Date, endDate: Date): number {
  const months = getMonthsInRange(startDate, endDate, 1);
  return months.length;
}

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
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryTags, setCategoryTags] = useState<Record<string, Tag[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingPayment, setEditingPayment] = useState<RecurringPayment | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("all");

  // Modal steps
  const [modalStep, setModalStep] = useState<"type" | "form">("type");
  const [selectedPaymentType, setSelectedPaymentType] = useState<PaymentType | null>(null);
  const [indefiniteSubtype, setIndefiniteSubtype] = useState<Subtype | null>(null);
  const [perMonthDays, setPerMonthDays] = useState<Record<string, number>>({});
  const [useSpecificDayPerMonth, setUseSpecificDayPerMonth] = useState(false);

  const form = useForm<RecurringFormData>({
    resolver: zodResolver(recurringFormSchema),
    defaultValues: {
      paymentType: "indefinite",
      name: "",
      description: "",
      cycleType: "monthly",
      cycleConfig: {
        type: "monthly",
        interval: 1,
        time: "00:00",
      },
    },
  });

  async function fetchData() {
    try {
      setIsLoading(true);
      const [paymentsData, accountsData, categoriesData] = await Promise.all([
        getRecurringPayments(),
        getAccounts(),
        getCategories(),
      ]);
      setPayments(paymentsData);
      setAccounts(accountsData);
      setCategories(categoriesData);
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

  // Sync perMonthDays and useSpecificDayPerMonth when start/end dates or interval change
  useEffect(() => {
    const start = form.watch("startDate");
    const end = form.watch("endDate");
    const interval = form.watch("cycleConfig.interval") || 1;
    if (start && end) {
      const totalMonths = getTotalMonthsInRange(start, end);
      const months = getMonthsInRange(start, end, interval);
      setPerMonthDays((prev) => {
        const updated = { ...prev };
        // Keep only keys that are in the current range with current interval
        Object.keys(updated).forEach((key) => {
          if (!months.find((m) => m.key === key)) {
            delete updated[key];
          }
        });
        // Add new keys
        months.forEach(({ key }) => {
          if (updated[key] === undefined) {
            updated[key] = 1;
          }
        });
        return updated;
      });
      // If interval >= totalMonths, disable specific day per month
      if (interval >= totalMonths) {
        setUseSpecificDayPerMonth(false);
      }
    }
  }, [form.watch("startDate"), form.watch("endDate"), form.watch("cycleConfig.interval")]);

  // Fetch tags when category is selected
  useEffect(() => {
    async function fetchTags(categoryId: string) {
      if (categoryId && !categoryTags[categoryId]) {
        try {
          const tags = await getTagsByCategory(categoryId);
          setCategoryTags((prev) => ({ ...prev, [categoryId]: tags }));
        } catch (err) {
          console.error("Failed to fetch tags:", err);
        }
      }
    }
    const categoryId =
      form.watch("indefiniteTransaction")?.categoryId ||
      form.watch("byTerm")?.categoryId ||
      form.watch("subscription")?.categoryId;
    if (categoryId) {
      fetchTags(categoryId);
    }
  }, [form.watch("indefiniteTransaction")?.categoryId, form.watch("byTerm")?.categoryId, form.watch("subscription")?.categoryId]);

  // Sync form when editingPayment changes
  useEffect(() => {
    if (editingPayment) {
      const typeSpecific = editingPayment.typeSpecific as TypeSpecificData;
      const cycleConfig = editingPayment.cycleConfig as CycleConfig;

      if (editingPayment.paymentType === "indefinite") {
        if (typeSpecific.subtype === "transaction") {
          // Check if this is a payroll transaction
          if (typeSpecific.isPayroll) {
            form.reset({
              paymentType: editingPayment.paymentType,
              name: editingPayment.name,
              description: editingPayment.description || "",
              cycleType: editingPayment.cycleType as CycleType,
              cycleConfig: cycleConfig ? { ...cycleConfig, time: cycleConfig.time || "00:00" } : { type: "monthly", interval: 1, time: "00:00" },
              startDate: editingPayment.startDate ? new Date(editingPayment.startDate) : undefined,
              endDate: editingPayment.endDate ? new Date(editingPayment.endDate) : undefined,
              indefiniteTransaction: {
                subtype: "transaction",
                accountId: typeSpecific.accountId || "",
                categoryId: typeSpecific.categoryId || "",
                subcategoryId: typeSpecific.subcategoryId || "",
                tagIds: typeSpecific.tagIds || [],
                amount: typeSpecific.amount || "",
                isPayroll: true,
                payrollConfig: typeSpecific.payrollConfig ? {
                  dayOfWeek: typeSpecific.payrollConfig.dayOfWeek ?? 4,
                  regularAmount: typeSpecific.payrollConfig.regularAmount || "",
                  fifthWeekAmount: typeSpecific.payrollConfig.fifthWeekAmount || "",
                  hasFifthWeekAdjustment: typeSpecific.payrollConfig.hasFifthWeekAdjustment ?? false,
                } : undefined,
              },
            });
            setIndefiniteSubtype("payroll");
          } else {
            // Regular transaction
            form.reset({
              paymentType: editingPayment.paymentType,
              name: editingPayment.name,
              description: editingPayment.description || "",
              cycleType: editingPayment.cycleType as CycleType,
              cycleConfig: cycleConfig ? { ...cycleConfig, time: cycleConfig.time || "00:00" } : { type: "monthly", interval: 1, time: "00:00" },
              startDate: editingPayment.startDate ? new Date(editingPayment.startDate) : undefined,
              endDate: editingPayment.endDate ? new Date(editingPayment.endDate) : undefined,
              indefiniteTransaction: {
                subtype: "transaction",
                accountId: typeSpecific.accountId || "",
                categoryId: typeSpecific.categoryId || "",
                subcategoryId: typeSpecific.subcategoryId || "",
                tagIds: typeSpecific.tagIds || [],
                amount: typeSpecific.amount || "",
              },
            });
            setIndefiniteSubtype("transaction");
          }
        } else {
          form.reset({
            paymentType: editingPayment.paymentType,
            name: editingPayment.name,
            description: editingPayment.description || "",
            cycleType: editingPayment.cycleType as CycleType,
            cycleConfig: cycleConfig ? { ...cycleConfig, time: cycleConfig.time || "00:00" } : { type: "monthly", interval: 1, time: "00:00" },
            startDate: editingPayment.startDate ? new Date(editingPayment.startDate) : undefined,
            endDate: editingPayment.endDate ? new Date(editingPayment.endDate) : undefined,
            indefiniteTransfer: {
              subtype: "transfer",
              fromAccountId: typeSpecific.fromAccountId || "",
              toAccountId: typeSpecific.toAccountId || "",
              amount: typeSpecific.amount || "",
            },
          });
          setIndefiniteSubtype("transfer");
        }
      } else if (editingPayment.paymentType === "by_term") {
        form.reset({
          paymentType: editingPayment.paymentType,
          name: editingPayment.name,
          description: editingPayment.description || "",
          cycleType: cycleConfig?.type || "monthly",
          cycleConfig: cycleConfig ? { ...cycleConfig, time: cycleConfig.time || "00:00" } : { type: "monthly", interval: 1, time: "00:00" },
          byTerm: {
            categoryId: typeSpecific.categoryId || "",
            subcategoryId: typeSpecific.subcategoryId || "",
            tagIds: typeSpecific.tagIds || [],
            totalAmount: typeSpecific.totalAmount || "",
            totalPayments: typeSpecific.totalPayments || 1,
            firstBillDate: typeSpecific.firstBillDate ? new Date(typeSpecific.firstBillDate) : new Date(),
            creditAccountId: typeSpecific.creditAccountId || "",
            reduceCreditLimit: typeSpecific.reduceCreditLimit || false,
            remainingBalance: editingPayment.remainingBalance || "",
          },
        });
      } else {
        form.reset({
          paymentType: editingPayment.paymentType,
          name: editingPayment.name,
          description: editingPayment.description || "",
          cycleType: cycleConfig?.type || "monthly",
          cycleConfig: cycleConfig ? { ...cycleConfig, time: cycleConfig.time || "00:00" } : { type: "monthly", interval: 1, time: "00:00" },
          subscription: {
            iconUrl: typeSpecific.iconUrl || "",
            price: typeSpecific.price || "",
            accountId: typeSpecific.accountId || "",
            categoryId: typeSpecific.categoryId || "",
            tagIds: typeSpecific.tagIds || [],
            billingCycle: (typeSpecific.billingCycle as "weekly" | "monthly" | "quarterly" | "yearly" | "custom") || "monthly",
            paymentDay: typeSpecific.paymentDay,
            endDate: typeSpecific.endDate ? new Date(typeSpecific.endDate) : undefined,
          },
        });
      }

      setSelectedPaymentType(editingPayment.paymentType as PaymentType);

      // Restore perMonthDays and useSpecificDayPerMonth from cycleConfig
      if (cycleConfig?.perMonthDays && Object.keys(cycleConfig.perMonthDays).length > 0) {
        setPerMonthDays(cycleConfig.perMonthDays);
        setUseSpecificDayPerMonth(true);
      } else {
        setPerMonthDays({});
        setUseSpecificDayPerMonth(false);
      }

      setModalStep("form");
      setIsDialogOpen(true);
    }
  }, [editingPayment, form]);

  async function onSubmit(data: RecurringFormData) {
    console.log("Submitting data:", data);
    try {
      setIsSubmitting(true);

      // Build typeSpecific based on payment type
      let typeSpecific: TypeSpecificData = {};

      if (data.paymentType === "indefinite") {
        if (indefiniteSubtype === "transaction") {
          const txn = data.indefiniteTransaction!;
          typeSpecific = {
            subtype: "transaction",
            accountId: txn.accountId,
            categoryId: txn.categoryId,
            subcategoryId: txn.subcategoryId,
            tagIds: txn.tagIds,
            amount: txn.amount,
            isPayroll: txn.isPayroll,
            payrollConfig: txn.payrollConfig,
          };
        } else if (indefiniteSubtype === "payroll") {
          const txn = data.indefiniteTransaction!;
          typeSpecific = {
            subtype: "transaction",
            accountId: txn.accountId,
            isPayroll: true,
            payrollConfig: txn.payrollConfig,
            categoryId: txn.categoryId,
            tagIds: txn.tagIds,
          };
        } else {
          const tf = data.indefiniteTransfer!;
          typeSpecific = {
            subtype: "transfer",
            fromAccountId: tf.fromAccountId,
            toAccountId: tf.toAccountId,
            amount: tf.amount,
          };
        }
      } else if (data.paymentType === "by_term") {
        const bt = data.byTerm!;
        typeSpecific = {
          categoryId: bt.categoryId,
          subcategoryId: bt.subcategoryId,
          tagIds: bt.tagIds,
          totalAmount: bt.totalAmount,
          totalPayments: bt.totalPayments,
          firstBillDate: bt.firstBillDate,
          creditAccountId: bt.creditAccountId,
          reduceCreditLimit: bt.reduceCreditLimit,
        };
      } else {
        const sub = data.subscription!;
        typeSpecific = {
          iconUrl: sub.iconUrl,
          price: sub.price,
          accountId: sub.accountId,
          categoryId: sub.categoryId,
          tagIds: sub.tagIds,
          billingCycle: sub.billingCycle,
          paymentDay: sub.paymentDay,
          endDate: sub.endDate,
        };
      }

      // Filter out undefined values and add remainingBalance for by_term
      // For payroll, ensure cycleConfig.daysOfWeek is set from payrollConfig.dayOfWeek
      let cycleConfig = { ...data.cycleConfig, perMonthDays };
      if (indefiniteSubtype === "payroll" && data.indefiniteTransaction?.payrollConfig?.dayOfWeek !== undefined) {
        cycleConfig.daysOfWeek = [data.indefiniteTransaction.payrollConfig.dayOfWeek];
      }

      const submissionData: Record<string, unknown> = {
        name: data.name,
        description: data.description,
        cycleType: data.cycleType,
        cycleConfig,
        startDate: data.startDate,
        endDate: data.endDate,
        typeSpecific,
      };
      if (data.paymentType === "by_term" && data.byTerm?.remainingBalance) {
        submissionData.remainingBalance = data.byTerm.remainingBalance;
      }
      Object.keys(submissionData).forEach((key) => {
        if (submissionData[key] === undefined) delete submissionData[key];
      });

      if (editingPayment) {
        await updateRecurringPayment(editingPayment.id, submissionData as Parameters<typeof updateRecurringPayment>[1]);
      } else {
        await createRecurringPayment({
          paymentType: data.paymentType,
          ...submissionData,
        } as Parameters<typeof createRecurringPayment>[0]);
      }

      closeModal();
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

  function closeModal() {
    setIsDialogOpen(false);
    setModalStep("type");
    setSelectedPaymentType(null);
    setIndefiniteSubtype(null);
    setEditingPayment(null);
    setPerMonthDays({});
    setUseSpecificDayPerMonth(false);
    form.reset({
      paymentType: "indefinite",
      name: "",
      description: "",
      cycleType: "monthly",
      cycleConfig: { type: "monthly", interval: 1, time: "00:00" },
    });
  }

  function handleTypeSelect(type: PaymentType) {
    setSelectedPaymentType(type);
    form.setValue("paymentType", type);

    if (type === "indefinite") {
      // Do nothing, wait for subtype selection
    } else if (type === "by_term") {
      form.setValue("byTerm", {
        categoryId: "",
        subcategoryId: "",
        tagIds: [],
        totalAmount: "",
        totalPayments: 12,
        firstBillDate: new Date(),
        creditAccountId: "",
        reduceCreditLimit: false,
        remainingBalance: "",
      });
      setModalStep("form");
    } else {
      form.setValue("subscription", {
        iconUrl: "",
        price: "",
        accountId: "",
        categoryId: "",
        tagIds: [],
        billingCycle: "monthly",
        paymentDay: 1,
        endDate: undefined,
      });
      setModalStep("form");
    }
  }

  function handleIndefiniteSubtypeSelect(subtype: Subtype) {
    setIndefiniteSubtype(subtype);
    if (subtype === "transaction") {
      form.setValue("indefiniteTransaction", {
        subtype: "transaction",
        accountId: "",
        categoryId: "",
        amount: "",
        isPayroll: false,
      });
      form.setValue("indefiniteTransfer", undefined);
    } else if (subtype === "transfer") {
      form.setValue("indefiniteTransfer", {
        subtype: "transfer",
        fromAccountId: "",
        toAccountId: "",
        amount: "",
      });
      form.setValue("indefiniteTransaction", undefined);
    } else if (subtype === "payroll") {
      form.setValue("indefiniteTransaction", {
        subtype: "transaction",
        accountId: "",
        categoryId: "",
        amount: "",
        isPayroll: true,
        payrollConfig: {
          dayOfWeek: 4, // Thursday by default (payday)
          regularAmount: "",
          fifthWeekAmount: "",
          hasFifthWeekAdjustment: false,
        },
      });
      form.setValue("indefiniteTransfer", undefined);
    }
    setModalStep("form");
  }

  // Filter payments by tab
  const filteredPayments = payments.filter((p) => {
    if (activeTab === "all") return true;
    return p.paymentType === activeTab;
  });

  // Calculate stats
  const activePayments = filteredPayments.filter((p) => p.isActive === 1);

  const getAmountDisplay = (payment: RecurringPayment): string => {
    const typeSpecific = payment.typeSpecific as TypeSpecificData;
    if (payment.paymentType === "by_term") {
      // Show monthly payment (totalAmount / totalPayments)
      const total = parseFloat(typeSpecific.totalAmount || "0");
      const payments = typeSpecific.totalPayments || 1;
      return formatCurrency((total / payments).toString());
    }
    if (payment.paymentType === "subscription") {
      return formatCurrency(typeSpecific.price || "0");
    }
    // For payroll, show the regular weekly amount
    if (typeSpecific.isPayroll && typeSpecific.payrollConfig) {
      return `${formatCurrency(typeSpecific.payrollConfig.regularAmount)}/week`;
    }
    return formatCurrency(typeSpecific.amount || "0");
  };

  const getCategoryDisplay = (payment: RecurringPayment): string => {
    const typeSpecific = payment.typeSpecific as TypeSpecificData;
    if (!typeSpecific.categoryId) return "—";
    const category = categories.find((c) => c.id === typeSpecific.categoryId);
    return category?.name || "—";
  };

  const getAccountDisplay = (payment: RecurringPayment): string => {
    const typeSpecific = payment.typeSpecific as TypeSpecificData;
    if (payment.paymentType === "indefinite" && typeSpecific.subtype === "transfer") {
      const from = accounts.find((a) => a.id === typeSpecific.fromAccountId);
      const to = accounts.find((a) => a.id === typeSpecific.toAccountId);
      return `${from?.name || "?"} → ${to?.name || "?"}`;
    }
    if (typeSpecific.accountId) {
      const account = accounts.find((a) => a.id === typeSpecific.accountId);
      return account?.name || "—";
    }
    if (typeSpecific.creditAccountId) {
      const account = accounts.find((a) => a.id === typeSpecific.creditAccountId);
      return account?.name || "—";
    }
    return "—";
  };

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
            if (!open) closeModal();
          }}
        >
          <DialogTrigger asChild>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Recurring
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingPayment
                  ? "Edit Recurring Payment"
                  : modalStep === "type"
                  ? "What type of recurring payment?"
                  : selectedPaymentType === "indefinite" && !indefiniteSubtype
                  ? "Transaction or Transfer?"
                  : selectedPaymentType === "indefinite"
                  ? `Indefinite - ${indefiniteSubtype === "transaction" ? "Transaction" : indefiniteSubtype === "payroll" ? "Payroll" : "Transfer"}`
                  : selectedPaymentType === "by_term"
                  ? "By Term"
                  : "Subscription"}
              </DialogTitle>
              <DialogDescription>
                {modalStep === "type"
                  ? "Choose the type of recurring payment you want to create."
                  : selectedPaymentType === "indefinite" && !indefiniteSubtype
                  ? "Is this a regular transaction, a transfer, or payroll income?"
                  : "Fill in the details for your recurring payment."}
              </DialogDescription>
            </DialogHeader>

            {/* Step 1: Select Payment Type */}
            {modalStep === "type" && (
              <div className="grid grid-cols-3 gap-4 py-4">
                <button
                  type="button"
                  onClick={() => handleTypeSelect("indefinite")}
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-border p-6 hover:border-primary hover:bg-accent transition-colors"
                >
                  <span className="text-3xl mb-2">♾️</span>
                  <span className="font-medium text-center">Indefinite</span>
                  <span className="text-xs text-muted-foreground text-center mt-1">
                    Transaction or Transfer
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleTypeSelect("by_term")}
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-border p-6 hover:border-primary hover:bg-accent transition-colors"
                >
                  <span className="text-3xl mb-2">⏱️</span>
                  <span className="font-medium text-center">By Term</span>
                  <span className="text-xs text-muted-foreground text-center mt-1">
                    Fixed payments
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleTypeSelect("subscription")}
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-border p-6 hover:border-primary hover:bg-accent transition-colors"
                >
                  <span className="text-3xl mb-2">📺</span>
                  <span className="font-medium text-center">Subscription</span>
                  <span className="text-xs text-muted-foreground text-center mt-1">
                    Recurring services
                  </span>
                </button>
              </div>
            )}

            {/* Step 2: Select Indefinite Subtype */}
            {modalStep === "type" && selectedPaymentType === "indefinite" && (
              <div className="grid grid-cols-3 gap-4 py-4">
                <button
                  type="button"
                  onClick={() => handleIndefiniteSubtypeSelect("transaction")}
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-border p-6 hover:border-primary hover:bg-accent transition-colors"
                >
                  <span className="text-3xl mb-2">💳</span>
                  <span className="font-medium">Transaction</span>
                  <span className="text-xs text-muted-foreground mt-1 text-center">
                    Regular expense
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleIndefiniteSubtypeSelect("transfer")}
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-border p-6 hover:border-primary hover:bg-accent transition-colors"
                >
                  <span className="text-3xl mb-2">↔️</span>
                  <span className="font-medium">Transfer</span>
                  <span className="text-xs text-muted-foreground mt-1 text-center">
                    Between accounts
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleIndefiniteSubtypeSelect("payroll")}
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-border p-6 hover:border-primary hover:bg-accent transition-colors"
                >
                  <span className="text-3xl mb-2">💰</span>
                  <span className="font-medium">Payroll</span>
                  <span className="text-xs text-muted-foreground mt-1 text-center">
                    Salary / Income
                  </span>
                </button>
              </div>
            )}

            {/* Step 3: Form */}
            {modalStep === "form" && selectedPaymentType && (
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                {/* Back button for indefinite with subtype selection */}
                {selectedPaymentType === "indefinite" && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      if (indefiniteSubtype) {
                        setIndefiniteSubtype(null);
                      } else {
                        setModalStep("type");
                      }
                    }}
                    className="mb-2"
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                  </Button>
                )}

                {/* Common fields */}
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
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

                {/* Indefinite - Transaction / Payroll */}
                {selectedPaymentType === "indefinite" && (indefiniteSubtype === "transaction" || indefiniteSubtype === "payroll") && (
                  <>
                    {/* Payroll Header */}
                    {indefiniteSubtype === "payroll" && (
                      <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
                        <p className="text-sm text-green-800 dark:text-green-200 font-medium">
                          💰 Configure your payroll income. Set the regular weekly amount and optionally adjust for months with 5 weeks.
                        </p>
                      </div>
                    )}

                    {indefiniteSubtype === "payroll" ? (
                      /* Payroll Form Fields */
                      <>
                        <div className="space-y-2">
                          <Label>Account</Label>
                          <Select
                            onValueChange={(value) =>
                              form.setValue("indefiniteTransaction.accountId", value)
                            }
                            defaultValue={form.getValues("indefiniteTransaction.accountId")}
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
                        </div>

                        <div className="space-y-2">
                          <Label>Day of Week</Label>
                          <Select
                            onValueChange={(value) =>
                              form.setValue("indefiniteTransaction.payrollConfig.dayOfWeek", parseInt(value))
                            }
                            defaultValue={String(form.getValues("indefiniteTransaction.payrollConfig.dayOfWeek") ?? 4)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select day" />
                            </SelectTrigger>
                            <SelectContent>
                              {[
                                { value: 0, label: "Sunday" },
                                { value: 1, label: "Monday" },
                                { value: 2, label: "Tuesday" },
                                { value: 3, label: "Wednesday" },
                                { value: 4, label: "Thursday" },
                                { value: 5, label: "Friday" },
                                { value: 6, label: "Saturday" },
                              ].map((day) => (
                                <SelectItem key={day.value} value={String(day.value)}>
                                  {day.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="regularAmount">Weekly Amount (4 weeks)</Label>
                          <Input
                            id="regularAmount"
                            type="number"
                            step="0.01"
                            placeholder="e.g., 6611.80"
                            {...form.register("indefiniteTransaction.payrollConfig.regularAmount")}
                          />
                          <p className="text-xs text-muted-foreground">
                            Amount for regular weeks (4 per month)
                          </p>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Switch
                            id="hasFifthWeekAdjustment"
                            checked={form.watch("indefiniteTransaction.payrollConfig.hasFifthWeekAdjustment") ?? false}
                            onCheckedChange={(checked) =>
                              form.setValue("indefiniteTransaction.payrollConfig.hasFifthWeekAdjustment", checked)
                            }
                          />
                          <Label htmlFor="hasFifthWeekAdjustment" className="cursor-pointer">
                            Adjust for months with 5 weeks
                          </Label>
                        </div>

                        {form.watch("indefiniteTransaction.payrollConfig.hasFifthWeekAdjustment") && (
                          <div className="space-y-2">
                            <Label htmlFor="fifthWeekAmount">Fifth Week Amount</Label>
                            <Input
                              id="fifthWeekAmount"
                              type="number"
                              step="0.01"
                              placeholder="e.g., 6210.40"
                              {...form.register("indefiniteTransaction.payrollConfig.fifthWeekAmount")}
                            />
                            <p className="text-xs text-muted-foreground">
                              Amount for the 5th week (months with 5 occurrences of the payday)
                            </p>
                            {(() => {
                              const regular = parseFloat(form.watch("indefiniteTransaction.payrollConfig.regularAmount") || "0");
                              const fifth = parseFloat(form.watch("indefiniteTransaction.payrollConfig.fifthWeekAmount") || "0");
                              return (
                                <p className="text-xs text-green-600 dark:text-green-400">
                                  Monthly total: {formatCurrency(String((regular * 4) + fifth))} in 5-week months, {formatCurrency(String(regular * 4))} in 4-week months
                                </p>
                              );
                            })()}
                          </div>
                        )}
                      </>
                    ) : (
                      /* Regular Transaction Form Fields */
                      <>
                        <div className="space-y-2">
                          <Label>Category</Label>
                          <Select
                            onValueChange={(value) =>
                              form.setValue("indefiniteTransaction.categoryId", value)
                            }
                            defaultValue={form.getValues("indefiniteTransaction.categoryId")}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                            <SelectContent>
                              {categories
                                .filter((c) => !c.parentId)
                                .map((cat) => (
                                  <SelectItem key={cat.id} value={cat.id}>
                                    {cat.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {form.watch("indefiniteTransaction.categoryId") && (() => {
                          const catId = form.watch("indefiniteTransaction.categoryId");
                          const tags = categoryTags[catId!] || [];
                          return (
                            <div className="space-y-2">
                              <Label>Tags (Optional)</Label>
                              <div className="flex flex-wrap gap-2">
                                {tags.map((tag) => {
                                  const selectedTags = form.watch("indefiniteTransaction.tagIds") || [];
                                  const isSelected = selectedTags.includes(tag.id);
                                  return (
                                    <button
                                      key={tag.id}
                                      type="button"
                                      onClick={() => {
                                        const newTags = isSelected
                                          ? selectedTags.filter((t) => t !== tag.id)
                                          : [...selectedTags, tag.id];
                                        form.setValue("indefiniteTransaction.tagIds", newTags);
                                      }}
                                      className={cn(
                                        "px-3 py-1 rounded-full text-sm transition-colors",
                                        isSelected
                                          ? "bg-primary text-primary-foreground"
                                          : "bg-secondary hover:bg-secondary/80"
                                      )}
                                    >
                                      {tag.name}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}

                        <div className="space-y-2">
                          <Label htmlFor="amount">Amount</Label>
                          <Input
                            id="amount"
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            {...form.register("indefiniteTransaction.amount")}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Account</Label>
                          <Select
                            onValueChange={(value) =>
                              form.setValue("indefiniteTransaction.accountId", value)
                            }
                            defaultValue={form.getValues("indefiniteTransaction.accountId")}
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
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* Indefinite - Transfer */}
                {selectedPaymentType === "indefinite" && indefiniteSubtype === "transfer" && (
                  <>
                    <div className="space-y-2">
                      <Label>From</Label>
                      <Select
                        onValueChange={(value) =>
                          form.setValue("indefiniteTransfer.fromAccountId", value)
                        }
                        defaultValue={form.getValues("indefiniteTransfer.fromAccountId")}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select source account" />
                        </SelectTrigger>
                        <SelectContent>
                          {accounts.map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {account.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>To</Label>
                      <Select
                        onValueChange={(value) =>
                          form.setValue("indefiniteTransfer.toAccountId", value)
                        }
                        defaultValue={form.getValues("indefiniteTransfer.toAccountId")}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select destination account" />
                        </SelectTrigger>
                        <SelectContent>
                          {accounts.map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {account.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="amount">Amount</Label>
                      <Input
                        id="amount"
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...form.register("indefiniteTransfer.amount")}
                      />
                    </div>
                  </>
                )}

                {/* By Term */}
                {selectedPaymentType === "by_term" && (
                  <>
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Select
                        onValueChange={(value) =>
                          form.setValue("byTerm.categoryId", value)
                        }
                        defaultValue={form.getValues("byTerm.categoryId")}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories
                            .filter((c) => c.type === "expense" && !c.parentId)
                            .map((cat) => (
                              <SelectItem key={cat.id} value={cat.id}>
                                {cat.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {form.watch("byTerm.categoryId") && (() => {
                      const catId = form.watch("byTerm.categoryId");
                      const tags = categoryTags[catId!] || [];
                      return (
                        <div className="space-y-2">
                          <Label>Tags (Optional)</Label>
                          <div className="flex flex-wrap gap-2">
                            {tags.map((tag) => {
                              const selectedTags = form.watch("byTerm.tagIds") || [];
                              const isSelected = selectedTags.includes(tag.id);
                              return (
                                <button
                                  key={tag.id}
                                  type="button"
                                  onClick={() => {
                                    const newTags = isSelected
                                      ? selectedTags.filter((t) => t !== tag.id)
                                      : [...selectedTags, tag.id];
                                    form.setValue("byTerm.tagIds", newTags);
                                  }}
                                  className={cn(
                                    "px-3 py-1 rounded-full text-sm transition-colors",
                                    isSelected
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-secondary hover:bg-secondary/80"
                                  )}
                                >
                                  {tag.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="totalAmount">Total Amount</Label>
                        <Input
                          id="totalAmount"
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          {...form.register("byTerm.totalAmount")}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="totalPayments">Total Payments</Label>
                        <Input
                          id="totalPayments"
                          type="number"
                          min="1"
                          placeholder="12"
                          {...form.register("byTerm.totalPayments", { valueAsNumber: true })}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="remainingBalance">Remaining Balance (from bank statement)</Label>
                      <Input
                        id="remainingBalance"
                        type="number"
                        step="0.01"
                        placeholder="Leave empty to auto-calculate"
                        {...form.register("byTerm.remainingBalance")}
                      />
                      <p className="text-xs text-muted-foreground">
                        Saldo pendiente real de tu estado de cuenta. Si lo dejas vacío, se calcula automáticamente.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Credit Account</Label>
                      <Select
                        onValueChange={(value) =>
                          form.setValue("byTerm.creditAccountId", value)
                        }
                        defaultValue={form.getValues("byTerm.creditAccountId")}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select credit account" />
                        </SelectTrigger>
                        <SelectContent>
                          {accounts
                            .filter((a) => a.type === "credit")
                            .map((account) => (
                              <SelectItem key={account.id} value={account.id}>
                                {account.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>First Bill Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !form.watch("byTerm.firstBillDate") && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {form.watch("byTerm.firstBillDate") ? (
                              format(form.watch("byTerm.firstBillDate")!, "PPP")
                            ) : (
                              <span>Select first bill date</span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={form.watch("byTerm.firstBillDate")}
                            onSelect={(date) => {
                              if (date) {
                                form.setValue("byTerm.firstBillDate", date, { shouldDirty: true });
                              }
                            }}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Switch
                        id="reduceCreditLimit"
                        checked={form.watch("byTerm.reduceCreditLimit")}
                        onCheckedChange={(checked) =>
                          form.setValue("byTerm.reduceCreditLimit", checked)
                        }
                      />
                      <Label htmlFor="reduceCreditLimit">Reduce credit limit</Label>
                    </div>
                  </>
                )}

                {/* Subscription */}
                {selectedPaymentType === "subscription" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="price">Price</Label>
                      <Input
                        id="price"
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...form.register("subscription.price")}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="iconUrl">Icon URL (Optional)</Label>
                      <Input
                        id="iconUrl"
                        placeholder="https://res.cloudinary.com/..."
                        {...form.register("subscription.iconUrl")}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="paymentDay">Payment Day</Label>
                      <Input
                        id="paymentDay"
                        type="number"
                        min="1"
                        max="31"
                        placeholder="1"
                        {...form.register("subscription.paymentDay", { valueAsNumber: true })}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Billing Cycle</Label>
                      <Select
                        onValueChange={(value) =>
                          form.setValue("subscription.billingCycle", value as "weekly" | "monthly" | "quarterly" | "yearly" | "custom")
                        }
                        defaultValue={form.getValues("subscription.billingCycle")}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select cycle" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                          <SelectItem value="quarterly">Quarterly</SelectItem>
                          <SelectItem value="yearly">Yearly</SelectItem>
                          <SelectItem value="custom">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Select
                        onValueChange={(value) =>
                          form.setValue("subscription.categoryId", value)
                        }
                        defaultValue={form.getValues("subscription.categoryId")}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories
                            .filter((c) => c.type === "expense" && !c.parentId)
                            .map((cat) => (
                              <SelectItem key={cat.id} value={cat.id}>
                                {cat.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {form.watch("subscription.categoryId") && (() => {
                      const catId = form.watch("subscription.categoryId");
                      const tags = categoryTags[catId!] || [];
                      return (
                        <div className="space-y-2">
                          <Label>Tags (Optional)</Label>
                          <div className="flex flex-wrap gap-2">
                            {tags.map((tag) => {
                              const selectedTags = form.watch("subscription.tagIds") || [];
                              const isSelected = selectedTags.includes(tag.id);
                              return (
                                <button
                                  key={tag.id}
                                  type="button"
                                  onClick={() => {
                                    const newTags = isSelected
                                      ? selectedTags.filter((t) => t !== tag.id)
                                      : [...selectedTags, tag.id];
                                    form.setValue("subscription.tagIds", newTags);
                                  }}
                                  className={cn(
                                    "px-3 py-1 rounded-full text-sm transition-colors",
                                    isSelected
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-secondary hover:bg-secondary/80"
                                  )}
                                >
                                  {tag.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    <div className="space-y-2">
                      <Label>Account (Optional)</Label>
                      <Select
                        onValueChange={(value) =>
                          form.setValue("subscription.accountId", value)
                        }
                        defaultValue={form.getValues("subscription.accountId")}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select account" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {accounts.map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {account.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}

                {/* Common fields for Indefinite - Cycle Configuration */}
                {selectedPaymentType === "indefinite" && (
                  <>
                    {/* Start Date */}
                    <div className="space-y-2">
                      <Label>Start Date (Optional)</Label>
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
                            {form.watch("startDate") ? (
                              format(form.watch("startDate")!, "PPP")
                            ) : (
                              <span>Select start date</span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={form.watch("startDate")}
                            onSelect={(date) => {
                              if (date) {
                                form.setValue("startDate", date, { shouldDirty: true });
                              }
                            }}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>

                    {/* End Date */}
                    <div className="space-y-2">
                      <Label>End Date (Optional)</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !form.watch("endDate") && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {form.watch("endDate") ? (
                              format(form.watch("endDate")!, "PPP")
                            ) : (
                              <span>Select end date</span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={form.watch("endDate")}
                            onSelect={(date) => {
                              if (date) {
                                form.setValue("endDate", date, { shouldDirty: true });
                              }
                            }}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>

                    <div className="space-y-2">
                      <Label>Cycle</Label>
                      <Select
                        onValueChange={(value) => {
                          form.setValue("cycleType", value as CycleType);
                          // Reset cycleConfig when type changes
                          form.setValue("cycleConfig", {
                            type: value as CycleType,
                            interval: 1,
                            daysOfWeek: [],
                            daysOfMonth: [],
                            monthsOfYear: [],
                            time: "00:00",
                          });
                          // Reset specific day per month when cycle type changes
                          setUseSpecificDayPerMonth(false);
                        }}
                        defaultValue={form.getValues("cycleType")}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select cycle" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="daily">Daily</SelectItem>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                          <SelectItem value="yearly">Yearly</SelectItem>
                          <SelectItem value="custom">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Daily Options */}
                    {form.watch("cycleType") === "daily" && (
                      <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="interval">Every</Label>
                            <Input
                              id="interval"
                              type="number"
                              min="1"
                              placeholder="1"
                              {...form.register("cycleConfig.interval", { valueAsNumber: true })}
                            />
                            <p className="text-xs text-muted-foreground">day(s)</p>
                          </div>
                          <div className="space-y-2">
                            <Label>Time</Label>
                            <Input
                              type="time"
                              {...form.register("cycleConfig.time")}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Weekly Options */}
                    {form.watch("cycleType") === "weekly" && (
                      <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="interval">Every</Label>
                            <Input
                              id="interval"
                              type="number"
                              min="1"
                              placeholder="1"
                              {...form.register("cycleConfig.interval", { valueAsNumber: true })}
                            />
                            <p className="text-xs text-muted-foreground">week(s)</p>
                          </div>
                          <div className="space-y-2">
                            <Label>Time</Label>
                            <Input
                              type="time"
                              {...form.register("cycleConfig.time")}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>On day(s)</Label>
                          <div className="flex flex-wrap gap-2">
                            {[
                              { value: 0, label: "Sun" },
                              { value: 1, label: "Mon" },
                              { value: 2, label: "Tue" },
                              { value: 3, label: "Wed" },
                              { value: 4, label: "Thu" },
                              { value: 5, label: "Fri" },
                              { value: 6, label: "Sat" },
                            ].map((day) => {
                              const currentDays = form.watch("cycleConfig.daysOfWeek") || [];
                              const isSelected = currentDays.includes(day.value);
                              return (
                                <button
                                  key={day.value}
                                  type="button"
                                  onClick={() => {
                                    const newDays = isSelected
                                      ? currentDays.filter((d) => d !== day.value)
                                      : [...currentDays, day.value];
                                    form.setValue("cycleConfig.daysOfWeek", newDays);
                                  }}
                                  className={cn(
                                    "px-3 py-1 rounded-full text-sm transition-colors",
                                    isSelected
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-secondary hover:bg-secondary/80"
                                  )}
                                >
                                  {day.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Monthly Options */}
                    {form.watch("cycleType") === "monthly" && (() => {
                      const start = form.watch("startDate");
                      const end = form.watch("endDate");
                      const interval = form.watch("cycleConfig.interval") || 1;
                      const totalMonths = start && end ? getTotalMonthsInRange(start, end) : 0;
                      const showSpecificDayPerMonth = start && end && interval < totalMonths;

                      return (
                        <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="interval">Every</Label>
                              <Input
                                id="interval"
                                type="number"
                                min="1"
                                max={totalMonths > 0 ? totalMonths : undefined}
                                placeholder="1"
                                {...form.register("cycleConfig.interval", { valueAsNumber: true })}
                              />
                              {totalMonths > 0 && (
                                <p className="text-xs text-muted-foreground">
                                  max: {totalMonths} month{totalMonths !== 1 ? "s" : ""} in range
                                </p>
                              )}
                            </div>
                            <div className="space-y-2">
                              <Label>Time</Label>
                              <Input
                                type="time"
                                {...form.register("cycleConfig.time")}
                              />
                            </div>
                          </div>

                          {/* Switch for specific day per month - only when start and end dates are set and interval < total months */}
                          {showSpecificDayPerMonth && (
                            <div className="flex items-center space-x-2 pt-2">
                              <Switch
                                id="useSpecificDayPerMonth"
                                checked={useSpecificDayPerMonth}
                                onCheckedChange={(checked) => {
                                  setUseSpecificDayPerMonth(checked);
                                }}
                              />
                              <Label htmlFor="useSpecificDayPerMonth" className="cursor-pointer">
                                Specific day per month
                              </Label>
                            </div>
                          )}

                          {/* Normal day(s) of month - shown when switch is OFF or dates not set or interval >= total months */}
                          {!useSpecificDayPerMonth && (
                            <div className="space-y-2">
                              <Label>On day(s) of month</Label>
                              <div className="flex flex-wrap gap-1">
                                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => {
                                  const currentDays = form.watch("cycleConfig.daysOfMonth") || [];
                                  const isSelected = currentDays.includes(day);
                                  return (
                                    <button
                                      key={day}
                                      type="button"
                                      onClick={() => {
                                        const newDays = isSelected
                                          ? currentDays.filter((d) => d !== day)
                                          : [...currentDays, day];
                                        form.setValue("cycleConfig.daysOfMonth", newDays);
                                      }}
                                      className={cn(
                                        "w-8 h-8 rounded text-sm transition-colors flex items-center justify-center",
                                        isSelected
                                          ? "bg-primary text-primary-foreground"
                                          : "bg-secondary hover:bg-secondary/80"
                                      )}
                                    >
                                      {day}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Specific Day per Month - shown when switch is ON and dates are set and interval < total months */}
                          {useSpecificDayPerMonth && showSpecificDayPerMonth && (
                            <div className="space-y-3 pt-2">
                              <Label>Specific Day per Month</Label>
                              <p className="text-xs text-muted-foreground">
                                Set a specific day for each occurrence (every {interval} month{interval !== 1 ? "s" : ""}).
                              </p>
                              <div className="grid grid-cols-2 gap-3 max-h-48 overflow-y-auto">
                                {getMonthsInRange(start!, end!, interval).map(({ key, label }) => (
                                  <div key={key} className="flex items-center gap-2">
                                    <span className="text-sm w-20">{label}</span>
                                    <Input
                                      type="number"
                                      min="1"
                                      max="31"
                                      className="w-16 h-8"
                                      value={perMonthDays[key] || ""}
                                      onChange={(e) => {
                                        const day = parseInt(e.target.value);
                                        if (!isNaN(day) && day >= 1 && day <= 31) {
                                          setPerMonthDays((prev) => ({ ...prev, [key]: day }));
                                        } else if (e.target.value === "") {
                                          setPerMonthDays((prev) => {
                                            const updated = { ...prev };
                                            delete updated[key];
                                            return updated;
                                          });
                                        }
                                      }}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}


                    {/* Yearly Options */}
                    {form.watch("cycleType") === "yearly" && (
                      <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="interval">Every</Label>
                            <Input
                              id="interval"
                              type="number"
                              min="1"
                              placeholder="1"
                              {...form.register("cycleConfig.interval", { valueAsNumber: true })}
                            />
                            <p className="text-xs text-muted-foreground">year(s)</p>
                          </div>
                          <div className="space-y-2">
                            <Label>Time</Label>
                            <Input
                              type="time"
                              {...form.register("cycleConfig.time")}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>In month(s)</Label>
                          <div className="flex flex-wrap gap-1">
                            {[
                              { value: 1, label: "Jan" },
                              { value: 2, label: "Feb" },
                              { value: 3, label: "Mar" },
                              { value: 4, label: "Apr" },
                              { value: 5, label: "May" },
                              { value: 6, label: "Jun" },
                              { value: 7, label: "Jul" },
                              { value: 8, label: "Aug" },
                              { value: 9, label: "Sep" },
                              { value: 10, label: "Oct" },
                              { value: 11, label: "Nov" },
                              { value: 12, label: "Dec" },
                            ].map((month) => {
                              const currentMonths = form.watch("cycleConfig.monthsOfYear") || [];
                              const isSelected = currentMonths.includes(month.value);
                              return (
                                <button
                                  key={month.value}
                                  type="button"
                                  onClick={() => {
                                    const newMonths = isSelected
                                      ? currentMonths.filter((m) => m !== month.value)
                                      : [...currentMonths, month.value];
                                    form.setValue("cycleConfig.monthsOfYear", newMonths);
                                  }}
                                  className={cn(
                                    "px-2 py-1 rounded text-sm transition-colors",
                                    isSelected
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-secondary hover:bg-secondary/80"
                                  )}
                                >
                                  {month.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>On day(s) of month</Label>
                          <div className="flex flex-wrap gap-1">
                            {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => {
                              const currentDays = form.watch("cycleConfig.daysOfMonth") || [];
                              const isSelected = currentDays.includes(day);
                              return (
                                <button
                                  key={day}
                                  type="button"
                                  onClick={() => {
                                    const newDays = isSelected
                                      ? currentDays.filter((d) => d !== day)
                                      : [...currentDays, day];
                                    form.setValue("cycleConfig.daysOfMonth", newDays);
                                  }}
                                  className={cn(
                                    "w-8 h-8 rounded text-sm transition-colors flex items-center justify-center",
                                    isSelected
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-secondary hover:bg-secondary/80"
                                  )}
                                >
                                  {day}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Custom Options */}
                    {form.watch("cycleType") === "custom" && (
                      <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
                        <p className="text-sm text-muted-foreground">
                          Configure your custom cycle with fine-grained control.
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="interval">Every</Label>
                            <Input
                              id="interval"
                              type="number"
                              min="1"
                              placeholder="1"
                              {...form.register("cycleConfig.interval", { valueAsNumber: true })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Time</Label>
                            <Input
                              type="time"
                              {...form.register("cycleConfig.time")}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Days of Week (optional)</Label>
                          <div className="flex flex-wrap gap-1">
                            {[
                              { value: 0, label: "Sun" },
                              { value: 1, label: "Mon" },
                              { value: 2, label: "Tue" },
                              { value: 3, label: "Wed" },
                              { value: 4, label: "Thu" },
                              { value: 5, label: "Fri" },
                              { value: 6, label: "Sat" },
                            ].map((day) => {
                              const currentDays = form.watch("cycleConfig.daysOfWeek") || [];
                              const isSelected = currentDays.includes(day.value);
                              return (
                                <button
                                  key={day.value}
                                  type="button"
                                  onClick={() => {
                                    const newDays = isSelected
                                      ? currentDays.filter((d) => d !== day.value)
                                      : [...currentDays, day.value];
                                    form.setValue("cycleConfig.daysOfWeek", newDays);
                                  }}
                                  className={cn(
                                    "px-2 py-1 rounded text-sm transition-colors",
                                    isSelected
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-secondary hover:bg-secondary/80"
                                  )}
                                >
                                  {day.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Days of Month (optional)</Label>
                          <div className="flex flex-wrap gap-1">
                            {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => {
                              const currentDays = form.watch("cycleConfig.daysOfMonth") || [];
                              const isSelected = currentDays.includes(day);
                              return (
                                <button
                                  key={day}
                                  type="button"
                                  onClick={() => {
                                    const newDays = isSelected
                                      ? currentDays.filter((d) => d !== day)
                                      : [...currentDays, day];
                                    form.setValue("cycleConfig.daysOfMonth", newDays);
                                  }}
                                  className={cn(
                                    "w-8 h-8 rounded text-sm transition-colors flex items-center justify-center",
                                    isSelected
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-secondary hover:bg-secondary/80"
                                  )}
                                >
                                  {day}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Description - common */}
                <div className="space-y-2">
                  <Label htmlFor="description">Description (Optional)</Label>
                  <Input
                    id="description"
                    placeholder="Add a description..."
                    {...form.register("description")}
                  />
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeModal}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {editingPayment ? "Update" : "Create"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-red-500 dark:bg-red-900/20">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {(["all", "indefinite", "by_term", "subscription"] as TabType[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors relative",
              activeTab === tab
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab === "all"
              ? "All"
              : tab === "indefinite"
              ? "Indefinite"
              : tab === "by_term"
              ? "By Term"
              : "Subscription"}
            {activeTab === tab && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Payments</CardTitle>
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{activePayments.length}</p>
            <p className="text-xs text-muted-foreground">
              of {filteredPayments.length} total
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Estimate</CardTitle>
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatCurrency(
                activePayments
                  .reduce((sum, p) => {
                    const typeSpecific = p.typeSpecific as TypeSpecificData;
                    let amount = 0;
                    if (p.paymentType === "subscription" || p.paymentType === "indefinite") {
                      amount = parseFloat(typeSpecific.price || typeSpecific.amount || "0");
                    } else if (p.paymentType === "by_term") {
                      amount = parseFloat(typeSpecific.totalAmount || "0") / (typeSpecific.totalPayments || 1);
                    }
                    return sum + amount;
                  }, 0)
                  .toString()
              )}
            </p>
            <p className="text-xs text-muted-foreground">per month</p>
          </CardContent>
        </Card>
      </div>

      {/* Payments Table */}
      {filteredPayments.length === 0 ? (
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
                <TableHead>Type</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Cycle</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPayments.map((payment) => {
                const nextDate = payment.nextPaymentDate ? new Date(payment.nextPaymentDate) : null;
                const isPast = nextDate && nextDate < new Date();

                return (
                  <TableRow key={payment.id}>
                    <TableCell className="font-medium">{payment.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {TYPE_LABELS[payment.paymentType] || payment.paymentType}
                      </Badge>
                    </TableCell>
                    <TableCell>{getCategoryDisplay(payment)}</TableCell>
                    <TableCell>{getAccountDisplay(payment)}</TableCell>
                    <TableCell>
                      {CYCLE_LABELS[payment.cycleType] || payment.cycleType}
                    </TableCell>
                    <TableCell className="text-right">{getAmountDisplay(payment)}</TableCell>
                    <TableCell>
                      {nextDate && (
                        <div className="flex flex-col">
                          <span>{format(nextDate, "MMM d, yyyy")}</span>
                          <span
                            className={`text-xs ${
                              isPast ? "text-red-500" : "text-muted-foreground"
                            }`}
                          >
                            {isPast
                              ? "Overdue"
                              : formatDistanceToNow(nextDate, { addSuffix: true })}
                          </span>
                        </div>
                      )}
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
