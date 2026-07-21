"use server";

import { auth } from "@/lib/auth";
import { drizzleDb, recurringPayments, type RecurringPayment } from "@/lib/db";
import { eq, and, lte } from "drizzle-orm";
import { recurringPaymentSchema } from "@/types/forms";
import { revalidatePath } from "next/cache";
import { addDays, addWeeks, addMonths, addYears, isBefore } from "date-fns";

export async function getRecurringPayments(): Promise<RecurringPayment[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const payments = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(eq(recurringPayments.userId, session.user.id));

  return payments;
}

export async function getActiveRecurringPayments(): Promise<RecurringPayment[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const payments = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(
      and(
        eq(recurringPayments.userId, session.user.id),
        eq(recurringPayments.isActive, 1)
      )
    );

  return payments;
}

export async function createRecurringPayment(data: {
  accountId: string;
  name: string;
  amount: string;
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  category?: string;
  nextPaymentDate: Date;
}): Promise<RecurringPayment> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const parsed = recurringPaymentSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }

  const [newPayment] = await drizzleDb
    .insert(recurringPayments)
    .values({
      userId: session.user.id,
      accountId: parsed.data.accountId,
      name: parsed.data.name,
      amount: parsed.data.amount,
      frequency: parsed.data.frequency,
      category: parsed.data.category,
      nextPaymentDate: parsed.data.nextPaymentDate,
    })
    .returning();

  revalidatePath("/recurring");
  return newPayment;
}

export async function updateRecurringPayment(
  id: string,
  data: {
    name?: string;
    amount?: string;
    frequency?: "daily" | "weekly" | "monthly" | "yearly";
    category?: string;
    isActive?: number;
    nextPaymentDate?: Date;
  }
): Promise<RecurringPayment> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Verify ownership
  const payment = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(
      and(
        eq(recurringPayments.id, id),
        eq(recurringPayments.userId, session.user.id)
      )
    )
    .limit(1);

  if (!payment[0]) throw new Error("Recurring payment not found");

  const [updated] = await drizzleDb
    .update(recurringPayments)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(recurringPayments.id, id),
        eq(recurringPayments.userId, session.user.id)
      )
    )
    .returning();

  revalidatePath("/recurring");
  return updated;
}

export async function deleteRecurringPayment(id: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  await drizzleDb
    .delete(recurringPayments)
    .where(
      and(
        eq(recurringPayments.id, id),
        eq(recurringPayments.userId, session.user.id)
      )
    );

  revalidatePath("/recurring");
}

export async function toggleRecurringPayment(
  id: string
): Promise<RecurringPayment> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const payment = await drizzleDb
    .select()
    .from(recurringPayments)
    .where(
      and(
        eq(recurringPayments.id, id),
        eq(recurringPayments.userId, session.user.id)
      )
    )
    .limit(1);

  if (!payment[0]) throw new Error("Recurring payment not found");

  const [updated] = await drizzleDb
    .update(recurringPayments)
    .set({
      isActive: payment[0].isActive === 1 ? 0 : 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(recurringPayments.id, id),
        eq(recurringPayments.userId, session.user.id)
      )
    )
    .returning();

  revalidatePath("/recurring");
  return updated;
}

// Calculate next payment date based on frequency
export async function calculateNextPaymentDate(
  currentDate: Date,
  frequency: "daily" | "weekly" | "monthly" | "yearly"
): Promise<Date> {
  switch (frequency) {
    case "daily":
      return addDays(currentDate, 1);
    case "weekly":
      return addWeeks(currentDate, 1);
    case "monthly":
      return addMonths(currentDate, 1);
    case "yearly":
      return addYears(currentDate, 1);
  }
}
