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
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setEmailError('');
    setPasswordError('');

    let hasClientError = false;

    if (!name.trim()) {
      setError('Please enter your full name.');
      hasClientError = true;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim() || !emailRegex.test(email.trim())) {
      setEmailError('Please enter a valid email address.');
      hasClientError = true;
    }

    if (!password || password.length < 6) {
      setPasswordError('Password must be at least 6 characters long.');
      hasClientError = true;
    }

    if (hasClientError) return;

    setIsLoading(true);
    
    try {
      await signup(email.trim(), password, name.trim(), role, role === 'patient' ? gender : undefined);
      router.push('/dashboard');
    } catch (err: unknown) {
      const authErr = err as { code?: string; message?: string };
      if (authErr.code === 'auth/email-already-in-use') {
        setEmailError('This email is already registered. Please sign in or use another email.');
      } else if (authErr.code === 'auth/invalid-email') {
        setEmailError('The email address format is invalid.');
      } else if (authErr.code === 'auth/weak-password') {
        setPasswordError('Password must be at least 6 characters.');
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
                if (error) setError('');
              }}
              disabled={isLoading}
            />
          </div>

          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2" htmlFor="role">
              Account Role
            </label>
            <select
              id="role"
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
                Biological Sex / Gender
              </label>
              <select
                id="gender"
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
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 outline-none transition-all ${
                emailError
                  ? 'border-red-400 focus:ring-red-500 bg-red-50/30'
                  : 'border-gray-300 focus:ring-blue-600 focus:border-transparent'
              }`}
              id="email"
              type="email"
              required
              placeholder="user@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError('');
              }}
              disabled={isLoading}
            />
            {emailError && (
              <p className="text-xs text-red-600 mt-1 font-medium">{emailError}</p>
            )}
          </div>
          
          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2" htmlFor="password">
              Password *
            </label>
            <input
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 outline-none transition-all ${
                passwordError
                  ? 'border-red-400 focus:ring-red-500 bg-red-50/30'
                  : 'border-gray-300 focus:ring-blue-600 focus:border-transparent'
              }`}
              id="password"
              type="password"
              required
              minLength={6}
              placeholder="•••••••• (min 6 characters)"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError('');
              }}
              disabled={isLoading}
            />
            {passwordError && (
              <p className="text-xs text-red-600 mt-1 font-medium">{passwordError}</p>
            )}
          </div>

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
