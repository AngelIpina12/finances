"use server";

import { auth } from "@/lib/auth";
import { drizzleDb, fixedIncomeAccounts, accounts, fixedIncomeAccruals, type FixedIncomeAccount, type Account } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { fixedIncomeAccountSchema } from "@/types/forms";
import { revalidatePath } from "next/cache";
import Decimal from "decimal.js";

export interface InterestCalculationResult {
  tier1Interest: string;
  tier2Interest: string;
  totalDailyInterest: string;
  effectiveRate: string;
  tier1Balance: string;
  tier2Balance: string;
}

function calculateInterestInternal(
  balance: Decimal,
  initialRate: Decimal,
  initialLimit: Decimal,
  secondRate: Decimal | null,
  secondLimit: Decimal | null
): InterestCalculationResult {
  const dailyRate1 = initialRate.dividedBy(365).dividedBy(100);
  const tier1Balance = Decimal.min(balance, initialLimit);
  const tier1Interest = tier1Balance.times(dailyRate1);

  let tier2Balance = balance.minus(initialLimit);
  let tier2Interest = new Decimal(0);

  if (tier2Balance.greaterThan(0) && secondRate) {
    const dailyRate2 = secondRate.dividedBy(365).dividedBy(100);

    if (secondLimit) {
      tier2Balance = Decimal.min(tier2Balance, secondLimit);
    }

    tier2Interest = tier2Balance.times(dailyRate2);
  }

  const totalDailyInterest = tier1Interest.plus(tier2Interest);
  const effectiveRate = totalDailyInterest.dividedBy(balance).times(365).times(100);

  return {
    tier1Interest: tier1Interest.toString(),
    tier2Interest: tier2Interest.toString(),
    totalDailyInterest: totalDailyInterest.toString(),
    effectiveRate: effectiveRate.toString(),
    tier1Balance: tier1Balance.toString(),
    tier2Balance: tier2Balance.toString(),
  };
}

export async function getFixedIncomeAccounts(): Promise<(FixedIncomeAccount & { linkedAccount?: Account })[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const result = await drizzleDb
    .select()
    .from(fixedIncomeAccounts)
    .where(eq(fixedIncomeAccounts.userId, session.user.id));

  if (result.length === 0) return [];

  const linkedAccountIds = result.map(r => r.linkedAccountId);

  const linkedAccountsResult = await drizzleDb
    .select()
    .from(accounts)
    .where(inArray(accounts.id, linkedAccountIds));

  const linkedAccountsMap = new Map(linkedAccountsResult.map(acc => [acc.id, acc]));

  return result.map(fi => ({
    ...fi,
    linkedAccount: linkedAccountsMap.get(fi.linkedAccountId),
  }));
}

export async function getFixedIncomeAccount(id: string): Promise<FixedIncomeAccount | null> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const account = await drizzleDb
    .select()
    .from(fixedIncomeAccounts)
    .where(and(eq(fixedIncomeAccounts.id, id), eq(fixedIncomeAccounts.userId, session.user.id)))
    .limit(1);

  return account[0] || null;
}

export async function createFixedIncomeAccount(data: {
  name: string;
  linkedAccountId: string;
  currency?: "USD" | "EUR" | "GBP" | "MXN";
  initialInterestRate: string;
  initialAmountLimit: string;
  originalPrincipal: string;
  hasSecondTier: boolean;
  secondInterestRate?: string;
  secondAmountLimit?: string;
}): Promise<FixedIncomeAccount> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const parsed = fixedIncomeAccountSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }

  const [newAccount] = await drizzleDb
    .insert(fixedIncomeAccounts)
    .values({
      userId: session.user.id,
      linkedAccountId: parsed.data.linkedAccountId,
      name: parsed.data.name,
      currency: parsed.data.currency,
      initialInterestRate: parsed.data.initialInterestRate,
      initialAmountLimit: parsed.data.initialAmountLimit,
      originalPrincipal: parsed.data.originalPrincipal,
      hasSecondTier: parsed.data.hasSecondTier ? 1 : 0,
      secondInterestRate: parsed.data.secondInterestRate || null,
      secondAmountLimit: parsed.data.secondAmountLimit || null,
      accumulatedInterest: '0',
      isActive: 1,
    })
    .returning();

  revalidatePath("/investments");
  return newAccount;
}

export async function updateFixedIncomeAccount(
  id: string,
  data: {
    name?: string;
    initialInterestRate?: string;
    initialAmountLimit?: string;
    hasSecondTier?: boolean;
    secondInterestRate?: string;
    secondAmountLimit?: string;
  }
): Promise<FixedIncomeAccount> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const existing = await getFixedIncomeAccount(id);
  if (!existing) throw new Error("Fixed income account not found");

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.initialInterestRate !== undefined) updateData.initialInterestRate = data.initialInterestRate;
  if (data.initialAmountLimit !== undefined) updateData.initialAmountLimit = data.initialAmountLimit;
  if (data.hasSecondTier !== undefined) updateData.hasSecondTier = data.hasSecondTier ? 1 : 0;
  if (data.secondInterestRate !== undefined) updateData.secondInterestRate = data.secondInterestRate || null;
  if (data.secondAmountLimit !== undefined) updateData.secondAmountLimit = data.secondAmountLimit || null;

  const [updated] = await drizzleDb
    .update(fixedIncomeAccounts)
    .set(updateData)
    .where(eq(fixedIncomeAccounts.id, id))
    .returning();

  revalidatePath("/investments");
  return updated;
}

export async function deleteFixedIncomeAccount(id: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const account = await getFixedIncomeAccount(id);
  if (!account) throw new Error("Fixed income account not found");

  await drizzleDb
    .delete(fixedIncomeAccruals)
    .where(eq(fixedIncomeAccruals.accountId, id));

  await drizzleDb
    .update(fixedIncomeAccounts)
    .set({
      isActive: 0,
      updatedAt: new Date(),
    })
    .where(eq(fixedIncomeAccounts.id, id));

  revalidatePath("/investments");
}

export async function accrueDailyInterest(accountId: string): Promise<void> {
  const account = await getFixedIncomeAccount(accountId);
  if (!account || account.isActive !== 1) return;

  const linkedAccountResult = await drizzleDb
    .select()
    .from(accounts)
    .where(eq(accounts.id, account.linkedAccountId))
    .limit(1);

  if (!linkedAccountResult[0]) return;

  const balance = new Decimal(linkedAccountResult[0].balance);
  const initialRate = new Decimal(account.initialInterestRate);
  const initialLimit = new Decimal(account.initialAmountLimit);
  const secondRate = account.secondInterestRate ? new Decimal(account.secondInterestRate) : null;
  const secondLimit = account.secondAmountLimit ? new Decimal(account.secondAmountLimit) : null;

  const calculation = calculateInterestInternal(
    balance, initialRate, initialLimit, secondRate, secondLimit
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await drizzleDb
    .insert(fixedIncomeAccruals)
    .values({
      accountId: accountId,
      date: new Date(),
      balanceAtStart: linkedAccountResult[0].balance,
      interestEarned: calculation.totalDailyInterest,
      balanceAtEnd: balance.plus(calculation.totalDailyInterest).toString(),
      effectiveRate: calculation.effectiveRate,
    });

  const newAccumulated = new Decimal(account.accumulatedInterest).plus(calculation.totalDailyInterest);

  await drizzleDb
    .update(fixedIncomeAccounts)
    .set({
      accumulatedInterest: newAccumulated.toString(),
      lastAccrualDate: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(fixedIncomeAccounts.id, accountId));
}
