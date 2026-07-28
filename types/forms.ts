import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

export const accountSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  type: z.enum(['cash', 'debit', 'credit']),
  currency: z.enum(['USD', 'EUR', 'GBP', 'MXN']).default('USD'),
  balance: z.string().default('0.00'),
  institution: z.string().optional(),
  note: z.string().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  iconUrl: z.string().url().optional().or(z.literal('')),
  countInAssets: z.boolean().default(true),
  hideBalance: z.boolean().default(false),
  creditLimit: z.string().optional(),
  owedAmount: z.string().optional(),
  billingDate: z.number().min(1).max(31).optional(),
  dueDate: z.number().min(1).max(31).optional(),
  paymentReminder: z.boolean().default(false),
});

export const categorySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  type: z.enum(['income', 'expense']),
  iconUrl: z.string().url().optional().or(z.literal('')).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  parentId: z.string().uuid().optional().nullable(),
});

export const tagSchema = z.object({
  name: z.string().min(1, 'Tag name is required').max(100),
  categoryId: z.string().uuid('Invalid category ID'),
});

export const transactionSchema = z.object({
  accountId: z.string().uuid('Invalid account ID'),
  type: z.enum(['income', 'expense', 'transfer']),
  categoryId: z.string().uuid('Invalid category ID').optional().nullable(),
  amount: z.string().refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    'Amount must be a positive number'
  ),
  description: z.string().optional(),
  tagIds: z.array(z.string()).optional(),
  date: z.union([z.string(), z.date()]).transform(val => {
    if (val instanceof Date) return val;
    if (typeof val === 'string') {
      if (val.startsWith('$D')) {
        return new Date(val.slice(2));
      }
      return new Date(val);
    }
    return new Date(val);
  }).default(new Date()),
  transferAccountId: z.string().uuid('Invalid transfer account ID').or(z.literal('')).optional().transform(v => v === '' ? undefined : v),
});

// Cycle Config Schema
export const cycleConfigSchema = z.object({
  type: z.enum(['daily', 'weekly', 'monthly', 'yearly', 'custom']),
  interval: z.number().min(1).default(1),
  daysOfWeek: z.array(z.number().min(0).max(6)).optional(),
  daysOfMonth: z.array(z.number().min(1).max(31)).optional(),
  monthsOfYear: z.array(z.number().min(1).max(12)).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).default("00:00"),
  // Per-month specific days: key is "YYYY-MM", value is day of month
  perMonthDays: z.record(z.string(), z.number().min(1).max(31)).optional(),
});

// Indefinite - Transaction
export const indefiniteTransactionSchema = z.object({
  subtype: z.literal('transaction'),
  accountId: z.string().uuid('Invalid account ID'),
  categoryId: z.preprocess(
    (val) => typeof val === 'string' && val === '' ? undefined : val,
    z.string().uuid().optional()
  ),
  subcategoryId: z.preprocess(
    (val) => typeof val === 'string' && val === '' ? undefined : val,
    z.string().uuid().optional()
  ),
  tagIds: z.array(z.string()).optional(),
  amount: z.string().refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    'Amount must be a positive number'
  ),
});

// Indefinite - Transfer
export const indefiniteTransferSchema = z.object({
  subtype: z.literal('transfer'),
  fromAccountId: z.string().uuid('Invalid account ID'),
  toAccountId: z.string().uuid('Invalid account ID'),
  amount: z.string().refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    'Amount must be a positive number'
  ),
});

// By Term
export const byTermSchema = z.object({
  categoryId: z.preprocess(
    (val) => typeof val === 'string' && val === '' ? undefined : val,
    z.string().uuid().optional()
  ),
  subcategoryId: z.preprocess(
    (val) => typeof val === 'string' && val === '' ? undefined : val,
    z.string().uuid().optional()
  ),
  tagIds: z.array(z.string()).optional(),
  totalAmount: z.string().refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    'Amount must be a positive number'
  ),
  totalPayments: z.number().min(1),
  firstBillDate: z.union([z.string(), z.date()]).transform(val => {
    if (val instanceof Date) return val;
    if (typeof val === 'string') {
      if (val.startsWith('$D')) {
        return new Date(val.slice(2));
      }
      return new Date(val);
    }
    return new Date(val);
  }),
  creditAccountId: z.string().uuid('Invalid account ID'),
  reduceCreditLimit: z.boolean().default(false),
});

// Subscription
export const subscriptionSchema = z.object({
  iconUrl: z.string().url().optional().or(z.literal('')),
  price: z.string().refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    'Price must be a positive number'
  ),
  accountId: z.string().uuid().optional(),
  billingCycle: z.enum(['weekly', 'monthly', 'quarterly', 'yearly', 'custom']),
  billingConfig: cycleConfigSchema.optional(),
  paymentDay: z.number().min(1).max(31).optional(),
  endDate: z.union([z.string(), z.date()]).optional().transform(val => {
    if (!val) return undefined;
    if (val instanceof Date) return val;
    if (typeof val === 'string') {
      if (val.startsWith('$D')) {
        return new Date(val.slice(2));
      }
      return new Date(val);
    }
    return new Date(val);
  }),
});

// General recurring payment schema
export const recurringPaymentSchema = z.object({
  paymentType: z.enum(['indefinite', 'by_term', 'subscription']),
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().optional(),
  cycleType: z.enum(['daily', 'weekly', 'monthly', 'yearly', 'custom']),
  cycleConfig: cycleConfigSchema,
  startDate: z.union([z.string(), z.date()]).optional().transform(val => {
    if (!val) return undefined;
    if (val instanceof Date) return val;
    if (typeof val === 'string') {
      if (val.startsWith('$D')) {
        return new Date(val.slice(2));
      }
      return new Date(val);
    }
    return new Date(val);
  }),
  endDate: z.union([z.string(), z.date()]).optional().transform(val => {
    if (!val) return undefined;
    if (val instanceof Date) return val;
    if (typeof val === 'string') {
      if (val.startsWith('$D')) {
        return new Date(val.slice(2));
      }
      return new Date(val);
    }
    return new Date(val);
  }),
  typeSpecific: z.union([indefiniteTransactionSchema, indefiniteTransferSchema, byTermSchema, subscriptionSchema]),
});

export const budgetSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  amount: z.string().refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    'Amount must be a positive number'
  ),
  period: z.enum(['weekly', 'monthly', 'yearly']),
  category: z.string(),
  startDate: z.string().transform(val => {
    if (val.startsWith('$D')) {
      return new Date(val.slice(2));
    }
    return new Date(val);
  }),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type AccountInput = z.infer<typeof accountSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type TagInput = z.infer<typeof tagSchema>;
export type TransactionInput = z.infer<typeof transactionSchema>;
export type RecurringPaymentInput = z.infer<typeof recurringPaymentSchema>;
export type BudgetInput = z.infer<typeof budgetSchema>;

// Legacy CATEGORIES - kept for backwards compatibility
export const CATEGORIES = [
  "Food",
  "Transportation",
  "Entertainment",
  "Utilities",
  "Rent",
  "Healthcare",
  "Shopping",
  "Subscriptions",
  "Insurance",
  "Other",
] as const;

export type Category = typeof CATEGORIES[number];
