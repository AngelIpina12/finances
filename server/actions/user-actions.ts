'use server';

import { auth } from '@/lib/auth';
import { drizzleDb, users } from '@/lib/db';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

export async function getCurrentUser() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await drizzleDb
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  return user[0] || null;
}

export async function createUser(data: { name: string; email: string; password: string }) {
  const passwordHash = await bcrypt.hash(data.password, 12);

  const [user] = await drizzleDb
    .insert(users)
    .values({ name: data.name, email: data.email, passwordHash })
    .returning({ id: users.id, email: users.email, name: users.name });

  return user;
}
