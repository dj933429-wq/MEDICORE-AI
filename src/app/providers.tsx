'use client';

import { AuthProvider } from '../lib/auth';
import PresenceTracker from '@/components/PresenceTracker';
import SessionTimeoutManager from '@/components/SessionTimeoutManager';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <PresenceTracker />
      <SessionTimeoutManager />
      {children}
    </AuthProvider>
  );
}
