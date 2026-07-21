import { NextResponse } from "next/server";
import { drizzleDb, recurringPayments, transactions } from "@/lib/db";
import { eq, and, lte } from "drizzle-orm";
import { addDays, addWeeks, addMonths, addYears } from "date-fns";

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

    const now = new Date();

    // Get all active recurring payments that are due
    const duePayments = await drizzleDb
      .select()
      .from(recurringPayments)
      .where(
        and(
          eq(recurringPayments.isActive, 1),
          lte(recurringPayments.nextPaymentDate, now)
        )
      );

    const results = [];

    for (const payment of duePayments) {
      try {
        // Create expense transaction for this payment
        await drizzleDb.insert(transactions).values({
          userId: payment.userId,
          accountId: payment.accountId,
          type: "expense",
          amount: payment.amount,
          category: payment.category || payment.name,
          description: `Recurring: ${payment.name}`,
          date: payment.nextPaymentDate,
        });

        // Calculate next payment date
        let nextDate: Date;
        switch (payment.frequency) {
          case "daily":
            nextDate = addDays(payment.nextPaymentDate, 1);
            break;
          case "weekly":
            nextDate = addWeeks(payment.nextPaymentDate, 1);
            break;
          case "monthly":
            nextDate = addMonths(payment.nextPaymentDate, 1);
            break;
          case "yearly":
            nextDate = addYears(payment.nextPaymentDate, 1);
            break;
          default:
            nextDate = addMonths(payment.nextPaymentDate, 1);
        }

        // Update next payment date
        await drizzleDb
          .update(recurringPayments)
          .set({
            nextPaymentDate: nextDate,
            updatedAt: new Date(),
          })
          .where(eq(recurringPayments.id, payment.id));

        results.push({
          id: payment.id,
          name: payment.name,
          amount: payment.amount,
          status: "processed",
          nextPaymentDate: nextDate,
        });
      } catch (error) {
        results.push({
          id: payment.id,
          name: payment.name,
          amount: payment.amount,
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
    console.error("Error processing recurring payments:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
