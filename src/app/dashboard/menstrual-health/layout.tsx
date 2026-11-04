'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { MenstrualHealthProvider } from '../../../lib/menstrual-health/context';
import TrackerSidebar from '../../../components/menstrual-health/TrackerSidebar';
import TrackerHeader from '../../../components/menstrual-health/TrackerHeader';

export default function MenstrualHealthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push('/login');
        return;
      }
      // If role is doctor, pharmacist, or admin -> not a patient
      if (user.role && user.role !== 'patient') {
        router.push('/dashboard');
        return;
      }
      // Female-Only Guard:
      // If gender is explicitly set and is not female -> redirect back to patient dashboard
      const normalizedGender = typeof user.gender === 'string' ? user.gender.toLowerCase() : '';
      if (normalizedGender && normalizedGender !== 'female') {
        router.push('/dashboard');
      }
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary-container border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const normalizedGender = typeof user.gender === 'string' ? user.gender.toLowerCase() : '';

  // Non-patient or male patient block screen fallback while redirect triggers
  if (user.role && user.role !== 'patient') {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="p-8 max-w-md w-full bg-surface-container rounded-2xl text-center border border-surface-container-high">
          <p className="text-on-surface font-semibold">Access restricted to patient accounts.</p>
        </div>
      </div>
    );
  }

  if (normalizedGender && normalizedGender !== 'female') {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="p-8 max-w-md w-full bg-surface-container rounded-2xl text-center border border-surface-container-high">
          <div className="text-3xl mb-2">🌸</div>
          <h2 className="text-lg font-bold text-on-surface mb-1">Module Restricted</h2>
          <p className="text-xs text-on-surface-variant mb-4">
            The Menstrual Health Tracker is tailored specifically for female patients. Redirecting to dashboard...
          </p>
        </div>
      </div>
    );
  }

  return (
    <MenstrualHealthProvider>
      <div className="min-h-screen bg-surface font-sans text-on-surface antialiased flex flex-col">
        {/* Responsive Sidebar */}
        <TrackerSidebar
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
        />

        {/* Content wrapper with desktop sidebar offset */}
        <div className="lg:pl-72 flex flex-col flex-1 min-w-0">
          <TrackerHeader onOpenMobile={() => setMobileOpen(true)} />
          <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-8 py-6 sm:py-8">
            {children}
          </main>
        </div>
      </div>
    </MenstrualHealthProvider>
  );
}
