"use server";

import { auth } from "@/lib/auth";
import { drizzleDb, tags, type Tag } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function getTags(): Promise<Tag[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userTags = await drizzleDb
    .select()
    .from(tags)
    .where(eq(tags.userId, session.user.id));

  return userTags;
}

export async function getTagsByCategory(categoryId: string): Promise<Tag[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const categoryTags = await drizzleDb
    .select()
    .from(tags)
    .where(and(
      eq(tags.categoryId, categoryId),
      eq(tags.userId, session.user.id)
    ));

  return categoryTags;
}

export async function createTag(data: {
  name: string;
  categoryId: string;
}): Promise<Tag> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  if (!data.name || !data.name.trim()) {
    throw new Error("Tag name is required");
  }

  if (!data.categoryId) {
    throw new Error("Category ID is required");
  }

  // Check for duplicate tag name for this category
  const existing = await drizzleDb
    .select()
    .from(tags)
    .where(and(
      eq(tags.categoryId, data.categoryId),
      eq(tags.name, data.name.trim()),
      eq(tags.userId, session.user.id)
    ))
    .limit(1);

  if (existing[0]) {
    throw new Error("Tag with this name already exists in this category");
  }

  const [newTag] = await drizzleDb
    .insert(tags)
    .values({
      userId: session.user.id,
      name: data.name.trim(),
      categoryId: data.categoryId,
    })
    .returning();

  revalidatePath("/categories");
  revalidatePath("/transactions");
  return newTag;
}

export async function deleteTag(id: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Verify ownership
  const tag = await drizzleDb
    .select()
    .from(tags)
    .where(and(eq(tags.id, id), eq(tags.userId, session.user.id)))
    .limit(1);

  if (!tag[0]) throw new Error("Tag not found");

  await drizzleDb
    .delete(tags)
    .where(and(eq(tags.id, id), eq(tags.userId, session.user.id)));

  revalidatePath("/categories");
  revalidatePath("/transactions");
}
