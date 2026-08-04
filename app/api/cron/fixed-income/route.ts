import { NextResponse } from "next/server";
import { drizzleDb, fixedIncomeAccounts } from "@/lib/db";
import { eq } from "drizzle-orm";
import { accrueDailyInterest } from "@/server/actions/fixed-income-actions";

// This endpoint should be called daily by a cron job (e.g., Vercel Cron, GitHub Actions)
// It accrues daily interest for all active fixed income accounts

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
    const accounts = await drizzleDb
      .select()
      .from(fixedIncomeAccounts)
      .where(eq(fixedIncomeAccounts.isActive, 1));

    const results = [];

    for (const account of accounts) {
      try {
        await accrueDailyInterest(account.id);

        results.push({
          id: account.id,
          name: account.name,
          status: "processed",
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
      processed: results.length,
      results,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error("Error processing fixed income accruals:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
