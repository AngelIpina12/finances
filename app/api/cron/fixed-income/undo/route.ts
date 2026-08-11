import { NextResponse } from "next/server";
import { drizzleDb, fixedIncomeAccounts, accounts, fixedIncomeAccruals } from "@/lib/db";
import { eq, and, desc } from "drizzle-orm";
import Decimal from "decimal.js";

// This endpoint undoes the LAST accrual for each fixed income account
// It subtracts the interest from the linked account balance and removes the accrual record

export async function GET(request: Request) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();

    // Get all active fixed income accounts
    const accountsList = await drizzleDb
      .select()
      .from(fixedIncomeAccounts)
      .where(eq(fixedIncomeAccounts.isActive, 1));

    const results = [];

    for (const account of accountsList) {
      try {
        // Get the LAST accrual for this account
        const lastAccruals = await drizzleDb
          .select()
          .from(fixedIncomeAccruals)
          .where(eq(fixedIncomeAccruals.accountId, account.id))
          .orderBy(desc(fixedIncomeAccruals.date))
          .limit(1);

        if (lastAccruals.length === 0) {
          results.push({
            id: account.id,
            name: account.name,
            status: "skipped",
            reason: "No accruals to undo",
          });
          continue;
        }

        const lastAccrual = lastAccruals[0];
        const interestToUndo = new Decimal(lastAccrual.interestEarned);

        // Subtract interest from linked account balance
        const linkedAccount = await drizzleDb
          .select()
          .from(accounts)
          .where(eq(accounts.id, account.linkedAccountId))
          .limit(1);

        if (linkedAccount[0]) {
          const currentBalance = new Decimal(linkedAccount[0].balance);
          const newBalance = currentBalance.minus(interestToUndo);

          await drizzleDb
            .update(accounts)
            .set({
              balance: newBalance.toString(),
              updatedAt: new Date(),
            })
            .where(eq(accounts.id, account.linkedAccountId));
        }

        // Subtract from accumulated interest
        const currentAccumulated = new Decimal(account.accumulatedInterest);
        const newAccumulated = currentAccumulated.minus(interestToUndo);

        // Restore originalPrincipal to balance before interest (balanceAtStart)
        const originalPrincipalRestored = new Decimal(lastAccrual.balanceAtStart);

        await drizzleDb
          .update(fixedIncomeAccounts)
          .set({
            accumulatedInterest: newAccumulated.toString(),
            originalPrincipal: originalPrincipalRestored.toString(),
            updatedAt: new Date(),
          })
          .where(eq(fixedIncomeAccounts.id, account.id));

        // Delete the accrual record
        await drizzleDb
          .delete(fixedIncomeAccruals)
          .where(eq(fixedIncomeAccruals.id, lastAccrual.id));

        results.push({
          id: account.id,
          name: account.name,
          status: "undone",
          interestUndone: interestToUndo.toString(),
          previousBalance: lastAccrual.balanceAtStart,
          newBalance: linkedAccount[0] ? linkedAccount[0].balance : null,
        });
      } catch (error) {
        results.push({
          id: account.id,
          name: account.name,
          status: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      undone: results.filter(r => r.status === "undone").length,
      results,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error("Error undoing fixed income accruals:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
