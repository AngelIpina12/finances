import { pgTable, uuid, varchar, decimal, timestamp, text, integer, pgEnum, jsonb } from 'drizzle-orm/pg-core';

// Enums
export const accountTypeEnum = pgEnum('account_type', ['cash', 'debit', 'credit', 'fixed_income']);
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
  type: transactionTypeEnum('type').notNull().default('expense'),
  isGlobal: integer('is_global').notNull().default(1),
  isReusable: integer('is_reusable').notNull().default(0),
  rolloverType: varchar('rollover_type', { length: 50 }).notNull().default('disabled'),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
  category: varchar('category', { length: 255 }),
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date'),
  // Credit card tracking
  hasCreditCardTracking: integer('has_credit_card_tracking').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Budget Credit Cards Table (links a budget to specific credit card accounts)
export const budgetCreditCards = pgTable('budget_credit_cards', {
  id: uuid('id').defaultRandom().primaryKey(),
  budgetId: uuid('budget_id').notNull().references(() => budgets.id, { onDelete: 'cascade' }),
  creditAccountId: uuid('credit_account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Budget Category Credit Allocations Table (pre-planned category spending on specific CCs)
export const budgetCategoryCreditAllocations = pgTable('budget_category_credit_allocations', {
  id: uuid('id').defaultRandom().primaryKey(),
  budgetCreditCardId: uuid('budget_credit_card_id').notNull().references(() => budgetCreditCards.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
  monthlyAmount: decimal('monthly_amount', { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Budget Allocations Table (per-category amounts for category-level budgets)
export const budgetAllocations = pgTable('budget_allocations', {
  id: uuid('id').defaultRandom().primaryKey(),
  budgetId: uuid('budget_id').notNull().references(() => budgets.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Budget Periods Table (tracks each period instance with rollover)
export const budgetPeriods = pgTable('budget_periods', {
  id: uuid('id').defaultRandom().primaryKey(),
  budgetId: uuid('budget_id').notNull().references(() => budgets.id, { onDelete: 'cascade' }),
  periodStart: timestamp('period_start').notNull(),
  periodEnd: timestamp('period_end').notNull(),
  allocatedAmount: decimal('allocated_amount', { precision: 15, scale: 2 }).notNull(),
  rolloverAmount: decimal('rollover_amount', { precision: 15, scale: 2 }).default('0'),
  totalAvailable: decimal('total_available', { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
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

  // For by_term MSI: original total amount (不变)
  // For by_term MSI: remaining balance (actual from bank statement)
  remainingBalance: decimal('remaining_balance', { precision: 15, scale: 2 }),

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

// Fixed Income Accounts Table
export const fixedIncomeAccounts = pgTable('fixed_income_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  linkedAccountId: uuid('linked_account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  currency: currencyEnum('currency').notNull().default('USD'),
  // Capital original (depósitos) - base para calcular qué es "nuevo dinero"
  originalPrincipal: decimal('original_principal', { precision: 15, scale: 2 }).notNull().default('0'),
  // Tier 1
  initialInterestRate: decimal('initial_interest_rate', { precision: 5, scale: 2 }).notNull(),
  initialAmountLimit: decimal('initial_amount_limit', { precision: 15, scale: 2 }).notNull(),
  // Tier 2
  hasSecondTier: integer('has_second_tier').notNull().default(0),
  secondInterestRate: decimal('second_interest_rate', { precision: 5, scale: 2 }),
  secondAmountLimit: decimal('second_amount_limit', { precision: 15, scale: 2 }),
  // Accumulated
  accumulatedInterest: decimal('accumulated_interest', { precision: 15, scale: 2 }).notNull().default('0'),
  lastAccrualDate: timestamp('last_accrual_date'),
  // Status
  isActive: integer('is_active').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Fixed Income Accruals Table (daily history)
export const fixedIncomeAccruals = pgTable('fixed_income_accruals', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => fixedIncomeAccounts.id, { onDelete: 'cascade' }),
  date: timestamp('date').notNull(),
  balanceAtStart: decimal('balance_at_start', { precision: 15, scale: 2 }).notNull(),
  interestEarned: decimal('interest_earned', { precision: 15, scale: 4 }).notNull(),
  balanceAtEnd: decimal('balance_at_end', { precision: 15, scale: 2 }).notNull(),
  effectiveRate: decimal('effective_rate', { precision: 5, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
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
export type BudgetAllocation = typeof budgetAllocations.$inferSelect;
export type BudgetPeriod = typeof budgetPeriods.$inferSelect;
export type BudgetCreditCard = typeof budgetCreditCards.$inferSelect;
export type NewBudgetCreditCard = typeof budgetCreditCards.$inferInsert;
export type BudgetCategoryCreditAllocation = typeof budgetCategoryCreditAllocations.$inferSelect;
export type NewBudgetCategoryCreditAllocation = typeof budgetCategoryCreditAllocations.$inferInsert;
export type RecurringPayment = typeof recurringPayments.$inferSelect;
export type Investment = typeof investments.$inferSelect;
export type Loan = typeof loans.$inferSelect;
export type FixedIncomeAccount = typeof fixedIncomeAccounts.$inferSelect;
export type FixedIncomeAccrual = typeof fixedIncomeAccruals.$inferSelect;
