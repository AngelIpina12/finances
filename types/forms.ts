import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.email('Invalid email address'),
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
  type: z.enum(['checking', 'savings', 'credit', 'investment']),
  currency: z.enum(['USD', 'EUR', 'GBP', 'MXN']).default('USD'),
  balance: z.string().default('0.00'),
  institution: z.string().optional(),
});

export const transactionSchema = z.object({
  accountId: z.string().uuid('Invalid account ID'),
  type: z.enum(['income', 'expense', 'transfer']),
  amount: z.string().refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    'Amount must be a positive number'
  ),
  category: z.string().optional(),
  description: z.string().optional(),
  date: z.date().default(new Date()),
  transferAccountId: z.string().uuid('Invalid transfer account ID').or(z.literal('')).optional().transform(v => v === '' ? undefined : v),
});

export const recurringPaymentSchema = z.object({
  accountId: z.string().uuid('Invalid account ID'),
  name: z.string().min(1, 'Name is required'),
  amount: z.string().refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    'Amount must be a positive number'
  ),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  category: z.string().optional(),
  nextPaymentDate: z.date(),
});

export const budgetSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  amount: z.string().refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    'Amount must be a positive number'
  ),
  period: z.enum(['weekly', 'monthly', 'yearly']),
  category: z.string(),
  startDate: z.date(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type AccountInput = z.infer<typeof accountSchema>;
export type TransactionInput = z.infer<typeof transactionSchema>;
export type RecurringPaymentInput = z.infer<typeof recurringPaymentSchema>;
export type BudgetInput = z.infer<typeof budgetSchema>;

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
