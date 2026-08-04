"use server";

import { auth } from "@/lib/auth";
import { drizzleDb, accounts, recurringPayments, budgetCreditCards, budgetCategoryCreditAllocations, categories, type Budget, type BudgetCreditCard, type BudgetCategoryCreditAllocation, type Account, type Category } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import Decimal from "decimal.js";
import { addMonths, startOfMonth, endOfMonth } from "date-fns";

// Type-specific data interface (mirrors recurring-actions.ts)
interface TypeSpecificData {
  subtype?: 'transaction' | 'transfer';
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
  iconUrl?: string;
  price?: string;
  billingCycle?: string;
  billingConfig?: CycleConfig;
  paymentDay?: number;
  endDate?: Date;
}

interface CycleConfig {
  type: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
  interval: number;
  daysOfWeek?: number[];
  daysOfMonth?: number[];
  monthsOfYear?: number[];
  time: string;
  perMonthDays?: Record<string, number>;
}

// Get credit card accounts for a user
export async function getUserCreditCards(): Promise<Account[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const creditCards = await drizzleDb
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, session.user.id), eq(accounts.type, "credit")));

  return creditCards;
}

// Get categories for a user
export async function getUserCategories(): Promise<Category[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const cats = await drizzleDb
    .select()
    .from(categories)
    .where(eq(categories.userId, session.user.id));

  return cats;
}

// Interface for CC allocation with category name
export interface BudgetCCAccountWithAllocations {
  id: string;
  budgetId: string;
  creditAccountId: string;
  accountName?: string;
  billingDate?: number;
  dueDate?: number;
  allocations: Array<{
    id: string;
    budgetCreditCardId: string;
    categoryId: string;
    categoryName?: string;
    monthlyAmount: string;
  }>;
}

// Get budget CC configurations with full details
export async function getBudgetCreditCards(budgetId: string): Promise<BudgetCCAccountWithAllocations[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const ccs = await drizzleDb
    .select()
    .from(budgetCreditCards)
    .where(eq(budgetCreditCards.budgetId, budgetId));

  if (ccs.length === 0) return [];

  // Get all accounts for name lookup
  const accountsList = await drizzleDb
    .select()
    .from(accounts)
    .where(eq(accounts.userId, session.user.id));
  const accountMap = new Map(accountsList.map(a => [a.id, a]));

  // Get all categories for name lookup
  const categoriesList = await drizzleDb
    .select()
    .from(categories)
    .where(eq(categories.userId, session.user.id));
  const categoryMap = new Map(categoriesList.map(c => [c.id, c]));

  const result: BudgetCCAccountWithAllocations[] = [];

  for (const cc of ccs) {
    const allocations = await drizzleDb
      .select()
      .from(budgetCategoryCreditAllocations)
      .where(eq(budgetCategoryCreditAllocations.budgetCreditCardId, cc.id));

    const account = accountMap.get(cc.creditAccountId);

    result.push({
      id: cc.id,
      budgetId: cc.budgetId,
      creditAccountId: cc.creditAccountId,
      accountName: account?.name,
      billingDate: account?.billingDate as number | undefined,
      dueDate: account?.dueDate as number | undefined,
      allocations: allocations.map(a => ({
        id: a.id,
        budgetCreditCardId: a.budgetCreditCardId,
        categoryId: a.categoryId,
        categoryName: categoryMap.get(a.categoryId)?.name,
        monthlyAmount: a.monthlyAmount,
      })),
    });
  }

  return result;
}

// Save budget CC configuration
export async function saveBudgetCreditCards(
  budgetId: string,
  ccAccounts: Array<{
    creditAccountId: string;
    categoryAllocations: Array<{ categoryId: string; monthlyAmount: string }>;
  }>
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Delete existing allocations first (they reference budgetCreditCards)
  const existing = await drizzleDb
    .select()
    .from(budgetCreditCards)
    .where(eq(budgetCreditCards.budgetId, budgetId));

  for (const cc of existing) {
    await drizzleDb.delete(budgetCategoryCreditAllocations)
      .where(eq(budgetCategoryCreditAllocations.budgetCreditCardId, cc.id));
  }

  // Delete existing CC entries
  await drizzleDb.delete(budgetCreditCards)
    .where(eq(budgetCreditCards.budgetId, budgetId));

  // Insert new configurations
  for (const cc of ccAccounts) {
    if (!cc.creditAccountId) continue;

    const [newCC] = await drizzleDb
      .insert(budgetCreditCards)
      .values({ budgetId, creditAccountId: cc.creditAccountId })
      .returning();

    for (const alloc of cc.categoryAllocations) {
      if (!alloc.categoryId || !alloc.monthlyAmount) continue;

      await drizzleDb
        .insert(budgetCategoryCreditAllocations)
        .values({
          budgetCreditCardId: newCC.id,
          categoryId: alloc.categoryId,
          monthlyAmount: alloc.monthlyAmount,
        });
    }
  }
}

// Interface for CC debt projection
export interface CCDebtProjection {
  creditAccountId: string;
  accountName: string;
  billingDate: number;
  dueDate: number;
  projections: Array<{
    periodStart: Date;
    periodEnd: Date;
    periodLabel: string;
    prePlannedSpending: number;
    byTermRemaining: number;
    byTermMonthlyPayment: number;
    subscriptionTotal: number;
    totalNewDebt: number;
    cumulativeDebt: number;
    minimumPaymentDue: number;
  }>;
}

// Calculate remaining balance for a by_term payment
function calculateRemainingBalance(
  totalAmount: string,
  totalPayments: number,
  firstBillDate: Date,
  paymentStartDate: Date | null
): Decimal {
  const total = new Decimal(totalAmount || "0");
  const monthlyPayment = total.dividedBy(totalPayments);
  const start = paymentStartDate || firstBillDate;
  const now = new Date();

  if (now >= start) {
    const monthsElapsed = Math.max(
      0,
      (now.getFullYear() - start.getFullYear()) * 12 +
      (now.getMonth() - start.getMonth())
    );
    const amountPaid = monthlyPayment.times(Math.min(monthsElapsed, totalPayments));
    return total.minus(amountPaid);
  }

  return total;
}

// Project CC debt forward
export async function projectCreditCardDebt(
  budgetId: string,
  periodsAhead: number = 6
): Promise<CCDebtProjection[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Get budget CC configs
  const budgetCCs = await getBudgetCreditCards(budgetId);
  if (budgetCCs.length === 0) return [];

  // Get credit card accounts with current owed amounts
  const creditCards = await getUserCreditCards();
  const ccMap = new Map(creditCards.map(cc => [cc.id, cc]));

  // Get by_term payments (MSI) for this user
  const byTermPayments = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(and(
      eq(recurringPayments.userId, session.user.id),
      eq(recurringPayments.paymentType, "by_term"),
      eq(recurringPayments.isActive, 1)
    ));

  // Get subscription payments
  const subscriptionPayments = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(and(
      eq(recurringPayments.userId, session.user.id),
      eq(recurringPayments.paymentType, "subscription"),
      eq(recurringPayments.isActive, 1)
    ));

  const results: CCDebtProjection[] = [];
  const now = new Date();

  for (const budgetCC of budgetCCs) {
    const cc = ccMap.get(budgetCC.creditAccountId);
    if (!cc) continue;

    const billingDate = (cc.billingDate as number) || 1;
    const dueDate = (cc.dueDate as number) || 20;
    const currentOwed = parseFloat((cc.owedAmount as string) || "0");

    const projections = [];
    let cumulativeDebt = currentOwed;

    for (let i = 0; i < periodsAhead; i++) {
      // Calculate period bounds based on CC billing cycle
      const periodStart = startOfMonth(addMonths(now, i));
      const periodEnd = endOfMonth(addMonths(now, i));
      const periodLabel = periodStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

      // Pre-planned spending from category allocations
      const prePlannedSpending = budgetCC.allocations.reduce(
        (sum, alloc) => sum + parseFloat(alloc.monthlyAmount || "0"),
        0
      );

      // Calculate by_term (MSI) debt for this period
      let byTermRemaining = new Decimal(0);
      let byTermMonthlyPayment = new Decimal(0);

      for (const payment of byTermPayments) {
        const typeSpecific = payment.typeSpecific as TypeSpecificData;
        if (typeSpecific.creditAccountId !== budgetCC.creditAccountId) continue;

        const totalAmount = typeSpecific.totalAmount || "0";
        const totalPayments = typeSpecific.totalPayments || 1;
        const monthlyPayment = new Decimal(totalAmount).dividedBy(totalPayments);

        const firstBillDate = typeSpecific.firstBillDate
          ? new Date(typeSpecific.firstBillDate)
          : (payment.startDate ? new Date(payment.startDate) : new Date());

        const remainingBalance = payment.remainingBalance
          ? new Decimal(payment.remainingBalance)
          : calculateRemainingBalance(totalAmount, totalPayments, firstBillDate, payment.startDate ? new Date(payment.startDate) : null);

        byTermRemaining = byTermRemaining.plus(remainingBalance);
        byTermMonthlyPayment = byTermMonthlyPayment.plus(monthlyPayment);
      }

      // Calculate subscriptions for this CC
      let subscriptionTotal = new Decimal(0);
      for (const sub of subscriptionPayments) {
        const typeSpecific = sub.typeSpecific as TypeSpecificData;
        // Check if subscription is charged to this credit card
        if (typeSpecific.accountId && typeSpecific.accountId !== budgetCC.creditAccountId) continue;

        // If no specific account, assume it goes to any CC or check if it matches
        subscriptionTotal = subscriptionTotal.plus(parseFloat(typeSpecific.price || "0"));
      }

      // Total new debt this period
      const totalNewDebt = prePlannedSpending +
        byTermMonthlyPayment.toNumber() +
        subscriptionTotal.toNumber();

      // Add to cumulative debt
      cumulativeDebt += totalNewDebt;

      // Minimum payment due (simplified: minimum of 5% or minimum payment of $50)
      const minimumPaymentDue = Math.max(cumulativeDebt * 0.05, 50);

      projections.push({
        periodStart,
        periodEnd,
        periodLabel,
        prePlannedSpending,
        byTermRemaining: byTermRemaining.toNumber(),
        byTermMonthlyPayment: byTermMonthlyPayment.toNumber(),
        subscriptionTotal: subscriptionTotal.toNumber(),
        totalNewDebt,
        cumulativeDebt,
        minimumPaymentDue,
      });
    }

    results.push({
      creditAccountId: budgetCC.creditAccountId,
      accountName: cc.name,
      billingDate,
      dueDate,
      projections,
    });
  }

  return results;
}

// Interface for full projection result with CC
export interface FullProjectionWithCC {
  ccDebtProjections: CCDebtProjection[];
  totalMonthlyDebtPayment: number;
  totalCumulativeDebt: number;
  totalNewDebtPerMonth: number[];
}

// Get full CC projection for a budget or all user budgets
export async function getFullCCProjection(
  budgetId?: string,
  periodsAhead: number = 6
): Promise<FullProjectionWithCC> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  let ccProjections: CCDebtProjection[] = [];

  if (budgetId) {
    ccProjections = await projectCreditCardDebt(budgetId, periodsAhead);
  } else {
    // Get all budget IDs with CC tracking for this user
    const { budgets } = await import("@/lib/db");
    const userBudgets = await drizzleDb
      .select({ id: budgetCreditCards.budgetId })
      .from(budgetCreditCards)
      .innerJoin(budgets, eq(budgets.id, budgetCreditCards.budgetId))
      .where(eq(budgets.userId, session.user.id));

    // Collect unique budget IDs
    const budgetIds = [...new Set(userBudgets.map(r => r.id))];

    for (const bid of budgetIds) {
      const projections = await projectCreditCardDebt(bid, periodsAhead);
      ccProjections.push(...projections);
    }
  }

  // Aggregate totals
  const totalMonthlyDebtPayment = ccProjections.reduce((sum, cc) => {
    return sum + cc.projections.reduce((s, p) => s + p.byTermMonthlyPayment, 0);
  }, 0);

  const totalCumulativeDebt = ccProjections.reduce((sum, cc) => {
    const lastProjection = cc.projections[cc.projections.length - 1];
    return sum + (lastProjection?.cumulativeDebt || 0);
  }, 0);

  // Sum new debt per month across all CCs
  const totalNewDebtPerMonth: number[] = [];
  for (let i = 0; i < periodsAhead; i++) {
    const monthTotal = ccProjections.reduce((sum, cc) => {
      return sum + (cc.projections[i]?.totalNewDebt || 0);
    }, 0);
    totalNewDebtPerMonth.push(monthTotal);
  }

  return {
    ccDebtProjections: ccProjections,
    totalMonthlyDebtPayment,
    totalCumulativeDebt,
    totalNewDebtPerMonth,
  };
}
