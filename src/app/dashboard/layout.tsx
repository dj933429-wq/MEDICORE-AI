'use client';

import { useAuth } from '../../lib/auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Navbar from '../../components/Navbar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-indigo-600 border-opacity-50"></div>
        <p className="mt-4 text-slate-500 font-medium animate-pulse">Authenticating Session...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Navbar />
      <main className="flex-grow">
        {children}
      </main>
    </div>
  );
}
