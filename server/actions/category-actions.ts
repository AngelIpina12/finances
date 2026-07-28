"use server";

import { auth } from "@/lib/auth";
import { drizzleDb, categories, type Category } from "@/lib/db";
import { eq, and, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function getCategories(type?: "income" | "expense"): Promise<Category[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  let query = drizzleDb
    .select()
    .from(categories)
    .where(eq(categories.userId, session.user.id));

  const allCategories = await query;

  if (type) {
    return allCategories.filter((c) => c.type === type);
  }

  return allCategories;
}

export async function getCategory(id: string): Promise<Category | null> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const category = await drizzleDb
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.userId, session.user.id)))
    .limit(1);

  return category[0] || null;
}

export async function getSubcategories(parentId: string): Promise<Category[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const subcategories = await drizzleDb
    .select()
    .from(categories)
    .where(and(eq(categories.parentId, parentId), eq(categories.userId, session.user.id)));

  return subcategories;
}

export async function createCategory(data: {
  name: string;
  type: "income" | "expense";
  iconUrl?: string;
  color?: string;
  parentId?: string;
}): Promise<Category> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  if (!data.name || !data.name.trim()) {
    throw new Error("Category name is required");
  }

  if (!["income", "expense"].includes(data.type)) {
    throw new Error("Invalid category type");
  }

  const [newCategory] = await drizzleDb
    .insert(categories)
    .values({
      userId: session.user.id,
      name: data.name.trim(),
      type: data.type,
      iconUrl: data.iconUrl || null,
      color: data.color || null,
      parentId: data.parentId || null,
    })
    .returning();

  revalidatePath("/categories");
  return newCategory;
}

export async function updateCategory(
  id: string,
  data: {
    name?: string;
    iconUrl?: string;
    color?: string;
    parentId?: string;
  }
): Promise<Category> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Verify ownership
  const category = await getCategory(id);
  if (!category) throw new Error("Category not found");

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.iconUrl !== undefined) updateData.iconUrl = data.iconUrl || null;
  if (data.color !== undefined) updateData.color = data.color || null;
  if (data.parentId !== undefined) updateData.parentId = data.parentId || null;

  const [updatedCategory] = await drizzleDb
    .update(categories)
    .set(updateData)
    .where(and(eq(categories.id, id), eq(categories.userId, session.user.id)))
    .returning();

  revalidatePath("/categories");
  return updatedCategory;
}

export async function deleteCategory(id: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Verify ownership
  const category = await getCategory(id);
  if (!category) throw new Error("Category not found");

  // Check if category has subcategories
  const subcategories = await getSubcategories(id);
  if (subcategories.length > 0) {
    throw new Error("Cannot delete category with subcategories. Delete subcategories first.");
  }

  await drizzleDb
    .delete(categories)
    .where(and(eq(categories.id, id), eq(categories.userId, session.user.id)));

  revalidatePath("/categories");
}
