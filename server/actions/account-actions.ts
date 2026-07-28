"use server";

import { auth } from "@/lib/auth";
import { drizzleDb, accounts, type Account } from "@/lib/db";
import { eq, and, isNull, isNotNull, sql } from "drizzle-orm";
import { accountSchema } from "@/types/forms";
import { revalidatePath } from "next/cache";
import Decimal from "decimal.js";

export async function getAccounts(includeArchived = false): Promise<Account[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const conditions = [eq(accounts.userId, session.user.id)];

  if (!includeArchived) {
    conditions.push(isNull(accounts.deletedAt));
  }

  const userAccounts = await drizzleDb
    .select()
    .from(accounts)
    .where(and(...conditions));

  return userAccounts;
}

export async function getAccount(id: string): Promise<Account | null> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const account = await drizzleDb
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, session.user.id)))
    .limit(1);

  return account[0] || null;
}

export async function createAccount(data: {
  name: string;
  type: "cash" | "debit" | "credit";
  currency: "USD" | "EUR" | "GBP" | "MXN";
  balance?: string;
  institution?: string;
  note?: string;
  color?: string;
  iconUrl?: string;
  countInAssets?: boolean;
  hideBalance?: boolean;
  creditLimit?: string;
  owedAmount?: string;
  billingDate?: number;
  dueDate?: number;
  paymentReminder?: boolean;
}): Promise<Account> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const parsed = accountSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }

  const [newAccount] = await drizzleDb
    .insert(accounts)
    .values({
      userId: session.user.id,
      name: parsed.data.name,
      type: parsed.data.type,
      currency: parsed.data.currency,
      balance: parsed.data.balance || "0.00",
      institution: parsed.data.institution,
      note: parsed.data.note,
      color: parsed.data.color,
      iconUrl: parsed.data.iconUrl || null,
      countInAssets: parsed.data.countInAssets ? 1 : 0,
      hideBalance: parsed.data.hideBalance ? 1 : 0,
      creditLimit: parsed.data.creditLimit || null,
      owedAmount: parsed.data.owedAmount || null,
      billingDate: parsed.data.billingDate || null,
      dueDate: parsed.data.dueDate || null,
      paymentReminder: parsed.data.paymentReminder ? 1 : 0,
    })
    .returning();

  revalidatePath("/accounts");
  return newAccount;
}

export async function updateAccount(
  id: string,
  data: {
    name?: string;
    type?: "cash" | "debit" | "credit";
    currency?: "USD" | "EUR" | "GBP" | "MXN";
    institution?: string;
    note?: string;
    color?: string;
    iconUrl?: string;
    countInAssets?: boolean;
    hideBalance?: boolean;
    creditLimit?: string;
    owedAmount?: string;
    billingDate?: number;
    dueDate?: number;
    paymentReminder?: boolean;
  }
): Promise<Account> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Verify ownership
  const account = await getAccount(id);
  if (!account) throw new Error("Account not found");

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.type !== undefined) updateData.type = data.type;
  if (data.currency !== undefined) updateData.currency = data.currency;
  if (data.institution !== undefined) updateData.institution = data.institution;
  if (data.note !== undefined) updateData.note = data.note;
  if (data.color !== undefined) updateData.color = data.color;
  if (data.iconUrl !== undefined) updateData.iconUrl = data.iconUrl || null;
  if (data.countInAssets !== undefined) updateData.countInAssets = data.countInAssets ? 1 : 0;
  if (data.hideBalance !== undefined) updateData.hideBalance = data.hideBalance ? 1 : 0;
  if (data.creditLimit !== undefined) updateData.creditLimit = data.creditLimit || null;
  if (data.owedAmount !== undefined) updateData.owedAmount = data.owedAmount || null;
  if (data.billingDate !== undefined) updateData.billingDate = data.billingDate || null;
  if (data.dueDate !== undefined) updateData.dueDate = data.dueDate || null;
  if (data.paymentReminder !== undefined) updateData.paymentReminder = data.paymentReminder ? 1 : 0;

  const [updatedAccount] = await drizzleDb
    .update(accounts)
    .set(updateData)
    .where(and(eq(accounts.id, id), eq(accounts.userId, session.user.id)))
    .returning();

  revalidatePath("/accounts");
  return updatedAccount;
}

export async function deleteAccount(id: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Verify ownership
  const account = await getAccount(id);
  if (!account) throw new Error("Account not found");

  // Deactivate all recurring payments linked to this account
  await deactivateRecurringPaymentsForAccount(id, session.user.id);

  // Soft delete: set deletedAt and isActive = 0 (preserve transactions)
  await drizzleDb
    .update(accounts)
    .set({
      isActive: 0,
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(accounts.id, id), eq(accounts.userId, session.user.id)));

  revalidatePath("/accounts");
  revalidatePath("/recurring");
}

/**
 * Deactivate all recurring payments linked to an account.
 * Payments can be linked via typeSpecific.accountId, typeSpecific.fromAccountId, or typeSpecific.toAccountId.
 */
async function deactivateRecurringPaymentsForAccount(accountId: string, userId: string): Promise<number> {
  const { recurringPayments } = await import("@/lib/db/schema");

  // Get all active recurring payments for this user
  const activePayments = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(
      and(
        eq(recurringPayments.userId, userId),
        eq(recurringPayments.isActive, 1)
      )
    );

  // Find payments linked to this account through typeSpecific fields
  const paymentsToDeactivate: typeof activePayments = [];

  for (const payment of activePayments) {
    const typeSpecific = payment.typeSpecific as Record<string, string | undefined>;
    const isLinked =
      typeSpecific?.accountId === accountId ||
      typeSpecific?.fromAccountId === accountId ||
      typeSpecific?.toAccountId === accountId ||
      typeSpecific?.creditAccountId === accountId;

    if (isLinked) {
      paymentsToDeactivate.push(payment);
    }
  }

  // Deactivate all linked payments
  for (const payment of paymentsToDeactivate) {
    await drizzleDb
      .update(recurringPayments)
      .set({
        isActive: 0,
        updatedAt: new Date(),
      })
      .where(eq(recurringPayments.id, payment.id));
  }

  return paymentsToDeactivate.length;
}

/**
 * Get a preview of what will happen when an account is deleted.
 * Returns counts of transactions and active recurring payments.
 */
export async function getAccountDeletionPreview(id: string): Promise<{
  account: Account;
  transactionCount: number;
  activeRecurringPaymentsCount: number;
  recurringPayments: Array<{ id: string; name: string }>;
  investmentsCount: number;
  loansCount: number;
}> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Verify ownership
  const account = await getAccount(id);
  if (!account) throw new Error("Account not found");

  // Get transaction count
  const { transactions } = await import("@/lib/db/schema");
  const txResult = await drizzleDb
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(eq(transactions.accountId, id));
  const transactionCount = Number(txResult[0]?.count) || 0;

  // Get active recurring payments linked to this account
  const { recurringPayments } = await import("@/lib/db/schema");
  const activePayments = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(
      and(
        eq(recurringPayments.userId, session.user.id),
        eq(recurringPayments.isActive, 1)
      )
    );

  const linkedRecurring: Array<{ id: string; name: string }> = [];
  for (const payment of activePayments) {
    const typeSpecific = payment.typeSpecific as Record<string, string | undefined>;
    const isLinked =
      typeSpecific?.accountId === id ||
      typeSpecific?.fromAccountId === id ||
      typeSpecific?.toAccountId === id ||
      typeSpecific?.creditAccountId === id;

    if (isLinked) {
      linkedRecurring.push({ id: payment.id, name: payment.name });
    }
  }

  // Get investments count
  const { investments } = await import("@/lib/db/schema");
  const investResult = await drizzleDb
    .select({ count: sql<number>`count(*)` })
    .from(investments)
    .where(eq(investments.accountId, id));
  const investmentsCount = Number(investResult[0]?.count) || 0;

  // Get loans count
  const { loans } = await import("@/lib/db/schema");
  const loansResult = await drizzleDb
    .select({ count: sql<number>`count(*)` })
    .from(loans)
    .where(eq(loans.accountId, id));
  const loansCount = Number(loansResult[0]?.count) || 0;

  return {
    account,
    transactionCount,
    activeRecurringPaymentsCount: linkedRecurring.length,
    recurringPayments: linkedRecurring,
    investmentsCount,
    loansCount,
  };
}
