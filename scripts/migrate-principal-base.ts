import { drizzleDb, fixedIncomeAccruals } from "@/lib/db";
import { fixedIncomeAccounts } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import Decimal from "decimal.js";

async function migratePrincipalBase() {
  console.log("Starting principalBase migration...\n");

  // Get all fixed income accounts
  const accounts = await drizzleDb
    .select()
    .from(fixedIncomeAccounts);

  for (const account of accounts) {
    console.log(`Account: ${account.name}`);
    console.log(`  original_principal: ${account.originalPrincipal}`);
    console.log(`  accumulated_interest: ${account.accumulatedInterest}`);

    // Get the most recent accrual for this account
    const latestAccrual = await drizzleDb
      .select()
      .from(fixedIncomeAccruals)
      .where(eq(fixedIncomeAccruals.accountId, account.id))
      .orderBy(desc(fixedIncomeAccruals.date))
      .limit(1);

    if (latestAccrual[0]) {
      const balanceAtStart = new Decimal(latestAccrual[0].balanceAtStart);
      const accumulatedInterest = new Decimal(account.accumulatedInterest || "0");
      const interestEarned = new Decimal(latestAccrual[0].interestEarned);

      // principalBase = balance before today's interest = balanceAtStart
      console.log(`  latest accrual: balance_at_start = ${latestAccrual[0].balanceAtStart}`);
      console.log(`  interest_earned today: ${latestAccrual[0].interestEarned}`);

      await drizzleDb
        .update(fixedIncomeAccounts)
        .set({ principalBase: balanceAtStart.toString() })
        .where(eq(fixedIncomeAccounts.id, account.id));

      console.log(`  principal_base (new): ${balanceAtStart.toString()}`);
    } else {
      // No accruals yet, use original calculation
      const originalPrincipal = new Decimal(account.originalPrincipal || "0");
      const accumulatedInterest = new Decimal(account.accumulatedInterest || "0");
      const principalBase = originalPrincipal.minus(accumulatedInterest);

      console.log(`  no accruals found, using: principal_base = original_principal - accumulated_interest`);

      await drizzleDb
        .update(fixedIncomeAccounts)
        .set({ principalBase: principalBase.toString() })
        .where(eq(fixedIncomeAccounts.id, account.id));

      console.log(`  principal_base (new): ${principalBase.toString()}`);
    }

    console.log("");
  }

  console.log("Migration complete!");
}

migratePrincipalBase().catch(console.error);
