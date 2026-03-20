'use client';

import { AuthProvider } from '../../lib/auth';
import Dashboard from './Dashboard';

export default function DashboardPage() {
  return (
    <AuthProvider>
      <Dashboard />
    </AuthProvider>
  );
}
