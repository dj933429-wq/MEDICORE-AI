'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { doc, setDoc } from 'firebase/firestore';

export default function PresenceTracker() {
  const { user } = useAuth();
  const sessionStartRef = useRef<number | null>(null);
  const sessionStartedAtIsoRef = useRef<string | null>(null);
  const lastPingRef = useRef<number>(0);
  const isOnlineRef = useRef<boolean>(true);

  useEffect(() => {
    if (!user || !user.uid) return;

    const uid = user.uid;
    const nowIso = new Date().toISOString();
    sessionStartRef.current = Date.now();
    sessionStartedAtIsoRef.current = nowIso;
    isOnlineRef.current = true;

    // Helper: direct Firestore update for fast client reflection
    const updatePresenceFirestore = async (payload: Record<string, unknown>) => {
      try {
        const userRef = doc(db, 'users', uid);
        await setDoc(userRef, payload, { merge: true });
      } catch (err) {
        // Suppress non-critical heartbeat errors
        console.debug('[PresenceTracker] Heartbeat firestore sync:', err);
      }
    };

    // Helper: beacon update on unload/exit
    const sendExitBeacon = (interaction: string) => {
      const startEpoch = sessionStartRef.current ?? Date.now();
      const durationSec = Math.max(1, Math.floor((Date.now() - startEpoch) / 1000));
      const exitIso = new Date().toISOString();
      const payload = JSON.stringify({
        uid,
        isOnline: false,
        sessionEndedAt: exitIso,
        sessionStartedAt: sessionStartedAtIsoRef.current || exitIso,
        durationSec,
        interactionType: interaction,
      });

      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/presence/beacon', blob);
      }

      // Also fire async Firestore update
      updatePresenceFirestore({
        isOnline: false,
        lastSeenAt: exitIso,
        lastSessionEndedAt: exitIso,
        lastSessionDurationSec: durationSec,
      });
    };

    // 1. Initial connect: Mark Online
    updatePresenceFirestore({
      isOnline: true,
      lastSeenAt: nowIso,
      sessionStartedAt: sessionStartedAtIsoRef.current,
      activeRole: user.role || 'patient',
      lastInteractionType: 'session_start',
    });

    // 2. Periodic heartbeat ping (every 45 seconds while visible to preserve Firestore quota)
    const heartbeatInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        const currentIso = new Date().toISOString();
        isOnlineRef.current = true;
        updatePresenceFirestore({
          isOnline: true,
          lastSeenAt: currentIso,
          lastInteractionType: 'heartbeat',
        });
      }
    }, 45000);

    // 3. User interaction throttled listener (scroll, click, mousemove, keypress)
    const handleUserActivity = (eventType: string) => {
      const now = Date.now();
      // Throttle interaction updates to at most once every 30 seconds to preserve quota
      if (now - lastPingRef.current < 30000) return;
      lastPingRef.current = now;

      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        const currentIso = new Date().toISOString();
        isOnlineRef.current = true;
        updatePresenceFirestore({
          isOnline: true,
          lastSeenAt: currentIso,
          lastInteractionType: eventType,
        });
      }
    };

    const onScroll = () => handleUserActivity('scroll');
    const onClick = () => handleUserActivity('click');
    const onKeydown = () => handleUserActivity('keydown');
    const onMouseMove = () => handleUserActivity('mousemove');

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('click', onClick, { passive: true });
    window.addEventListener('keydown', onKeydown, { passive: true });
    window.addEventListener('mousemove', onMouseMove, { passive: true });

    // 4. Tab visibility change (switching tabs or minimizing window)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        isOnlineRef.current = false;
        sendExitBeacon('tab_hidden');
      } else if (document.visibilityState === 'visible') {
        // User came back to the tab -> Start new session window
        sessionStartRef.current = Date.now();
        sessionStartedAtIsoRef.current = new Date().toISOString();
        isOnlineRef.current = true;
        updatePresenceFirestore({
          isOnline: true,
          lastSeenAt: sessionStartedAtIsoRef.current,
          sessionStartedAt: sessionStartedAtIsoRef.current,
          lastInteractionType: 'tab_focus',
        });
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    // 5. Page exit / tab close / browser close
    const onBeforeUnload = () => {
      sendExitBeacon('page_exit');
    };

    window.addEventListener('beforeunload', onBeforeUnload);

    // Cleanup when component unmounts or user changes
    return () => {
      clearInterval(heartbeatInterval);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);

      // If user logs out or session tears down
      sendExitBeacon('session_unmount');
    };
  }, [user]);

  return null;
}
