import { pgTable, uuid, varchar, decimal, timestamp, text, integer, pgEnum, jsonb } from 'drizzle-orm/pg-core';

// Enums
export const accountTypeEnum = pgEnum('account_type', ['cash', 'debit', 'credit']);
export const transactionTypeEnum = pgEnum('transaction_type', ['income', 'expense', 'transfer']);
export const currencyEnum = pgEnum('currency', ['USD', 'EUR', 'GBP', 'MXN']);
export const recurringPaymentTypeEnum = pgEnum('recurring_payment_type', ['indefinite', 'by_term', 'subscription']);
export const cycleTypeEnum = pgEnum('cycle_type', ['daily', 'weekly', 'monthly', 'yearly', 'custom']);

// Users Table
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Categories Table
export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  type: transactionTypeEnum('type').notNull(), // 'income' | 'expense'
  iconUrl: varchar('icon_url', { length: 500 }),
  color: varchar('color', { length: 7 }),
  parentId: uuid('parent_id'), // Self-reference handled in queries, not via Drizzle constraint
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Tags Table
export const tags = pgTable('tags', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Accounts Table
export const accounts = pgTable('accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  type: accountTypeEnum('type').notNull(),
  currency: currencyEnum('currency').notNull().default('USD'),
  balance: decimal('balance', { precision: 15, scale: 2 }).notNull().default('0'),
  institution: varchar('institution', { length: 255 }),
  note: text('note'),
  color: varchar('color', { length: 7 }),
  iconUrl: varchar('icon_url', { length: 500 }),
  // Débito y Efectivo
  countInAssets: integer('count_in_assets').notNull().default(1),
  hideBalance: integer('hide_balance').notNull().default(0),
  // Crédito
  creditLimit: decimal('credit_limit', { precision: 15, scale: 2 }),
  owedAmount: decimal('owed_amount', { precision: 15, scale: 2 }),
  billingDate: integer('billing_date'),
  dueDate: integer('due_date'),
  paymentReminder: integer('payment_reminder').notNull().default(0),
  // Legacy
  isActive: integer('is_active').notNull().default(1),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Transactions Table
export const transactions = pgTable('transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
  type: transactionTypeEnum('type').notNull(),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  description: text('description'),
  tagIds: text('tag_ids'), // Comma-separated UUIDs for simplicity
  recurringPaymentId: uuid('recurring_payment_id').references(() => recurringPayments.id, { onDelete: 'cascade' }),
  date: timestamp('date').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Budgets Table
export const budgets = pgTable('budgets', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  period: varchar('period', { length: 50 }).notNull(),
  category: varchar('category', { length: 255 }),
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Recurring Payments Table
export const recurringPayments = pgTable('recurring_payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  paymentType: recurringPaymentTypeEnum('payment_type').notNull(),

  // Common fields
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),

  // Cycle
  cycleType: cycleTypeEnum('cycle_type').notNull(),
  cycleConfig: jsonb('cycle_config'),

  // Dates
  startDate: timestamp('start_date'),
  endDate: timestamp('end_date'),
  nextPaymentDate: timestamp('next_payment_date'),

  // Type-specific (JSON)
  typeSpecific: jsonb('type_specific'),

  // Status
  isActive: integer('is_active').notNull().default(1),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Investments Table
export const investments = pgTable('investments', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 100 }).notNull(),
  ticker: varchar('ticker', { length: 20 }),
  quantity: decimal('quantity', { precision: 15, scale: 8 }),
  purchasePrice: decimal('purchase_price', { precision: 15, scale: 2 }),
  currentPrice: decimal('current_price', { precision: 15, scale: 2 }),
  purchaseDate: timestamp('purchase_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Loans Table
export const loans = pgTable('loans', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 255 }).notNull(),
  principal: decimal('principal', { precision: 15, scale: 2 }).notNull(),
  interestRate: decimal('interest_rate', { precision: 5, scale: 2 }).notNull(),
  remainingBalance: decimal('remaining_balance', { precision: 15, scale: 2 }).notNull(),
  monthlyPayment: decimal('monthly_payment', { precision: 15, scale: 2 }).notNull(),
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date'),
  isActive: integer('is_active').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type RecurringPayment = typeof recurringPayments.$inferSelect;
export type Investment = typeof investments.$inferSelect;
export type Loan = typeof loans.$inferSelect;
