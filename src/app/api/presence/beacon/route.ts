import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(req: Request) {
  try {
    const text = await req.text();
    let data: Record<string, unknown> = {};

    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const {
      uid,
      isOnline,
      sessionEndedAt,
      sessionStartedAt,
      durationSec,
      interactionType,
    } = data as {
      uid?: string;
      isOnline?: boolean;
      sessionEndedAt?: string;
      sessionStartedAt?: string;
      durationSec?: number;
      interactionType?: string;
    };

    if (!uid || typeof uid !== 'string') {
      return NextResponse.json({ error: 'UID is required' }, { status: 400 });
    }

    const now = sessionEndedAt || new Date().toISOString();
    const parsedDuration = typeof durationSec === 'number' && durationSec > 0 ? Math.floor(durationSec) : 0;

    const userRef = adminDb.collection('users').doc(uid);
    const updatePayload: Record<string, unknown> = {
      isOnline: Boolean(isOnline),
      lastSeenAt: now,
      updatedAt: now,
    };

    if (sessionStartedAt) {
      updatePayload.sessionStartedAt = sessionStartedAt;
    }

    if (interactionType) {
      updatePayload.lastInteractionType = interactionType;
    }

    if (parsedDuration > 0) {
      updatePayload.lastSessionDurationSec = parsedDuration;
      updatePayload.totalTimeSpentSec = FieldValue.increment(parsedDuration);
      updatePayload.lastSessionEndedAt = now;
    }

    try {
      await userRef.set(updatePayload, { merge: true });
    } catch (dbErr: unknown) {
      console.warn('[PresenceBeaconAPI] Firestore write bypassed (Quota/Offline):', dbErr);
    }

    return NextResponse.json({ success: true, timestamp: now });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[PresenceBeaconAPI] Failed to update presence beacon:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
