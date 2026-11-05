'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, logout } from '@/lib/auth';

const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes in milliseconds
const STORAGE_KEY = 'medicore_last_activity';

export default function SessionTimeoutManager() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const lastWriteRef = useRef<number>(0);
  const isLoggingOutRef = useRef<boolean>(false);

  useEffect(() => {
    if (loading || !user) {
      isLoggingOutRef.current = false;
      return;
    }

    // Helper: update activity timestamp (throttled to at most once every 5 seconds)
    const recordActivity = () => {
      const now = Date.now();
      if (now - lastWriteRef.current >= 5000) {
        lastWriteRef.current = now;
        try {
          localStorage.setItem(STORAGE_KEY, String(now));
        } catch {
          // Ignore localStorage access restrictions in incognito/restricted mode
        }
      }
    };

    // Helper: execute logout on inactivity
    const triggerInactivityLogout = async () => {
      if (isLoggingOutRef.current) return;
      isLoggingOutRef.current = true;
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore
      }

      try {
        const token = typeof user?.getIdToken === 'function' ? await user.getIdToken() : '';
        if (token) {
          await fetch('/api/presence/session', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ action: 'timeout', reason: 'inactivity_timeout' }),
          }).catch(() => {});
        }
      } catch {
        // Ignore network failure on timeout notice
      }

      try {
        await logout();
      } catch (err) {
        console.warn('[SessionTimeout] Error during inactivity logout:', err);
      }

      router.replace('/login?reason=session_expired');
    };

    // Helper: inspect whether session has exceeded 10 minutes
    const checkInactivity = () => {
      if (isLoggingOutRef.current) return;
      try {
        const storedStr = localStorage.getItem(STORAGE_KEY);
        const now = Date.now();

        if (!storedStr) {
          // Initialize if missing
          localStorage.setItem(STORAGE_KEY, String(now));
          return;
        }

        const lastActivity = Number(storedStr);
        if (Number.isFinite(lastActivity) && now - lastActivity >= INACTIVITY_TIMEOUT_MS) {
          triggerInactivityLogout();
        }
      } catch {
        // Fallback if localStorage disabled
      }
    };

    // 1. Check immediately on mount (in case user reloaded after being idle for 1-2 hours)
    checkInactivity();
    recordActivity();

    // 2. Periodic interval check every 5 seconds
    const intervalId = setInterval(checkInactivity, 5000);

    // 3. User interaction listeners across the window
    const onUserAction = () => {
      checkInactivity();
      recordActivity();
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach((evt) => {
      window.addEventListener(evt, onUserAction, { passive: true });
    });

    // 4. Check immediately when tab gains visibility (e.g. user returns after being in another app/tab)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkInactivity();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // 5. Cross-tab activity sync: if user is active in Tab A, Tab B syncs the new timestamp
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        const val = Number(e.newValue);
        if (Number.isFinite(val)) {
          lastWriteRef.current = val;
        }
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      clearInterval(intervalId);
      events.forEach((evt) => {
        window.removeEventListener(evt, onUserAction);
      });
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [user, loading, router]);

  return null;
}

