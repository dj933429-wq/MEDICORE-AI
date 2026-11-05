'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { auth } from '@/lib/firebase';

interface AdminUser {
  uid: string;
  name: string;
  email: string;
  role: string;
  requestedRole?: string | null;
  createdAt?: string | null;
  customClaims?: Record<string, unknown>;
}

export default function AdminDashboard() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Track role dropdown selections per user: { [uid]: selectedRole }
  const [roleSelections, setRoleSelections] = useState<Record<string, string>>({});
  
  // Confirmation Modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    targetUser: AdminUser | null;
    newRole: string;
  }>({
    isOpen: false,
    targetUser: null,
    newRole: '',
  });

  // Decline Request Modal state
  const [declineModal, setDeclineModal] = useState<{
    isOpen: boolean;
    targetUser: AdminUser | null;
  }>({
    isOpen: false,
    targetUser: null,
  });

  const [updatingUid, setUpdatingUid] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [quotaWarning, setQuotaWarning] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);

    try {
      const token = auth.currentUser 
        ? await auth.currentUser.getIdToken() 
        : (currentUser && typeof currentUser.getIdToken === 'function' ? await currentUser.getIdToken() : null);

      if (!token) {
        throw new Error('Authentication token not available. Please re-authenticate.');
      }

      const res = await fetch('/api/admin/users', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP error ${res.status}`);
      }

      const data = await res.json();
      setUsers(data.users || []);
      setQuotaWarning(data.warning || null);

      // Initialize selected roles map
      const initialRoles: Record<string, string> = {};
      (data.users || []).forEach((u: AdminUser) => {
        initialRoles[u.uid] = u.role;
      });
      setRoleSelections(initialRoles);

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to load user directory:', message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleRoleChangeSelect = (uid: string, newRole: string) => {
    setRoleSelections(prev => ({
      ...prev,
      [uid]: newRole
    }));
    setActionError(null);
  };

  const openConfirmation = (targetUser: AdminUser) => {
    const newRole = roleSelections[targetUser.uid] || targetUser.role;
    if (newRole === targetUser.role) return;

    setConfirmModal({
      isOpen: true,
      targetUser,
      newRole,
    });
  };

  const handleQuickApproveRequest = (targetUser: AdminUser) => {
    if (!targetUser.requestedRole) return;
    setRoleSelections(prev => ({
      ...prev,
      [targetUser.uid]: targetUser.requestedRole!
    }));
    setConfirmModal({
      isOpen: true,
      targetUser,
      newRole: targetUser.requestedRole
    });
  };

  const openDeclineConfirmation = (targetUser: AdminUser) => {
    setDeclineModal({
      isOpen: true,
      targetUser
    });
  };

  const applyDeclineRequest = async () => {
    if (!declineModal.targetUser || !currentUser) return;

    const targetUser = declineModal.targetUser;
    setUpdatingUid(targetUser.uid);
    setDeclineModal({ isOpen: false, targetUser: null });
    setActionError(null);

    try {
      const token = auth.currentUser 
        ? await auth.currentUser.getIdToken() 
        : (currentUser && typeof currentUser.getIdToken === 'function' ? await currentUser.getIdToken() : null);

      if (!token) {
        throw new Error('Authentication token not available. Please re-authenticate.');
      }

      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          targetUid: targetUser.uid,
          action: 'decline_request'
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP error ${res.status}`);
      }

      // Update user in local state: clear requestedRole
      setUsers(prev => prev.map(u => {
        if (u.uid === targetUser.uid) {
          return {
            ...u,
            requestedRole: null
          };
        }
        return u;
      }));

      setSuccessNotice(`Role request for ${targetUser.name} (${targetUser.requestedRole}) has been declined.`);
      setTimeout(() => setSuccessNotice(null), 5000);

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to decline role request:', message);
      setActionError(message);
    } finally {
      setUpdatingUid(null);
    }
  };

  const applyRoleChange = async () => {
    if (!confirmModal.targetUser || !currentUser) return;

    const targetUser = confirmModal.targetUser;
    const newRole = confirmModal.newRole;

    setUpdatingUid(targetUser.uid);
    setConfirmModal({ isOpen: false, targetUser: null, newRole: '' });
    setActionError(null);
    setSuccessNotice(null);

    try {
      const token = auth.currentUser 
        ? await auth.currentUser.getIdToken() 
        : (currentUser && typeof currentUser.getIdToken === 'function' ? await currentUser.getIdToken() : null);

      if (!token) {
        throw new Error('Authentication token not available. Please re-authenticate.');
      }

      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          targetUid: targetUser.uid,
          newRole
        })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `Failed to update role (${res.status})`);
      }

      setSuccessNotice(
        `Role for ${targetUser.name} (${targetUser.email}) successfully updated to '${newRole}'. ` +
        `The affected user must sign out and sign in again, or refresh their Firebase ID token, for the new permissions to take effect.`
      );

      // Refresh directory to verify live state
      await fetchUsers();

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Role update failed:', message);
      setActionError(message);
    } finally {
      setUpdatingUid(null);
    }
  };

  const filteredUsers = users.filter(u =>
    (u.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.role || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      {/* Background Texture */}
      <div 
        className="absolute inset-0 opacity-[0.03] pointer-events-none" 
        style={{ backgroundImage: 'radial-gradient(circle at center, #000 1px, transparent 1px)', backgroundSize: '24px 24px' }}
      />
      
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <header className="mb-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-4xl font-extrabold text-slate-800 tracking-tight mb-2">
              Administrator <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">Portal</span>
            </h1>
            <p className="text-slate-500 text-lg">Manage platform users, privileged Custom Claims, and role assignments</p>
          </div>
          <div className="flex items-center gap-3 self-start md:self-auto flex-wrap">
            <Link
              href="/admin/user-log"
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl transition-colors shadow-sm font-semibold text-sm"
            >
              <svg className="w-4 h-4 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Sign-In & Activity Log (HTML)
            </Link>
            <button
              onClick={fetchUsers}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors shadow-sm font-medium text-sm disabled:opacity-50"
            >
              <svg className={`w-4 h-4 ${loading ? 'animate-spin text-blue-600' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh Directory
            </button>
          </div>
        </header>

        {/* Global Notifications */}
        {successNotice && (
          <div className="mb-8 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start justify-between gap-3 text-emerald-800 shadow-sm animate-fade-in">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="font-semibold text-sm">Role Updated Successfully</p>
                <p className="text-xs text-emerald-700 mt-1 leading-relaxed">{successNotice}</p>
              </div>
            </div>
            <button 
              onClick={() => setSuccessNotice(null)}
              className="text-emerald-500 hover:text-emerald-800 text-sm font-bold p-1"
            >
              ×
            </button>
          </div>
        )}

        {actionError && (
          <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start justify-between gap-3 text-red-800 shadow-sm animate-fade-in">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-red-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="font-semibold text-sm">Action Failed</p>
                <p className="text-xs text-red-700 mt-1">{actionError}</p>
              </div>
            </div>
            <button 
              onClick={() => setActionError(null)}
              className="text-red-500 hover:text-red-800 text-sm font-bold p-1"
            >
              ×
            </button>
          </div>
        )}

        {/* Stats Section */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
          <div className="bg-white rounded-2xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Accounts</p>
              <p className="text-2xl font-bold text-slate-800">{users.length}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Doctors</p>
              <p className="text-2xl font-bold text-emerald-700">{users.filter(u => u.role === 'doctor').length}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 shrink-0">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Pharmacists</p>
              <p className="text-2xl font-bold text-amber-700">{users.filter(u => u.role === 'pharmacist').length}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-purple-50 flex items-center justify-center text-purple-600 shrink-0">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Pending Requests</p>
              <p className="text-2xl font-bold text-purple-700">
                {users.filter(u => u.requestedRole && u.requestedRole !== u.role).length}
              </p>
            </div>
          </div>
        </div>

        {/* Directory Table Card */}
        <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-800">User Directory & Role Control</h2>
              <p className="text-xs text-slate-400 mt-0.5">Authoritative Custom Claims fetched directly from Firebase Authentication</p>
            </div>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search name, email, or role..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2.5 w-full sm:w-80 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-sm"
              />
            </div>
          </div>

          {loading ? (
            <div className="p-16 flex flex-col items-center justify-center">
              <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
              <p className="text-slate-500 font-medium text-sm">Loading authoritative user directory...</p>
            </div>
          ) : error ? (
            <div className="p-8 sm:p-12 text-center max-w-2xl mx-auto">
              <div className="w-14 h-14 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4 border border-amber-200">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>

              {error.toLowerCase().includes('credential') || error.toLowerCase().includes('service account') || error.toLowerCase().includes('no_adc_found') ? (
                <>
                  <h3 className="text-lg font-bold text-slate-800 mb-2">Firebase Admin SDK Credentials Required</h3>
                  <p className="text-sm text-slate-600 mb-6 leading-relaxed">
                    {error}
                  </p>
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-left mb-6 text-xs text-slate-700 space-y-3">
                    <p className="font-semibold text-slate-800 flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px]">1</span>
                      Option 1: Add Service Account Key to .env.local (Recommended)
                    </p>
                    <p className="text-slate-500 pl-7 leading-relaxed">
                      Go to <strong>Firebase Console &rarr; Project Settings &rarr; Service accounts</strong>, click <strong>Generate new private key</strong>, and add the minified JSON to your local <code>.env.local</code>:
                    </p>
                    <div className="pl-7">
                      <pre className="bg-slate-900 text-slate-100 p-3 rounded-xl overflow-x-auto text-[11px] font-mono">
                        FIREBASE_SERVICE_ACCOUNT_KEY=&#123;&quot;type&quot;:&quot;service_account&quot;,...&#125;
                      </pre>
                    </div>
                  </div>
                </>
              ) : error.includes('RESOURCE_EXHAUSTED') || error.toLowerCase().includes('quota') ? (
                <>
                  <h3 className="text-lg font-bold text-slate-800 mb-2">Cloud Firestore Daily Quota Limit Reached</h3>
                  <p className="text-sm text-slate-600 mb-6 leading-relaxed">
                    The Google Cloud free-tier Spark plan daily read/write quota (50,000 reads/day) for Cloud Firestore has temporarily been reached on project <code>medicore-ai-exhibition</code>. Daily quotas reset automatically at midnight US Pacific Time (13:30 IST).
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-bold text-slate-800 mb-2">Failed to Load User Directory</h3>
                  <p className="text-sm text-slate-600 mb-6 leading-relaxed">
                    {error}
                  </p>
                </>
              )}

              <button
                onClick={fetchUsers}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Retry Connection
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              {quotaWarning && (
                <div className="mx-6 my-4 p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800 text-xs flex items-center gap-2.5">
                  <svg className="w-4 h-4 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{quotaWarning}</span>
                </div>
              )}
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/75 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-100">
                    <th className="px-6 py-4 font-semibold">User</th>
                    <th className="px-6 py-4 font-semibold">Email</th>
                    <th className="px-6 py-4 font-semibold text-center">Effective Role</th>
                    <th className="px-6 py-4 font-semibold">Pending Request</th>
                    <th className="px-6 py-4 font-semibold text-right">Role Management</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredUsers.map(u => {
                    const isSelf = currentUser?.uid === u.uid;
                    const isSystemAdmin = u.role === 'admin';
                    const selectedRole = roleSelections[u.uid] || u.role;
                    const isDirty = selectedRole !== u.role;
                    const isUpdating = updatingUid === u.uid;
                    const hasPendingRole = Boolean(u.requestedRole && u.requestedRole !== u.role);

                    return (
                      <tr key={u.uid} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-100 to-blue-100 flex items-center justify-center text-indigo-700 font-bold uppercase shrink-0">
                              {(u.name || '?').charAt(0)}
                            </div>
                            <div>
                              <div className="font-semibold text-slate-800 flex items-center gap-2">
                                {u.name}
                                {isSelf && (
                                  <span className="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full font-bold">
                                    You
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] font-mono text-slate-400">
                                UID: {u.uid.slice(0, 8)}...
                              </span>
                            </div>
                          </div>
                        </td>
                        
                        <td className="px-6 py-4 text-slate-600 whitespace-nowrap">
                          {u.email || <span className="text-slate-400 italic">No email</span>}
                        </td>

                        <td className="px-6 py-4 text-center whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold
                            ${u.role === 'admin' ? 'bg-red-100 text-red-700 border border-red-200' : 
                              u.role === 'doctor' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 
                              u.role === 'pharmacist' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 
                              u.role === 'blood_bank' ? 'bg-rose-100 text-rose-700 border border-rose-200' :
                              'bg-blue-100 text-blue-700 border border-blue-200'}`}>
                            {u.role.toUpperCase()}
                          </span>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          {hasPendingRole ? (
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                                {u.requestedRole}
                              </span>
                              <button
                                onClick={() => handleQuickApproveRequest(u)}
                                disabled={isUpdating}
                                className="text-xs bg-purple-600 hover:bg-purple-700 text-white font-medium px-2.5 py-1 rounded-lg transition-colors shadow-sm"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => openDeclineConfirmation(u)}
                                disabled={isUpdating}
                                className="text-xs bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-medium px-2.5 py-1 rounded-lg transition-colors"
                              >
                                Decline
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">None</span>
                          )}
                        </td>

                        <td className="px-6 py-4 text-right whitespace-nowrap">
                          {isSelf || isSystemAdmin ? (
                            <span className="text-xs text-slate-400 italic font-medium px-2">
                              {isSelf ? 'Self (Protected)' : 'System Admin'}
                            </span>
                          ) : (
                            <div className="inline-flex items-center gap-2">
                              <select
                                value={selectedRole}
                                onChange={(e) => handleRoleChangeSelect(u.uid, e.target.value)}
                                disabled={isUpdating}
                                className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                              >
                                <option value="patient">Patient</option>
                                <option value="doctor">Doctor</option>
                                <option value="pharmacist">Pharmacist</option>
                                <option value="blood_bank">Blood Bank Staff</option>
                              </select>

                              <button
                                onClick={() => openConfirmation(u)}
                                disabled={!isDirty || isUpdating}
                                className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                                  isDirty
                                    ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                }`}
                              >
                                {isUpdating ? (
                                  <>
                                    <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                    Saving...
                                  </>
                                ) : (
                                  'Save'
                                )}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {filteredUsers.length === 0 && (
                <div className="p-12 text-center text-slate-500">
                  <p className="text-base font-semibold text-slate-700">No users found</p>
                  <p className="text-xs text-slate-400 mt-1">Try adjusting your search criteria</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Decline Request Modal */}
      {declineModal.isOpen && declineModal.targetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-slate-100">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mb-5">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>

            <h3 className="text-xl font-bold text-slate-800 mb-2">Decline Role Request</h3>
            <p className="text-sm text-slate-600 mb-4 leading-relaxed">
              Are you sure you want to decline the role request from{' '}
              <strong className="text-slate-800">{declineModal.targetUser.name}</strong> ({declineModal.targetUser.email})?
            </p>

            <div className="bg-slate-50 p-4 rounded-2xl mb-6 border border-slate-100 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Current Role:</span>
                <span className="font-semibold text-slate-700 capitalize">{declineModal.targetUser.role}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Requested Role:</span>
                <span className="font-bold text-rose-600 uppercase">{declineModal.targetUser.requestedRole}</span>
              </div>
              <p className="text-[11px] text-slate-400 border-t border-slate-200/60 pt-2 mt-2 leading-normal">
                Declining this request will dismiss the application. The user will remain as a <strong>{declineModal.targetUser.role}</strong> and will not receive any privileged Custom Claims.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeclineModal({ isOpen: false, targetUser: null })}
                className="px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Keep Request
              </button>
              <button
                type="button"
                onClick={applyDeclineRequest}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-sm transition-all hover:shadow-[0_0_15px_rgba(225,29,72,0.3)]"
              >
                Decline Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal.isOpen && confirmModal.targetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-slate-100">
            <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mb-5">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>

            <h3 className="text-xl font-bold text-slate-800 mb-2">Confirm Role Change</h3>
            <p className="text-sm text-slate-600 mb-4 leading-relaxed">
              Are you sure you want to change the role for{' '}
              <strong className="text-slate-800">{confirmModal.targetUser.name}</strong> ({confirmModal.targetUser.email})?
            </p>

            <div className="bg-slate-50 p-4 rounded-2xl mb-6 border border-slate-100 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Current Role:</span>
                <span className="font-semibold text-slate-700 capitalize">{confirmModal.targetUser.role}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">New Assigned Role:</span>
                <span className="font-bold text-blue-600 uppercase">{confirmModal.newRole}</span>
              </div>
              <p className="text-[11px] text-slate-400 border-t border-slate-200/60 pt-2 mt-2 leading-normal">
                This operation will update the user&apos;s Firebase Authentication Custom Claims. The user will be required to refresh their token or sign in again.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmModal({ isOpen: false, targetUser: null, newRole: '' })}
                className="px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyRoleChange}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm transition-all hover:shadow-[0_0_15px_rgba(37,99,235,0.3)]"
              >
                Confirm &amp; Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
