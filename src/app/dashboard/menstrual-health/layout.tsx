'use client';

import React, { useState } from 'react';
import { MenstrualHealthProvider } from '../../../lib/menstrual-health/context';
import TrackerSidebar from '../../../components/menstrual-health/TrackerSidebar';
import TrackerHeader from '../../../components/menstrual-health/TrackerHeader';

export default function MenstrualHealthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

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

