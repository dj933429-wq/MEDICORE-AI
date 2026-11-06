'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { rtdb } from '@/lib/firebase';
import { ref, onDisconnect, remove } from 'firebase/database';

const TAB_STORAGE_KEY = 'medicore_presence_tab';

export default function PresenceTracker() {
  const { user } = useAuth();
  const connectionKeyRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastActivityReportRef = useRef<number>(0);
  const isConnectingRef = useRef<boolean>(false);
  const inFlightKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user || !user.uid) {
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.removeItem(TAB_STORAGE_KEY);
        } catch {}
      }
      connectionKeyRef.current = null;
      sessionIdRef.current = null;
      inFlightKeyRef.current = null;
      return;
    }

    const uid = user.uid;
    let isSubscribed = true;

    // Check if this specific browser tab has a previous connection from page reload
    let previousConnectionKey: string | null = null;
    if (typeof window !== 'undefined') {
      try {
        const stored = sessionStorage.getItem(TAB_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed.connectionKey === 'string') {
            previousConnectionKey = parsed.connectionKey;
          }
        }
      } catch {}
    }

    // Helper: call backend presence session endpoint
    const callPresenceApi = async (
      action: 'connect' | 'reserve_connection' | 'activate_connection' | 'activity' | 'heartbeat' | 'logout',
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
            sessionId: sessionIdRef.current,
            role: (user as { role?: string })?.role || 'patient',
            ...extra,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          console.warn(`[PresenceTracker] API ${action} returned HTTP ${res.status}:`, errData);
          return null;
        }
        return await res.json();
      } catch (err) {
        console.warn(`[PresenceTracker] API ${action} network failure:`, err);
        return null;
      }
    };

    // 1. Establish trusted presence connection via 2-phase handshake:
    // Phase 1: Reserve connection key & session ID on server without creating presence node
    // Phase 2: Client registers onDisconnect(ref).remove() BEFORE node exists in RTDB
    // Phase 3: Client activates connection on server; server writes presence record & advances generation
    const initPresenceSession = async () => {
      if (isConnectingRef.current || connectionKeyRef.current) return;
      isConnectingRef.current = true;

      try {
        // Step 1: Reserve connection, passing previousConnectionKey to prune refreshed orphan
        const reserveResult = await callPresenceApi('reserve_connection', {
          previousConnectionKey,
        });
        if (!isSubscribed || !reserveResult?.connectionKey || !reserveResult?.sessionId) {
          return;
        }

        const connKey = reserveResult.connectionKey;
        const sessId = reserveResult.sessionId;
        inFlightKeyRef.current = connKey;

        // Step 2: Register onDisconnect hook BEFORE active presence node is created
        const clientConnRef = ref(rtdb, `presence/${uid}/${connKey}`);
        try {
          await onDisconnect(clientConnRef).remove();
        } catch (onDisconnectErr) {
          console.debug('[PresenceTracker] Failed to register onDisconnect hook:', onDisconnectErr);
          inFlightKeyRef.current = null;
          return;
        }

        if (!isSubscribed) {
          try {
            await onDisconnect(clientConnRef).cancel();
            remove(clientConnRef).catch(() => {});
          } catch {}
          inFlightKeyRef.current = null;
          return;
        }

        // Step 3: Activate presence connection on server
        const activateResult = await callPresenceApi('activate_connection', {
          connectionKey: connKey,
          sessionId: sessId,
        });

        const isActivated = Boolean(
          activateResult && (activateResult.activated === true || activateResult.success === true)
        );

        if (!isSubscribed || !isActivated) {
          console.warn('[PresenceTracker] Activation failed or unconfirmed:', activateResult);
          try {
            await onDisconnect(clientConnRef).cancel();
            remove(clientConnRef).catch(() => {});
          } catch {}
          inFlightKeyRef.current = null;
          return;
        }

        connectionKeyRef.current = connKey;
        sessionIdRef.current = sessId;
        inFlightKeyRef.current = null;
        lastActivityReportRef.current = Date.now();

        // Persist active tab connection in sessionStorage for refresh continuity
        if (typeof window !== 'undefined') {
          try {
            sessionStorage.setItem(
              TAB_STORAGE_KEY,
              JSON.stringify({ connectionKey: connKey, sessionId: sessId })
            );
          } catch {}
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

      // Gracefully terminate this specific connection node (active or in-flight)
      const keyToClean = connectionKeyRef.current || inFlightKeyRef.current;
      if (keyToClean) {
        try {
          const clientConnRef = ref(rtdb, `presence/${uid}/${keyToClean}`);
          remove(clientConnRef).catch(() => {});
        } catch {}
        connectionKeyRef.current = null;
        inFlightKeyRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  return null;
}
