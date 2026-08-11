import { NextResponse } from "next/server";
import { processRecurringPayments } from "@/server/actions/recurring-actions";

// This endpoint should be called daily by a cron job (e.g., Vercel Cron, GitHub Actions)
// It processes recurring payments that are due and creates transactions for them

export async function GET(request: Request) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Use the centralized processRecurringPayments function from recurring-actions
    // which correctly handles payroll (isPayroll), by_term, subscriptions, etc.
    const result = await processRecurringPayments();

    return NextResponse.json({
      processed: result.processed,
      results: result.results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error processing recurring payments:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
