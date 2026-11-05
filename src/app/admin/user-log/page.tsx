'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

interface UserLogRecord {
  uid: string;
  name: string;
  email: string;
  role: 'admin' | 'doctor' | 'pharmacist' | 'blood_bank' | 'patient';
  isOnline: boolean;
  timeSinceLastSeenMs: number;
  lastInteractionType: string;
  sessionStartedAt: string | null;
  sessionEndedAt: string | null;
  currentSessionSec: number;
  currentSessionFormatted: string;
  totalTimeSpentSec: number;
  totalTimeSpentFormatted: string;
  createdAt: string | null;
  createdEpoch: number;
  lastSignInAt: string | null;
  lastSignInEpoch: number;
  lastSeenAt: string | null;
  lastSeenEpoch: number;
  disabled: boolean;
}

export default function UserLogPage() {
  const { user, loading: authLoading } = useAuth();
  const [records, setRecords] = useState<UserLogRecord[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [offlineCount, setOfflineCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'last_signin' | 'signup' | 'online_first' | 'total_time'>('online_first');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [presenceFilter, setPresenceFilter] = useState<'all' | 'online_only' | 'offline_only'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [adminToken, setAdminToken] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLogs = useCallback(async (isSilent = false) => {
    if (!user || user.role !== 'admin') return;
    if (!isSilent) setLoading(true);
    setError(null);

    try {
      const token = typeof user.getIdToken === 'function' ? await user.getIdToken() : '';
      if (!token) throw new Error('Failed to retrieve administrator authentication token.');
      setAdminToken(token);

      const params = new URLSearchParams({
        sortBy,
        role: roleFilter,
        presence: presenceFilter,
      });

      const res = await fetch(`/api/admin/user-log?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}: Failed to fetch user log.`);
      }

      const data = await res.json();
      setRecords(data.users || []);
      setOnlineCount(data.onlineCount || 0);
      setOfflineCount(data.offlineCount || 0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [user, sortBy, roleFilter, presenceFilter]);

  useEffect(() => {
    if (!authLoading && user && user.role === 'admin') {
      fetchLogs();
    }
  }, [authLoading, user, fetchLogs]);

  // Periodic Auto-refresh (every 10 seconds)
  useEffect(() => {
    if (!autoRefresh || authLoading || !user || user.role !== 'admin') return;
    const interval = setInterval(() => {
      fetchLogs(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, authLoading, user, fetchLogs]);

  // Authorization Check
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-slate-100">
        <div className="w-12 h-12 border-4 border-rose-500/30 border-t-rose-500 rounded-full animate-spin mb-4" />
        <p className="text-sm font-semibold tracking-wider text-slate-400">Verifying Administrator Privileges...</p>
      </div>
    );
  }

  if (!user || user.role !== 'admin') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="bg-slate-900 border border-rose-900/50 rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
          <div className="w-16 h-16 bg-rose-500/10 text-rose-500 border border-rose-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m0 0v2m0-2h2m-2 0H10m4-8V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Access Denied (403)</h1>
          <p className="text-sm text-slate-400 mb-6 leading-relaxed">
            This backend activity log is strictly restricted to system administrators. Your current account does not have sufficient privileges.
          </p>
          <Link
            href="/dashboard"
            className="inline-block w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl transition-colors border border-slate-700 text-sm"
          >
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const filteredRecords = records.filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q) ||
      r.uid.toLowerCase().includes(q) ||
      r.role.toLowerCase().includes(q)
    );
  });

  const roleStyles: Record<string, { bg: string; text: string; border: string }> = {
    admin: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/30' },
    doctor: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' },
    pharmacist: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' },
    blood_bank: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30' },
    patient: { bg: 'bg-sky-500/10', text: 'text-sky-400', border: 'border-sky-500/30' },
  };

  const formatTimestamp = (iso: string | null) => {
    if (!iso) return <span className="text-slate-500 italic text-xs">Never</span>;
    const d = new Date(iso);
    return (
      <div className="flex flex-col">
        <span className="font-medium text-slate-200 text-xs">
          {d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })}
        </span>
        <span className="text-[10px] text-slate-400 font-mono">
          {d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </div>
    );
  };

  const formatTimeOnly = (iso: string | null) => {
    if (!iso) return 'N/A';
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const rawHtmlUrl = adminToken
    ? `/api/admin/user-log?sortBy=${sortBy}&role=${roleFilter}&presence=${presenceFilter}&format=html&token=${encodeURIComponent(adminToken)}`
    : '#';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xl">
          <div>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-500/20 text-rose-400 border border-rose-500/30">
                Backend Admin Console
              </span>
              <span className="text-xs text-slate-500 font-mono">Real-Time Presence & Activity</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-2">
              User Presence & Role Activity Log
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
              Live online/offline tracking, page activity & scroll monitor, active session time range, and cumulative role duration.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard"
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition"
            >
              Dashboard
            </Link>
            {adminToken && (
              <a
                href={rawHtmlUrl}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-rose-600/30 transition flex items-center gap-1.5"
              >
                <span>Open Raw Backend HTML View</span>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
          </div>
        </div>

        {/* Real-time Status Badges */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-slate-900 border border-emerald-500/20 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-emerald-400 font-semibold uppercase tracking-wider">Active Users Online</div>
              <div className="text-2xl font-extrabold text-white mt-1">{onlineCount}</div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <span className="w-3.5 h-3.5 rounded-full bg-emerald-400 animate-ping" />
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Users Offline</div>
              <div className="text-2xl font-extrabold text-white mt-1">{offlineCount}</div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center">
              <span className="w-3.5 h-3.5 rounded-full bg-slate-500" />
            </div>
          </div>

          <div className="bg-slate-900 border border-indigo-500/20 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-indigo-400 font-semibold uppercase tracking-wider">Total Registered Accounts</div>
              <div className="text-2xl font-extrabold text-white mt-1">{records.length}</div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-xs">
              ALL
            </div>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                placeholder="Search user by name, email, role, or UID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500 transition"
              />
            </div>

            {/* Presence Filter */}
            <div className="flex items-center gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
              <span className="text-[11px] font-semibold text-slate-400 px-2">Presence:</span>
              {(['all', 'online_only', 'offline_only'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setPresenceFilter(mode)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    presenceFilter === mode
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  {mode === 'all' ? 'All' : mode === 'online_only' ? 'Online Only' : 'Offline Only'}
                </button>
              ))}
            </div>

            {/* Sort Toggle */}
            <div className="flex items-center gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
              <span className="text-[11px] font-semibold text-slate-400 px-2">Sort:</span>
              <button
                onClick={() => setSortBy('online_first')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  sortBy === 'online_first'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                Online First
              </button>
              <button
                onClick={() => setSortBy('total_time')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  sortBy === 'total_time'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                Total Time
              </button>
              <button
                onClick={() => setSortBy('last_signin')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  sortBy === 'last_signin'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                Sign-In
              </button>
            </div>
          </div>

          {/* Role Pills & Auto-Refresh Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/60">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-400 font-medium mr-2">Role Filter:</span>
              {['all', 'patient', 'doctor', 'pharmacist', 'blood_bank', 'admin'].map((role) => (
                <button
                  key={role}
                  onClick={() => setRoleFilter(role)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium uppercase tracking-wider transition ${
                    roleFilter === role
                      ? 'bg-slate-200 text-slate-900 font-bold'
                      : 'bg-slate-950 text-slate-400 border border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {role}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-rose-600 focus:ring-0"
                />
                <span>Auto-Refresh (10s)</span>
              </label>

              <button
                onClick={() => fetchLogs()}
                className="text-xs text-slate-300 hover:text-white px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition"
              >
                Refresh Data
              </button>
            </div>
          </div>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-400 text-sm flex items-center gap-3">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Main Data Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          {loading ? (
            <div className="p-16 flex flex-col items-center justify-center">
              <div className="w-10 h-10 border-4 border-rose-500/20 border-t-rose-500 rounded-full animate-spin mb-4" />
              <p className="text-xs text-slate-400 font-semibold tracking-wider">Syncing User Presence & Logs...</p>
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="p-16 text-center text-slate-500">
              <p className="text-base font-semibold">No records match the current filters.</p>
              <p className="text-xs mt-1">Try resetting the search query or selecting a different role or presence status.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/50 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="py-3 px-4">User & UID</th>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Presence Status</th>
                    <th className="py-3 px-4">Active Time Window (From - To)</th>
                    <th className="py-3 px-4">Total Time in Role</th>
                    <th className="py-3 px-4">Last Sign-In</th>
                    <th className="py-3 px-4">Account Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs">
                  {filteredRecords.map((item) => {
                    const style = roleStyles[item.role] || { bg: 'bg-slate-800', text: 'text-slate-400', border: 'border-slate-700' };

                    return (
                      <tr key={item.uid} className="hover:bg-slate-800/40 transition-colors">
                        {/* User & UID */}
                        <td className="py-3.5 px-4 font-semibold text-slate-200">
                          <div className="text-sm font-bold text-white">{item.name}</div>
                          <div className="text-[10px] font-mono text-slate-500 truncate max-w-[150px]">{item.uid}</div>
                        </td>

                        {/* Email */}
                        <td className="py-3.5 px-4 text-slate-300 font-mono text-[11px]">
                          {item.email}
                        </td>

                        {/* Role */}
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${style.bg} ${style.text} ${style.border}`}
                          >
                            {item.role}
                          </span>
                        </td>

                        {/* Presence Status */}
                        <td className="py-3.5 px-4">
                          {item.isOnline ? (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                ONLINE
                              </span>
                              <div className="text-[10px] text-emerald-500/80 font-mono capitalize">
                                {item.lastInteractionType || 'scrolling'}
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                                <span className="w-2 h-2 rounded-full bg-slate-500" />
                                OFFLINE
                              </span>
                              <div className="text-[10px] text-slate-500 font-mono">
                                {item.lastSeenAt ? `Last: ${formatTimeOnly(item.lastSeenAt)}` : 'No activity'}
                              </div>
                            </div>
                          )}
                        </td>

                        {/* Active Time Window ("From what time to what time they are online") */}
                        <td className="py-3.5 px-4">
                          {item.isOnline ? (
                            <div>
                              <div className="text-emerald-400 font-semibold text-xs">
                                From {formatTimeOnly(item.sessionStartedAt)} &rarr; Active Now
                              </div>
                              <div className="text-[10px] text-emerald-500 font-mono mt-0.5">
                                Ongoing ({item.currentSessionFormatted})
                              </div>
                            </div>
                          ) : item.sessionStartedAt && item.sessionEndedAt ? (
                            <div>
                              <div className="text-slate-300 font-medium text-xs">
                                {formatTimeOnly(item.sessionStartedAt)} &rarr; {formatTimeOnly(item.sessionEndedAt)}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                                Session: {item.currentSessionFormatted}
                              </div>
                            </div>
                          ) : (
                            <div className="text-slate-500 italic text-[11px]">
                              {item.lastSeenAt ? `Last seen ${formatTimeOnly(item.lastSeenAt)}` : 'No session data'}
                            </div>
                          )}
                        </td>

                        {/* Total Time in Role */}
                        <td className="py-3.5 px-4 font-bold text-white font-mono text-xs">
                          {item.totalTimeSpentFormatted}
                        </td>

                        {/* Last Sign-In */}
                        <td className="py-3.5 px-4">
                          {formatTimestamp(item.lastSignInAt)}
                        </td>

                        {/* Account Created */}
                        <td className="py-3.5 px-4">
                          {formatTimestamp(item.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="text-center text-xs text-slate-500 pt-4">
          MEDICORE-AI Secure Presence & Audit System &bull; Local Development Only (Strict Admin Access)
        </div>
      </div>
    </div>
  );
}
