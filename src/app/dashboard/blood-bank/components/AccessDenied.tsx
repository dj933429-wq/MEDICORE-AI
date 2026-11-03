'use client';

import Link from 'next/link';

interface AccessDeniedProps {
  userRole?: string | null;
  userEmail?: string | null;
}

export default function AccessDenied({ userRole, userEmail }: AccessDeniedProps) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center px-4 py-12">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-100 p-8 text-center">
        <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-slate-900 mb-2">Access Denied</h1>
        <p className="text-sm font-semibold text-rose-600 uppercase tracking-wider mb-4">
          Blood Bank Role Required
        </p>

        <p className="text-slate-600 text-sm mb-6 leading-relaxed">
          The Blood Bank Management System is restricted exclusively to authenticated personnel with the verified{' '}
          <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded font-mono text-xs font-semibold">
            blood_bank
          </code>{' '}
          role claim. Other roles (Patient, Doctor, Pharmacist, and Administrator) are prohibited from accessing donor records,
          screening data, and blood inventory.
        </p>

        <div className="bg-slate-50 rounded-xl p-4 mb-6 text-left border border-slate-100">
          <div className="flex justify-between items-center text-xs text-slate-500 mb-1">
            <span>Signed-in User:</span>
            <span className="font-medium text-slate-700 truncate max-w-[180px]">{userEmail || 'Unknown'}</span>
          </div>
          <div className="flex justify-between items-center text-xs text-slate-500">
            <span>Current Role:</span>
            <span className="font-semibold text-rose-600 capitalize">{userRole || 'None'}</span>
          </div>
        </div>

        <div className="space-y-3">
          <Link
            href="/dashboard"
            className="w-full inline-flex justify-center items-center px-4 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 transition-colors shadow-sm"
          >
            Return to Dashboard
          </Link>
          <p className="text-xs text-slate-400">
            If you believe this is an error, contact the system administrator to request authorized blood bank credentials.
          </p>
        </div>
      </div>
    </div>
  );
}
