'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signup } from '../../lib/auth';

export default function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('patient');
  const [gender, setGender] = useState<'female' | 'male' | 'other'>('female');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setFieldErrors('');

    if (!name.trim()) {
      setFieldErrors('Please enter your full name.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim() || !emailRegex.test(email.trim())) {
      setFieldErrors('Please enter a valid email address.');
      return;
    }

    if (!password || password.length < 6) {
      setFieldErrors('Password must be at least 6 characters long.');
      return;
    }

    setIsLoading(true);
    
    try {
      await signup(email.trim(), password, name.trim(), role, role === 'patient' ? gender : undefined);
      router.push('/dashboard');
    } catch (err: unknown) {
      const authErr = err as { code?: string; message?: string };
      if (authErr.code === 'auth/email-already-in-use') {
        setFieldErrors('This email is already registered. Please sign in or use another email.');
      } else if (authErr.code === 'auth/invalid-email') {
        setFieldErrors('The email address format is invalid.');
      } else if (authErr.code === 'auth/weak-password') {
        setFieldErrors('Password must be at least 6 characters.');
      } else {
        setError(authErr.message || 'Failed to register account. Please try again.');
      }
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full bg-white p-8 rounded-xl shadow-md border border-gray-100">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-gray-900">Create Account</h2>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2" htmlFor="name">
              Full Name *
            </label>
            <input
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent outline-none transition-all"
              id="name"
              type="text"
              required
              placeholder="John Doe"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (fieldErrors) setFieldErrors('');
              }}
              disabled={isLoading}
            />
          </div>

          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2" htmlFor="role">
              Account Role *
            </label>
            <select
              id="role"
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent outline-none transition-all bg-white"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={isLoading}
            >
              <option value="patient">Patient</option>
              <option value="doctor">Doctor</option>
              <option value="pharmacist">Pharmacist</option>
              <option value="blood_bank">Blood Bank Staff</option>
            </select>
          </div>

          {role === 'patient' && (
            <div>
              <label className="block text-gray-700 text-sm font-medium mb-2" htmlFor="gender">
                Biological Sex / Gender *
              </label>
              <select
                id="gender"
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent outline-none transition-all bg-white"
                value={gender}
                onChange={(e) => setGender(e.target.value as 'female' | 'male' | 'other')}
                disabled={isLoading}
              >
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other / Prefer not to say</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Used to personalize health modules (e.g. specialized cycle and menstrual health services).
              </p>
            </div>
          )}

          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2" htmlFor="email">
              Email *
            </label>
            <input
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent outline-none transition-all"
              id="email"
              type="email"
              required
              placeholder="user@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors) setFieldErrors('');
              }}
              disabled={isLoading}
            />
          </div>
          
          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2" htmlFor="password">
              Password *
            </label>
            <input
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent outline-none transition-all"
              id="password"
              type="password"
              required
              minLength={6}
              placeholder="•••••••• (min 6 characters)"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (fieldErrors) setFieldErrors('');
              }}
              disabled={isLoading}
            />
          </div>

          {fieldErrors && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg font-medium">
              {fieldErrors}
            </div>
          )}

          <button
            className="w-full flex justify-center py-3 px-4 mt-6 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600 transition-colors disabled:opacity-50"
            type="submit"
            disabled={isLoading}
          >
            {isLoading ? 'Creating...' : 'Sign Up'}
          </button>
        </form>

        <p className="text-center mt-6 text-gray-600 text-sm">
          Already have an account?{' '}
          <Link href="/login" className="text-blue-600 hover:text-blue-700 font-medium">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}
