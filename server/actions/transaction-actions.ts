"use server";

import { auth } from "@/lib/auth";
import { drizzleDb, accounts, transactions, type Transaction } from "@/lib/db";
import { eq, and, desc } from "drizzle-orm";
import { transactionSchema } from "@/types/forms";
import { revalidatePath } from "next/cache";
import Decimal from "decimal.js";

export async function getTransactions(options?: {
  accountId?: string;
  limit?: number;
}): Promise<Transaction[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  let query = drizzleDb
    .select()
    .from(transactions)
    .where(eq(transactions.userId, session.user.id))
    .orderBy(desc(transactions.date));

  if (options?.accountId) {
    query = drizzleDb
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, session.user.id),
          eq(transactions.accountId, options.accountId)
        )
      )
      .orderBy(desc(transactions.date));
  }

  if (options?.limit) {
    return query.limit(options.limit);
  }

  return query;
}

export async function createTransaction(data: {
  accountId: string;
  type: "income" | "expense" | "transfer";
  amount: string;
  category?: string;
  description?: string;
  date?: Date;
  transferAccountId?: string;
}): Promise<Transaction> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const parsed = transactionSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }

  const { accountId, type, amount, category, description, date, transferAccountId } = parsed.data;
  const amountDecimal = new Decimal(amount);

  // Validate transfer has destination account
  if (type === "transfer" && !transferAccountId) {
    throw new Error("Transfer requires a destination account");
  }

  // Get source account and verify ownership
  const sourceAccount = await drizzleDb
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, session.user.id)))
    .limit(1);

  if (!sourceAccount[0]) throw new Error("Source account not found");

  // Calculate new balance for source account
  let newSourceBalance: Decimal;
  if (type === "income") {
    newSourceBalance = new Decimal(sourceAccount[0].balance).plus(amountDecimal);
  } else if (type === "expense") {
    newSourceBalance = new Decimal(sourceAccount[0].balance).minus(amountDecimal);
  } else {
    // transfer - balance decreases
    newSourceBalance = new Decimal(sourceAccount[0].balance).minus(amountDecimal);
  }

  // For transfers, verify destination account and update its balance
  if (type === "transfer" && transferAccountId) {
    const destAccount = await drizzleDb
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, transferAccountId), eq(accounts.userId, session.user.id)))
      .limit(1);

    if (!destAccount[0]) throw new Error("Destination account not found");

    const newDestBalance = new Decimal(destAccount[0].balance).plus(amountDecimal);

    // Update destination account balance
    await drizzleDb
      .update(accounts)
      .set({ balance: newDestBalance.toString(), updatedAt: new Date() })
      .where(eq(accounts.id, transferAccountId));
  }

  // Update source account balance
  await drizzleDb
    .update(accounts)
    .set({ balance: newSourceBalance.toString(), updatedAt: new Date() })
    .where(eq(accounts.id, accountId));

  // Insert transaction
  const [newTransaction] = await drizzleDb
    .insert(transactions)
    .values({
      userId: session.user.id,
      accountId,
      type,
      amount,
      category,
      description,
      date: date || new Date(),
    })
    .returning();

  revalidatePath("/accounts");
  revalidatePath("/transactions");
  return newTransaction;
}

export async function deleteTransaction(id: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Get transaction and verify ownership
  const transaction = await drizzleDb
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, session.user.id)))
    .limit(1);

  if (!transaction[0]) throw new Error("Transaction not found");

  // Reverse the balance change
  const account = await drizzleDb
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, transaction[0].accountId), eq(accounts.userId, session.user.id)))
    .limit(1);

  if (account[0]) {
    const amountDecimal = new Decimal(transaction[0].amount);
    let newBalance: Decimal;

    if (transaction[0].type === "income") {
      newBalance = new Decimal(account[0].balance).minus(amountDecimal);
    } else if (transaction[0].type === "expense") {
      newBalance = new Decimal(account[0].balance).plus(amountDecimal);
    } else {
      // For transfers, we'd need to find and reverse the paired transaction
      // This is simplified - in production you'd track transfer pairs
      newBalance = new Decimal(account[0].balance).plus(amountDecimal);
    }

    await drizzleDb
      .update(accounts)
      .set({ balance: newBalance.toString(), updatedAt: new Date() })
      .where(eq(accounts.id, transaction[0].accountId));
  }

  await drizzleDb.delete(transactions).where(eq(transactions.id, id));

  revalidatePath("/accounts");
  revalidatePath("/transactions");
}
