import type { User } from '@/lib/db';

export type SessionUser = Pick<User, 'id' | 'email' | 'name'>;

export interface AuthResult {
  success: boolean;
  user?: SessionUser;
  error?: string;
}
