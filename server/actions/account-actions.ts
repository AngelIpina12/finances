"use server";

import { auth } from "@/lib/auth";
import { drizzleDb, accounts, type Account } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { accountSchema } from "@/types/forms";
import { revalidatePath } from "next/cache";
import Decimal from "decimal.js";

export async function getAccounts(): Promise<Account[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userAccounts = await drizzleDb
    .select()
    .from(accounts)
    .where(eq(accounts.userId, session.user.id));

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
  type: "checking" | "savings" | "credit" | "investment";
  currency: "USD" | "EUR" | "GBP" | "MXN";
  balance?: string;
  institution?: string;
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
    })
    .returning();

  revalidatePath("/accounts");
  return newAccount;
}

export async function updateAccount(
  id: string,
  data: {
    name?: string;
    type?: "checking" | "savings" | "credit" | "investment";
    currency?: "USD" | "EUR" | "GBP" | "MXN";
    institution?: string;
  }
): Promise<Account> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Verify ownership
  const account = await getAccount(id);
  if (!account) throw new Error("Account not found");

  const [updatedAccount] = await drizzleDb
    .update(accounts)
    .set({
      ...data,
      updatedAt: new Date(),
    })
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

  // Check for existing transactions
  const { transactions } = await import("@/lib/db/schema");
  const existingTransactions = await drizzleDb
    .select()
    .from(transactions)
    .where(eq(transactions.accountId, id))
    .limit(1);

  if (existingTransactions[0]) {
    throw new Error("Cannot delete account with existing transactions");
  }

  await drizzleDb
    .delete(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, session.user.id)));

  revalidatePath("/accounts");
}
