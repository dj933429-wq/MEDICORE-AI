'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { rtdb } from '@/lib/firebase';
import { ref, onDisconnect, remove } from 'firebase/database';

export default function PresenceTracker() {
  const { user } = useAuth();
  const connectionKeyRef = useRef<string | null>(null);
  const lastActivityReportRef = useRef<number>(0);
  const isConnectingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!user || !user.uid) {
      connectionKeyRef.current = null;
      return;
    }

    const uid = user.uid;
    let isSubscribed = true;

    // Helper: call backend presence session endpoint
    const callPresenceApi = async (
      action: 'login' | 'activity' | 'heartbeat' | 'logout',
      extra: Record<string, unknown> = {}
    ) => {
      try {
        const token = typeof user.getIdToken === 'function' ? await user.getIdToken() : '';
        if (!token) return null;

        const res = await fetch('/api/presence/session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action,
            connectionKey: connectionKeyRef.current,
            ...extra,
          }),
        });

        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    };

    // 1. Establish initial trusted presence session
    const initPresenceSession = async () => {
      if (isConnectingRef.current || connectionKeyRef.current) return;
      isConnectingRef.current = true;

      try {
        const result = await callPresenceApi('login');
        if (!isSubscribed || !result?.connectionKey) return;

        const connKey = result.connectionKey;
        connectionKeyRef.current = connKey;
        lastActivityReportRef.current = Date.now();

        // Attach client-side onDisconnect hook so RTDB drops connection on crash/drop
        try {
          const clientConnRef = ref(rtdb, `presence/${uid}/${connKey}`);
          onDisconnect(clientConnRef).remove();
        } catch (rtdbErr) {
          console.debug('[PresenceTracker] RTDB onDisconnect hook:', rtdbErr);
        }
      } finally {
        isConnectingRef.current = false;
      }
    };

    initPresenceSession();

    // 2. Periodic activity heartbeat (every 60 seconds while visible)
    const heartbeatInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible' && connectionKeyRef.current) {
        callPresenceApi('activity');
        lastActivityReportRef.current = Date.now();
      }
    }, 60000);

    // 3. User interaction listener (throttled to at most once every 60 seconds)
    const onUserInteraction = () => {
      const now = Date.now();
      if (now - lastActivityReportRef.current < 60000) return;
      lastActivityReportRef.current = now;

      if (typeof document !== 'undefined' && document.visibilityState === 'visible' && connectionKeyRef.current) {
        callPresenceApi('activity');
      }
    };

    const interactionEvents = ['scroll', 'click', 'mousemove', 'keydown'];
    interactionEvents.forEach((evt) => {
      window.addEventListener(evt, onUserInteraction, { passive: true });
    });

    // 4. Tab visibility changes
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && connectionKeyRef.current) {
        callPresenceApi('activity');
        lastActivityReportRef.current = Date.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // 5. Cleanup on unmount / navigation
    return () => {
      isSubscribed = false;
      clearInterval(heartbeatInterval);
      interactionEvents.forEach((evt) => {
        window.removeEventListener(evt, onUserInteraction);
      });
      document.removeEventListener('visibilitychange', onVisibilityChange);

      // Gracefully terminate this specific connection
      const activeKey = connectionKeyRef.current;
      if (activeKey) {
        try {
          const clientConnRef = ref(rtdb, `presence/${uid}/${activeKey}`);
          remove(clientConnRef).catch(() => {});
        } catch {
          // ignore
        }
        connectionKeyRef.current = null;
      }
    };
  }, [user]);

  return null;
}
