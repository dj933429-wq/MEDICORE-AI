import { db } from '../firebase.js';
import {
  collection,
  doc,
  getDocs,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  runTransaction,
  serverTimestamp,
  QueryDocumentSnapshot,
  DocumentData,
  FieldValue,
  Firestore,
} from 'firebase/firestore';
import { PeriodRecord, DailyLog, Symptom, Mood, FlowLevel, SleepQuality } from './types';
import { isValidISODateString } from './calculations';

function resolveFirestoreInstance(instance?: Firestore | unknown): Firestore {
  if (instance && typeof instance === 'object' && '_delegate' in instance) {
    return (instance as { _delegate: Firestore })._delegate;
  }
  return (instance as Firestore) || db;
}

export interface FirestorePeriodData {
  startDate: string;
  endDate?: string | null;
  flow: 'light' | 'medium' | 'heavy';
  source: 'user';
  notes?: string;
  createdAt: FieldValue | unknown;
  updatedAt: FieldValue | unknown;
}

export interface FirestoreDailyLogData {
  date: string;
  flow: FlowLevel;
  symptoms: Symptom[];
  mood?: Mood;
  energy?: 1 | 2 | 3 | 4 | 5;
  sleepHours?: number;
  sleepQuality?: SleepQuality;
  notes?: string;
  source: 'user';
  createdAt: FieldValue | unknown;
  updatedAt: FieldValue | unknown;
}

// ============================================================================
// Helper & Serialization / Deserialization Functions
// ============================================================================

export function buildPeriodDocId(startDate: string): string {
  return `period_${startDate}`;
}

export function buildDailyLogDocId(date: string): string {
  return `log_${date}`;
}

/**
 * Validates domain integrity for period records before issuing Firestore operations.
 */
export function validatePeriodInput(input: {
  startDate: string;
  endDate?: string | null;
  flow: 'light' | 'medium' | 'heavy';
  notes?: string;
}): { isValid: boolean; error?: string } {
  if (!input.startDate || !isValidISODateString(input.startDate)) {
    return { isValid: false, error: `Invalid start date format: ${input.startDate}. Expected YYYY-MM-DD.` };
  }
  if (input.endDate !== undefined && input.endDate !== null && input.endDate !== '') {
    if (!isValidISODateString(input.endDate)) {
      return { isValid: false, error: `Invalid end date format: ${input.endDate}. Expected YYYY-MM-DD.` };
    }
    if (input.endDate < input.startDate) {
      return { isValid: false, error: `End date (${input.endDate}) cannot be earlier than start date (${input.startDate}).` };
    }
  }
  if (!['light', 'medium', 'heavy'].includes(input.flow)) {
    return { isValid: false, error: `Invalid flow intensity: ${input.flow}. Must be light, medium, or heavy.` };
  }
  if (input.notes !== undefined && typeof input.notes === 'string' && input.notes.length > 1000) {
    return { isValid: false, error: 'Period notes exceed maximum permitted length of 1000 characters.' };
  }
  return { isValid: true };
}

/**
 * Validates domain integrity for daily log entries before issuing Firestore operations.
 */
export function validateDailyLogInput(input: Omit<DailyLog, 'id' | 'source'> & { source?: 'user' | 'demo' }): { isValid: boolean; error?: string } {
  if (!input.date || !isValidISODateString(input.date)) {
    return { isValid: false, error: `Invalid log date format: ${input.date}. Expected YYYY-MM-DD.` };
  }
  const allowedFlows: FlowLevel[] = ['none', 'spotting', 'light', 'medium', 'heavy'];
  if (!allowedFlows.includes(input.flow)) {
    return { isValid: false, error: `Invalid flow level: ${input.flow}.` };
  }
  const allowedSymptoms: Symptom[] = [
    'cramps',
    'headache',
    'bloating',
    'acne',
    'breast_tenderness',
    'back_pain',
    'fatigue',
    'nausea',
    'other',
  ];
  if (!Array.isArray(input.symptoms)) {
    return { isValid: false, error: 'Symptoms must be provided as an array.' };
  }
  for (const s of input.symptoms) {
    if (!allowedSymptoms.includes(s)) {
      return { isValid: false, error: `Invalid symptom value: ${s}.` };
    }
  }
  if (input.symptoms.length > 9) {
    return { isValid: false, error: 'Symptoms array exceeds maximum limit of 9 distinct entries.' };
  }
  if (input.mood !== undefined && input.mood !== null) {
    const allowedMoods: Mood[] = ['happy', 'calm', 'anxious', 'irritable', 'sad'];
    if (!allowedMoods.includes(input.mood)) {
      return { isValid: false, error: `Invalid mood value: ${input.mood}.` };
    }
  }
  if (input.energy !== undefined && input.energy !== null) {
    if (!Number.isInteger(input.energy) || input.energy < 1 || input.energy > 5) {
      return { isValid: false, error: `Energy rating must be an integer between 1 and 5. Received: ${input.energy}.` };
    }
  }
  if (input.sleepHours !== undefined && input.sleepHours !== null) {
    if (typeof input.sleepHours !== 'number' || isNaN(input.sleepHours) || input.sleepHours < 0 || input.sleepHours > 24) {
      return { isValid: false, error: `Sleep hours must be a number between 0 and 24. Received: ${input.sleepHours}.` };
    }
  }
  if (input.sleepQuality !== undefined && input.sleepQuality !== null) {
    const allowedQualities: SleepQuality[] = ['restful', 'disrupted', 'insomnia'];
    if (!allowedQualities.includes(input.sleepQuality)) {
      return { isValid: false, error: `Invalid sleep quality: ${input.sleepQuality}.` };
    }
  }
  if (input.notes !== undefined && typeof input.notes === 'string' && input.notes.length > 2000) {
    return { isValid: false, error: 'Daily log notes exceed maximum permitted length of 2000 characters.' };
  }
  return { isValid: true };
}

/**
 * Serializes a domain period input into a clean Firestore document payload.
 * Excludes derived attributes (id, cycleLength, durationDays, isOngoing).
 * Omits undefined fields cleanly.
 */
export function serializePeriodRecord(input: {
  startDate: string;
  endDate?: string | null;
  flow: 'light' | 'medium' | 'heavy';
  notes?: string;
  source?: 'user';
  createdAtTimestamp?: FieldValue;
  updatedAtTimestamp?: FieldValue;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    startDate: input.startDate,
    flow: input.flow,
    source: 'user',
    createdAt: input.createdAtTimestamp || serverTimestamp(),
    updatedAt: input.updatedAtTimestamp || serverTimestamp(),
  };

  if (input.endDate !== undefined && input.endDate !== null && input.endDate !== '') {
    payload.endDate = input.endDate;
  } else {
    payload.endDate = null;
  }

  if (input.notes !== undefined && input.notes !== null && input.notes.trim() !== '') {
    payload.notes = input.notes.trim();
  }

  return payload;
}

/**
 * Deserializes a Firestore document snapshot into a domain PeriodRecord.
 * Maps deterministic document ID to record.id.
 */
export function deserializePeriodRecord(docId: string, data: DocumentData): PeriodRecord {
  return {
    id: docId,
    startDate: data.startDate,
    endDate: data.endDate || undefined,
    flow: data.flow,
    source: 'user',
    notes: data.notes || undefined,
  };
}

/**
 * Serializes a domain DailyLog input into a clean Firestore document payload.
 * Omits undefined values, keeps valid decimals for sleepHours, omits demo records.
 */
export function serializeDailyLog(input: Omit<DailyLog, 'id' | 'source'> & {
  source?: 'user';
  createdAtTimestamp?: FieldValue;
  updatedAtTimestamp?: FieldValue;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    date: input.date,
    flow: input.flow,
    symptoms: Array.from(new Set(input.symptoms || [])),
    source: 'user',
    createdAt: input.createdAtTimestamp || serverTimestamp(),
    updatedAt: input.updatedAtTimestamp || serverTimestamp(),
  };

  if (input.mood !== undefined && input.mood !== null) {
    payload.mood = input.mood;
  }
  if (input.energy !== undefined && input.energy !== null) {
    payload.energy = input.energy;
  }
  if (input.sleepHours !== undefined && input.sleepHours !== null) {
    payload.sleepHours = Number(input.sleepHours);
  }
  if (input.sleepQuality !== undefined && input.sleepQuality !== null) {
    payload.sleepQuality = input.sleepQuality;
  }
  if (input.notes !== undefined && input.notes !== null && input.notes.trim() !== '') {
    payload.notes = input.notes.trim();
  }

  return payload;
}

/**
 * Deserializes a Firestore document snapshot into a domain DailyLog.
 */
export function deserializeDailyLog(docId: string, data: DocumentData): DailyLog {
  const log: DailyLog = {
    id: docId,
    date: data.date,
    flow: data.flow,
    symptoms: Array.isArray(data.symptoms) ? data.symptoms : [],
    source: 'user',
  };

  if (data.mood) log.mood = data.mood;
  if (data.energy !== undefined && data.energy !== null) log.energy = data.energy;
  if (data.sleepHours !== undefined && data.sleepHours !== null) log.sleepHours = Number(data.sleepHours);
  if (data.sleepQuality) log.sleepQuality = data.sleepQuality;
  if (data.notes) log.notes = data.notes;

  return log;
}

// ============================================================================
// Service Operations: Period Records
// ============================================================================

/**
 * Safe Period Creation:
 * Uses a Firestore transaction to read the deterministic destination document.
 * If present, aborts immediately without overwriting.
 * Sets createdAt and updatedAt using serverTimestamp().
 */
export async function createPeriodRecordSafe(
  userId: string,
  input: {
    startDate: string;
    endDate?: string | null;
    flow: 'light' | 'medium' | 'heavy';
    notes?: string;
    source?: 'user' | 'demo';
  },
  firestoreInstance?: Firestore
): Promise<{ success: boolean; id: string; error?: string }> {
  if (input.source === 'demo') {
    return { success: false, id: '', error: 'Demo records cannot be persisted to Firestore.' };
  }

  const validation = validatePeriodInput(input);
  if (!validation.isValid) {
    return { success: false, id: '', error: validation.error };
  }

  const firestore = resolveFirestoreInstance(firestoreInstance);
  const docId = buildPeriodDocId(input.startDate);
  const docRef = doc(firestore, 'users', userId, 'menstrualRecords', docId);

  try {
    await runTransaction(firestore, async (transaction) => {
      // 1. Transaction Read: Destination check
      const docSnap = await transaction.get(docRef);
      if (docSnap.exists()) {
        const err = new Error(`A period record already exists with start date ${input.startDate}.`);
        err.name = 'E_DUPLICATE_PERIOD';
        throw err;
      }

      // 2. Transaction Write: Safe insert
      const payload = serializePeriodRecord({
        startDate: input.startDate,
        endDate: input.endDate,
        flow: input.flow,
        notes: input.notes,
      });

      transaction.set(docRef, payload);
    });

    return { success: true, id: docId };
  } catch (err: unknown) {
    const error = err as Error;
    return { success: false, id: '', error: error.message || 'Failed to create period record.' };
  }
}

/**
 * Retrieves all period records for an authenticated patient, sorted chronologically descending.
 */
export async function getPeriodRecords(userId: string, firestoreInstance?: Firestore): Promise<PeriodRecord[]> {
  const firestore = resolveFirestoreInstance(firestoreInstance);
  const periodsCollection = collection(firestore, 'users', userId, 'menstrualRecords');
  const q = query(periodsCollection, orderBy('startDate', 'desc'));
  const snapshot = await getDocs(q);

  const records: PeriodRecord[] = [];
  snapshot.forEach((d) => {
    records.push(deserializePeriodRecord(d.id, d.data()));
  });

  return records;
}

/**
 * Safe Period Update:
 * - If startDate is unchanged: reads doc to verify existence, updates fields, preserves createdAt, advances updatedAt.
 * - If startDate is modified: reads destination doc (aborts if occupied), reads source doc (aborts if missing),
 *   atomically deletes old doc and creates new doc with re-anchored createdAt and fresh updatedAt.
 */
export async function updatePeriodRecordSafe(
  userId: string,
  oldStartDate: string,
  updates: {
    startDate: string;
    endDate?: string | null;
    flow: 'light' | 'medium' | 'heavy';
    notes?: string;
  },
  firestoreInstance?: Firestore
): Promise<{ success: boolean; id: string; error?: string }> {
  const validation = validatePeriodInput(updates);
  if (!validation.isValid) {
    return { success: false, id: '', error: validation.error };
  }

  const firestore = resolveFirestoreInstance(firestoreInstance);
  const oldDocId = buildPeriodDocId(oldStartDate);
  const newDocId = buildPeriodDocId(updates.startDate);
  const oldDocRef = doc(firestore, 'users', userId, 'menstrualRecords', oldDocId);
  const newDocRef = doc(firestore, 'users', userId, 'menstrualRecords', newDocId);

  try {
    // Case A: Same-date edit (in-place update)
    if (oldStartDate === updates.startDate) {
      await runTransaction(firestore, async (transaction) => {
        const sourceSnap = await transaction.get(oldDocRef);
        if (!sourceSnap.exists()) {
          const err = new Error(`Period record for start date ${oldStartDate} does not exist.`);
          err.name = 'E_NOT_FOUND';
          throw err;
        }

        const updatePayload: Record<string, unknown> = {
          endDate: updates.endDate !== undefined && updates.endDate !== null && updates.endDate !== '' ? updates.endDate : null,
          flow: updates.flow,
          updatedAt: serverTimestamp(),
        };

        if (updates.notes !== undefined) {
          updatePayload.notes = updates.notes ? updates.notes.trim() : '';
        }

        transaction.update(oldDocRef, updatePayload);
      });

      return { success: true, id: oldDocId };
    }

    // Case B: Start date changed (atomic migration)
    await runTransaction(firestore, async (transaction) => {
      // 1. ALL READS FIRST: Read destination, then read source
      const destSnap = await transaction.get(newDocRef);
      if (destSnap.exists()) {
        const err = new Error(`Destination start date ${updates.startDate} is already occupied by an existing period record.`);
        err.name = 'E_DESTINATION_OCCUPIED';
        throw err;
      }

      const sourceSnap = await transaction.get(oldDocRef);
      if (!sourceSnap.exists()) {
        const err = new Error(`Original period record for start date ${oldStartDate} not found.`);
        err.name = 'E_SOURCE_NOT_FOUND';
        throw err;
      }

      // 2. ALL WRITES AFTER READS: Atomic deletion of old doc + insertion of new doc
      transaction.delete(oldDocRef);

      const newPayload = serializePeriodRecord({
        startDate: updates.startDate,
        endDate: updates.endDate,
        flow: updates.flow,
        notes: updates.notes,
      });

      transaction.set(newDocRef, newPayload);
    });

    return { success: true, id: newDocId };
  } catch (err: unknown) {
    const error = err as Error;
    return { success: false, id: '', error: error.message || 'Failed to update period record.' };
  }
}

/**
 * Deletes a period record using its deterministic document ID.
 */
export async function deletePeriodRecord(userId: string, startDate: string, firestoreInstance?: Firestore): Promise<{ success: boolean; error?: string }> {
  try {
    const firestore = resolveFirestoreInstance(firestoreInstance);
    const docId = buildPeriodDocId(startDate);
    const docRef = doc(firestore, 'users', userId, 'menstrualRecords', docId);
    await deleteDoc(docRef);
    return { success: true };
  } catch (err: unknown) {
    const error = err as Error;
    return { success: false, error: error.message || 'Failed to delete period record.' };
  }
}

// ============================================================================
// Service Operations: Daily Logs
// ============================================================================

/**
 * Creates or updates a daily log inside a transaction to guarantee exactly one log per calendar day.
 * - If document is absent: creates new document with server timestamps.
 * - If document is present: merges domain updates, preserves createdAt, advances updatedAt.
 */
export async function createOrUpdateDailyLog(
  userId: string,
  logData: Omit<DailyLog, 'id' | 'source'> & { source?: 'user' | 'demo' },
  firestoreInstance?: Firestore
): Promise<{ success: boolean; id: string; error?: string }> {
  if (logData.source === 'demo') {
    return { success: false, id: '', error: 'Demo logs cannot be persisted to Firestore.' };
  }

  const validation = validateDailyLogInput(logData);
  if (!validation.isValid) {
    return { success: false, id: '', error: validation.error };
  }

  const firestore = resolveFirestoreInstance(firestoreInstance);
  const docId = buildDailyLogDocId(logData.date);
  const docRef = doc(firestore, 'users', userId, 'menstrualLogs', docId);

  try {
    await runTransaction(firestore, async (transaction) => {
      const snap = await transaction.get(docRef);

      if (!snap.exists()) {
        // Document absent: Create fresh log
        const payload = serializeDailyLog({
          ...logData,
          source: 'user',
        });
        transaction.set(docRef, payload);
      } else {
        // Document present: Update fields, preserve createdAt
        const existingData = snap.data();
        const mergedSymptoms = logData.symptoms !== undefined ? logData.symptoms : (existingData.symptoms || []);
        
        const updatePayload: Record<string, unknown> = {
          date: logData.date,
          flow: logData.flow,
          symptoms: Array.from(new Set(mergedSymptoms)),
          source: 'user',
          updatedAt: serverTimestamp(),
        };

        if (logData.mood !== undefined) updatePayload.mood = logData.mood;
        if (logData.energy !== undefined) updatePayload.energy = logData.energy;
        if (logData.sleepHours !== undefined) updatePayload.sleepHours = Number(logData.sleepHours);
        if (logData.sleepQuality !== undefined) updatePayload.sleepQuality = logData.sleepQuality;
        if (logData.notes !== undefined) updatePayload.notes = logData.notes.trim();

        transaction.set(docRef, updatePayload, { merge: true });
      }
    });

    return { success: true, id: docId };
  } catch (err: unknown) {
    const error = err as Error;
    return { success: false, id: '', error: error.message || 'Failed to save daily log.' };
  }
}

/**
 * Retrieves daily logs bounded between two inclusive ISO date strings (endDateISO >= date >= startDateISO).
 */
export async function getDailyLogs(
  userId: string,
  startDateISO: string,
  endDateISO: string,
  maxLimit: number = 366,
  firestoreInstance?: Firestore
): Promise<DailyLog[]> {
  const firestore = resolveFirestoreInstance(firestoreInstance);
  const logsCollection = collection(firestore, 'users', userId, 'menstrualLogs');
  const q = query(
    logsCollection,
    where('date', '>=', startDateISO),
    where('date', '<=', endDateISO),
    orderBy('date', 'desc'),
    limit(maxLimit)
  );

  const snapshot = await getDocs(q);
  const logs: DailyLog[] = [];
  snapshot.forEach((d) => {
    logs.push(deserializeDailyLog(d.id, d.data()));
  });

  return logs;
}

/**
 * Cursor-based pagination for historical daily logs.
 */
export async function getPaginatedDailyLogs(
  userId: string,
  pageSize: number = 50,
  lastSnapshot?: QueryDocumentSnapshot,
  firestoreInstance?: Firestore
): Promise<{ logs: DailyLog[]; lastVisibleSnapshot?: QueryDocumentSnapshot; hasMore: boolean }> {
  const firestore = resolveFirestoreInstance(firestoreInstance);
  const logsCollection = collection(firestore, 'users', userId, 'menstrualLogs');
  let q;
  if (lastSnapshot) {
    q = query(logsCollection, orderBy('date', 'desc'), startAfter(lastSnapshot), limit(pageSize));
  } else {
    q = query(logsCollection, orderBy('date', 'desc'), limit(pageSize));
  }

  const snapshot = await getDocs(q);
  const logs: DailyLog[] = [];
  snapshot.forEach((d) => {
    logs.push(deserializeDailyLog(d.id, d.data()));
  });

  const lastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : undefined;
  const hasMore = snapshot.docs.length === pageSize;

  return { logs, lastVisibleSnapshot: lastDoc, hasMore };
}

/**
 * Deletes a daily log record using its date.
 */
export async function deleteDailyLog(userId: string, date: string, firestoreInstance?: Firestore): Promise<{ success: boolean; error?: string }> {
  try {
    const firestore = resolveFirestoreInstance(firestoreInstance);
    const docId = buildDailyLogDocId(date);
    const docRef = doc(firestore, 'users', userId, 'menstrualLogs', docId);
    await deleteDoc(docRef);
    return { success: true };
  } catch (err: unknown) {
    const error = err as Error;
    return { success: false, error: error.message || 'Failed to delete daily log.' };
  }
}

/**
 * Non-truncating multi-page accumulator for complete CSV exports.
 */
export async function fetchAllLogsForExport(userId: string, firestoreInstance?: Firestore): Promise<DailyLog[]> {
  const allLogs: DailyLog[] = [];
  let lastSnap: QueryDocumentSnapshot | undefined = undefined;
  let hasMore = true;
  const PAGE_SIZE = 100;

  while (hasMore) {
    const result = await getPaginatedDailyLogs(userId, PAGE_SIZE, lastSnap, firestoreInstance);
    if (result.logs.length === 0) {
      break;
    }
    allLogs.push(...result.logs);
    hasMore = result.hasMore;
    lastSnap = result.lastVisibleSnapshot;
  }

  return allLogs;
}

