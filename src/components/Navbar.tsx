'use client';

import { useAuth, logout } from '../lib/auth';
import { useRouter } from 'next/navigation';

export default function Navbar() {
  const { user } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await logout();
      router.push('/login');
    } catch (error) {
      console.error('Logout failed', error);
    }
  };

  return (
    <nav className="bg-white shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div 
            className="text-xl font-bold text-gray-900 cursor-pointer" 
            onClick={() => router.push('/')}
          >
            MEDICORE AI
          </div>
          {user && (
            <button
              onClick={handleLogout}
              className="text-sm font-medium text-gray-600 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 border border-gray-200 px-4 py-2 rounded-lg transition-colors"
            >
              Logout
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
