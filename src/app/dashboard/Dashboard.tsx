'use client';

import { useAuth } from '../../lib/auth'; // We will create this hook
import AdminDashboard from './AdminDashboard';
import DoctorDashboard from './DoctorDashboard';
import PatientDashboard from './PatientDashboard';

export default function Dashboard() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    // This should be handled by a protected route, but as a fallback
    return <div>Please login to continue.</div>;
  }

  switch (user.role) {
    case 'admin':
      return <AdminDashboard />;
    case 'doctor':
      return <DoctorDashboard />;
    case 'patient':
      return <PatientDashboard />;
    default:
      return <div>Unknown role.</div>;
  }
}
