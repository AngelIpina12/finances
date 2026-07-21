'use client';

import { SessionProvider } from 'next-auth/react';
import { ReactNode } from 'react';

export function UserProvider({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
