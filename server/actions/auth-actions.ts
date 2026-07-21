'use server';

import { signIn } from '@/lib/auth';
import { redirect } from 'next/navigation';

export async function authenticate(formData: FormData) {
  try {
    await signIn('credentials', formData);
  } catch (error) {
    throw error;
  }
}

export async function logout() {
  const { signOut } = await import('@/lib/auth');
  await signOut();
  redirect('/login');
}
