import { NextResponse } from "next/server";
import { drizzleDb, transactions } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const bbvaPlatinumId = "fe039f08-0b10-4752-b1a4-ea30940213ba";

    // Missing transactions from BBVA statement (cycle 15 jun - 14 jul 2026)
    const missingTransactions = [
      { description: "NANONOBLE PTE. LTD.", amount: "172.88", date: "2026-06-17" },
      { description: "HELADOS SULTANA", amount: "300.00", date: "2026-06-27" },
      { description: "OXXO ZUAZUA", amount: "203.00", date: "2026-07-05" },
      { description: "CIRCUS ANAHUAC", amount: "150.00", date: "2026-07-11" },
      { description: "MIT*ABTS BOSQUES", amount: "116.55", date: "2026-07-01" },
      { description: "03 DE 03 COPPEL PLA", amount: "205.00", date: "2026-07-15" },
    ];

    const inserted = [];
    const errors = [];

    for (const tx of missingTransactions) {
      try {
        const [newTx] = await drizzleDb
          .insert(transactions)
          .values({
            userId,
            accountId: bbvaPlatinumId,
            type: "expense",
            amount: tx.amount,
            description: tx.description,
            date: new Date(tx.date),
            recurringPaymentId: null,
          })
          .returning();

        inserted.push({ id: newTx.id, description: tx.description, amount: tx.amount });
      } catch (error) {
        errors.push({ description: tx.description, error: error instanceof Error ? error.message : "Unknown error" });
      }
    }

    return NextResponse.json({
      success: true,
      inserted,
      errors,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
