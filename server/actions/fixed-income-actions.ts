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
  tier1BalanceProjected: string;
  tier2BalanceProjected: string;
}

function calculateInterestInternal(
  balance: Decimal,
  initialRate: Decimal,
  initialLimit: Decimal,
  secondRate: Decimal | null,
  secondLimit: Decimal | null,
  compoundFirstTier: boolean,
  principalBase: Decimal,
  accumulatedInterest: Decimal
): InterestCalculationResult {
  const dailyRate1 = initialRate.dividedBy(365).dividedBy(100);

  let tier1Balance: Decimal;
  let tier2Balance: Decimal;

  // Determine if we have a second tier active
  const hasSecondTierActive = secondRate !== null;

  if (compoundFirstTier && !hasSecondTierActive) {
    // Compound without second tier: principal stays in Tier 1
    tier1Balance = principalBase;
    tier2Balance = new Decimal(0);
  } else if (compoundFirstTier && hasSecondTierActive) {
    // Compound WITH second tier: derive principals from principal base
    tier1Balance = Decimal.min(principalBase, initialLimit);
    tier2Balance = Decimal.max(new Decimal(0), principalBase.minus(initialLimit));
  } else {
    // Simple interest (non-compound): derive principals from principal base
    tier1Balance = Decimal.min(principalBase, initialLimit);
    tier2Balance = Decimal.max(new Decimal(0), principalBase.minus(initialLimit));
  }

  const tier1Interest = tier1Balance.times(dailyRate1);
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

  // Calculate projected balances: total + interest, then derive tiers from that
  // This ensures tier1Projected + tier2Projected = balance + totalDailyInterest (no rounding error)
  const totalProjected = balance.plus(totalDailyInterest);
  const tier1BalanceProjected = Decimal.min(totalProjected, initialLimit);
  const tier2BalanceProjected = totalProjected.greaterThan(initialLimit)
    ? totalProjected.minus(initialLimit)
    : new Decimal(0);

  return {
    tier1Interest: tier1Interest.toString(),
    tier2Interest: tier2Interest.toString(),
    totalDailyInterest: totalDailyInterest.toString(),
    effectiveRate: effectiveRate.toString(),
    tier1Balance: tier1Balance.toString(),
    tier2Balance: tier2Balance.greaterThan(0) ? tier2Balance.toString() : "0",
    tier1BalanceProjected: tier1BalanceProjected.toString(),
    tier2BalanceProjected: tier2BalanceProjected.greaterThan(0) ? tier2BalanceProjected.toString() : "0",
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
  compoundFirstTier: boolean;
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
      compoundFirstTier: parsed.data.compoundFirstTier ? 1 : 0,
      accumulatedInterest: '0',
      principalBase: parsed.data.originalPrincipal,
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
    compoundFirstTier?: boolean;
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
  if (data.compoundFirstTier !== undefined) updateData.compoundFirstTier = data.compoundFirstTier ? 1 : 0;

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
  const compoundFirstTier = account.compoundFirstTier === 1;
  const principalBase = new Decimal(account.principalBase || account.originalPrincipal || "0");
  const accumulatedInterest = new Decimal(account.accumulatedInterest || "0");

  const calculation = calculateInterestInternal(
    balance, initialRate, initialLimit, secondRate, secondLimit, compoundFirstTier, principalBase, accumulatedInterest
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
  const newBalance = balance.plus(calculation.totalDailyInterest);

  await drizzleDb
    .update(fixedIncomeAccounts)
    .set({
      accumulatedInterest: newAccumulated.toString(),
      originalPrincipal: newBalance.toString(),
      lastAccrualDate: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(fixedIncomeAccounts.id, accountId));

  // Update the linked account's balance with the earned interest (always, regardless of compoundFirstTier)
  await drizzleDb
    .update(accounts)
    .set({
      balance: newBalance.toString(),
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, account.linkedAccountId));
}
