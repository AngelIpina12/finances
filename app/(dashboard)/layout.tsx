import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { UserProvider } from '@/components/providers/user-provider';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session) redirect('/login');

  return (
    <UserProvider>
      <div className="min-h-screen bg-gray-50 dark:bg-black">
        <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
            <h1 className="text-xl font-bold">Finance App</h1>
            <nav className="flex gap-6">
              <a href="/accounts" className="hover:text-black dark:hover:text-white">Accounts</a>
              <a href="/transactions" className="hover:text-black dark:hover:text-white">Transactions</a>
              <a href="/budgets" className="hover:text-black dark:hover:text-white">Budgets</a>
              <a href="/investments" className="hover:text-black dark:hover:text-white">Investments</a>
              <a href="/loans" className="hover:text-black dark:hover:text-white">Loans</a>
              <a href="/recurring" className="hover:text-black dark:hover:text-white">Recurring</a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
      </div>
    </UserProvider>
  );
}
