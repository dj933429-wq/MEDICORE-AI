'use client';

import React, { createContext, useContext, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { PeriodRecord, DailyLog, CycleStats, TrackerMode } from './types';
import { generateDemoDataset } from './demoData';
import { calculateCycleStats, processPeriodRecords, validatePeriodRecord, formatDateISO } from './calculations';
import { useAuth } from '../auth';
import {
  createPeriodRecordSafe,
  getPeriodRecords,
  updatePeriodRecordSafe,
  deletePeriodRecord,
  createOrUpdateDailyLog,
  getDailyLogs,
  getPaginatedDailyLogs,
  deleteDailyLog,
  fetchAllLogsForExport,
} from './firestore-service';
import { QueryDocumentSnapshot } from 'firebase/firestore';

interface MenstrualHealthContextType {
  mode: TrackerMode;
  setMode: (m: TrackerMode) => void;
  toggleMode: () => void;
  periods: PeriodRecord[];
  logs: DailyLog[];
  stats: CycleStats;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  addPeriod: (period: { startDate: string; endDate?: string; flow: 'light' | 'medium' | 'heavy'; notes?: string }) => Promise<{ success: boolean; error?: string }> | { success: boolean; error?: string };
  updatePeriod: (id: string, updates: Partial<PeriodRecord>) => Promise<{ success: boolean; error?: string }> | { success: boolean; error?: string };
  deletePeriod: (id: string) => Promise<{ success: boolean; error?: string }> | void;
  saveDailyLog: (logData: Omit<DailyLog, 'id' | 'source'>) => Promise<{ success: boolean; message: string }> | { success: boolean; message: string };
  deleteLog: (date: string) => Promise<{ success: boolean; error?: string }>;
  getLogForDate: (date: string) => DailyLog | undefined;
  loadMoreLogs: () => Promise<boolean>;
  hasMoreLogs: boolean;
  exportAllLogs: () => Promise<DailyLog[]>;
  resetToDemo: () => void;
  clearAll: () => void;
  feedbackMessage: string | null;
  clearFeedback: () => void;
  isLoadingData: boolean;
  persistenceError: string | null;
}

const MenstrualHealthContext = createContext<MenstrualHealthContextType | undefined>(undefined);

export function MenstrualHealthProvider({ children }: { children: React.ReactNode }) {
  // Use existing auth provider context
  const authContext = useAuth() as { user: { uid: string; role?: string } | null; loading: boolean } | null;
  const user = authContext?.user || null;
  const authLoading = authContext?.loading ?? false;

  const [mode, setModeState] = useState<TrackerMode>('demo');
  const [selectedDate, setSelectedDate] = useState<string>(() => formatDateISO(new Date()));
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(false);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);

  // Pagination cursor for daily logs
  const [lastLogSnapshot, setLastLogSnapshot] = useState<QueryDocumentSnapshot | undefined>(undefined);
  const [hasMoreLogs, setHasMoreLogs] = useState<boolean>(false);

  // Initial demo data
  const initialDemo = useMemo(() => generateDemoDataset(), []);

  // In-memory data states
  const [periods, setPeriods] = useState<PeriodRecord[]>(initialDemo.periods);
  const [logs, setLogs] = useState<DailyLog[]>(initialDemo.logs);

  const clearFeedback = useCallback(() => {
    setFeedbackMessage(null);
  }, []);

  const showFeedback = useCallback((msg: string) => {
    setFeedbackMessage(msg);
    setTimeout(() => {
      setFeedbackMessage((current) => (current === msg ? null : current));
    }, 4000);
  }, []);

  // Track the last loaded UID to prevent duplicate loads
  const loadedUidRef = useRef<string | null>(null);

  // Fetch patient data from Firestore when authenticated in empty/live mode
  useEffect(() => {
    if (authLoading) return;

    if (!user || !user.uid) {
      // User logged out: if not in demo mode, reset to empty asynchronously
      loadedUidRef.current = null;
      if (mode === 'empty') {
        const timer = setTimeout(() => {
          setPeriods([]);
          setLogs([]);
        }, 0);
        return () => clearTimeout(timer);
      }
      return;
    }

    // Authenticated patient detected
    if (mode === 'empty' && loadedUidRef.current !== user.uid) {
      let isSubscribed = true;

      const today = new Date();
      const todayISO = formatDateISO(today);
      const oneYearAgo = new Date(today);
      oneYearAgo.setDate(oneYearAgo.getDate() - 365);
      const oneYearAgoISO = formatDateISO(oneYearAgo);

      // Defer loading state trigger
      const startTimer = setTimeout(() => {
        if (isSubscribed) {
          setIsLoadingData(true);
          setPersistenceError(null);
        }
      }, 0);

      Promise.all([
        getPeriodRecords(user.uid),
        getDailyLogs(user.uid, oneYearAgoISO, todayISO, 366),
      ])
        .then(([patientPeriods, patientLogs]) => {
          if (!isSubscribed) return;
          loadedUidRef.current = user.uid;
          setPeriods(patientPeriods);
          setLogs(patientLogs);
          setPersistenceError(null);
        })
        .catch((err: unknown) => {
          if (!isSubscribed) return;
          const error = err as Error;
          console.error('Failed to load patient menstrual data from Firestore:', error);
          setPersistenceError(error.message || 'Failed to load records from cloud storage.');
        })
        .finally(() => {
          if (isSubscribed) {
            setIsLoadingData(false);
          }
        });

      return () => {
        isSubscribed = false;
        clearTimeout(startTimer);
      };
    }
  }, [user, authLoading, mode]);

  const setMode = useCallback((newMode: TrackerMode) => {
    setModeState(newMode);
    if (newMode === 'demo') {
      const freshDemo = generateDemoDataset();
      setPeriods(freshDemo.periods);
      setLogs(freshDemo.logs);
      showFeedback('Switched to Demo Preview Mode (8 sample cycles active).');
    } else {
      setPeriods([]);
      setLogs([]);
      loadedUidRef.current = null; // force reload for live patient
      showFeedback('Switched to Live Mode (cloud records enabled for authenticated patient).');
    }
  }, [showFeedback]);

  const toggleMode = useCallback(() => {
    setMode(mode === 'demo' ? 'empty' : 'demo');
  }, [mode, setMode]);

  const resetToDemo = useCallback(() => {
    const freshDemo = generateDemoDataset();
    setPeriods(freshDemo.periods);
    setLogs(freshDemo.logs);
    setModeState('demo');
    showFeedback('Demo data reset to default 8-cycle sample.');
  }, [showFeedback]);

  const clearAll = useCallback(() => {
    setPeriods([]);
    setLogs([]);
    setModeState('empty');
    showFeedback('All records cleared in current session.');
  }, [showFeedback]);

  // Derived processed periods and stats computed using the pure calculation engine
  const processedPeriods = useMemo(() => processPeriodRecords(periods), [periods]);
  const stats = useMemo(() => calculateCycleStats(periods), [periods]);

  // ==========================================================================
  // Context Actions: Period Records
  // ==========================================================================

  const addPeriod = useCallback(
    async (input: { startDate: string; endDate?: string; flow: 'light' | 'medium' | 'heavy'; notes?: string }) => {
      // 1. Gregorian & Domain Validation
      const validation = validatePeriodRecord(input.startDate, input.endDate, periods);
      if (!validation.isValid) {
        return { success: false, error: validation.errors[0] || 'Invalid period record.' };
      }

      // Demo Mode: In-memory only
      if (mode === 'demo' || !user?.uid) {
        const newRecord: PeriodRecord = {
          id: `period-${Date.now()}`,
          startDate: input.startDate,
          endDate: input.endDate,
          flow: input.flow,
          durationDays: input.endDate ? undefined : 1,
          source: mode === 'demo' ? 'demo' : 'user',
          notes: input.notes,
        };
        setPeriods((prev) => [...prev, newRecord]);
        showFeedback(
          mode === 'demo'
            ? 'Period entry saved in this session (temporary demo state).'
            : 'Period entry saved locally (sign in as patient to persist).'
        );
        return { success: true };
      }

      // Live Mode: Firestore Persistence
      try {
        const res = await createPeriodRecordSafe(user.uid, {
          startDate: input.startDate,
          endDate: input.endDate,
          flow: input.flow,
          notes: input.notes,
          source: 'user',
        });

        if (!res.success) {
          return { success: false, error: res.error || 'Failed to save period record to Firestore.' };
        }

        const newRecord: PeriodRecord = {
          id: res.id,
          startDate: input.startDate,
          endDate: input.endDate,
          flow: input.flow,
          source: 'user',
          notes: input.notes,
        };

        setPeriods((prev) => [...prev, newRecord]);
        showFeedback('Period entry securely saved to cloud storage.');
        return { success: true };
      } catch (err: unknown) {
        const error = err as Error;
        return { success: false, error: error.message || 'Network error saving period record.' };
      }
    },
    [periods, mode, user, showFeedback]
  );

  const updatePeriod = useCallback(
    async (id: string, updates: Partial<PeriodRecord>) => {
      const existing = periods.find((p) => p.id === id);
      if (!existing) return { success: false, error: 'Record not found.' };

      const startDate = updates.startDate ?? existing.startDate;
      const endDate = updates.endDate ?? existing.endDate;

      const validation = validatePeriodRecord(startDate, endDate, periods, id);
      if (!validation.isValid) {
        return { success: false, error: validation.errors[0] || 'Invalid period record.' };
      }

      // Demo Mode: In-memory only
      if (mode === 'demo' || !user?.uid) {
        setPeriods((prev) =>
          prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
        );
        showFeedback('Period updated in this session.');
        return { success: true };
      }

      // Live Mode: Firestore Persistence
      try {
        const res = await updatePeriodRecordSafe(user.uid, existing.startDate, {
          startDate,
          endDate,
          flow: updates.flow || existing.flow,
          notes: updates.notes !== undefined ? updates.notes : existing.notes,
        });

        if (!res.success) {
          return { success: false, error: res.error || 'Failed to update period record.' };
        }

        setPeriods((prev) =>
          prev.map((p) =>
            p.id === id
              ? {
                  ...p,
                  ...updates,
                  id: res.id,
                  startDate,
                  endDate,
                }
              : p
          )
        );
        showFeedback('Period record updated in cloud storage.');
        return { success: true };
      } catch (err: unknown) {
        const error = err as Error;
        return { success: false, error: error.message || 'Network error updating period record.' };
      }
    },
    [periods, mode, user, showFeedback]
  );

  const deletePeriod = useCallback(
    async (id: string) => {
      const existing = periods.find((p) => p.id === id);

      // Demo Mode: In-memory only
      if (mode === 'demo' || !user?.uid) {
        setPeriods((prev) => prev.filter((p) => p.id !== id));
        showFeedback('Period entry deleted.');
        return { success: true };
      }

      // Live Mode: Firestore Persistence
      if (existing) {
        try {
          const res = await deletePeriodRecord(user.uid, existing.startDate);
          if (!res.success) {
            showFeedback(`Error: ${res.error || 'Failed to delete record.'}`);
            return { success: false, error: res.error };
          }
          setPeriods((prev) => prev.filter((p) => p.id !== id));
          showFeedback('Period entry removed from cloud storage.');
          return { success: true };
        } catch (err: unknown) {
          const error = err as Error;
          showFeedback(`Error: ${error.message || 'Failed to delete period.'}`);
          return { success: false, error: error.message };
        }
      }
      return { success: true };
    },
    [periods, mode, user, showFeedback]
  );

  // ==========================================================================
  // Context Actions: Daily Logs
  // ==========================================================================

  const saveDailyLog = useCallback(
    async (logData: Omit<DailyLog, 'id' | 'source'>) => {
      // Demo Mode: In-memory only
      if (mode === 'demo' || !user?.uid) {
        setLogs((prev) => {
          const existingIndex = prev.findIndex((l) => l.date === logData.date);
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              ...logData,
            };
            return updated;
          } else {
            const newLog: DailyLog = {
              id: `log-${Date.now()}`,
              ...logData,
              source: mode === 'demo' ? 'demo' : 'user',
            };
            return [...prev, newLog];
          }
        });

        showFeedback(
          mode === 'demo'
            ? 'Daily journal entry saved in this demo (temporary state).'
            : 'Daily journal entry saved locally (sign in as patient to persist).'
        );
        return { success: true, message: 'Saved successfully.' };
      }

      // Live Mode: Firestore Persistence
      try {
        const res = await createOrUpdateDailyLog(user.uid, {
          ...logData,
          source: 'user',
        });

        if (!res.success) {
          showFeedback(`Error saving log: ${res.error || 'Cloud storage error.'}`);
          return { success: false, message: res.error || 'Failed to save daily log.' };
        }

        setLogs((prev) => {
          const existingIndex = prev.findIndex((l) => l.date === logData.date);
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              ...logData,
              id: res.id,
              source: 'user',
            };
            return updated;
          } else {
            const newLog: DailyLog = {
              id: res.id,
              ...logData,
              source: 'user',
            };
            return [...prev, newLog];
          }
        });

        showFeedback('Daily journal entry securely saved to cloud storage.');
        return { success: true, message: 'Saved to cloud successfully.' };
      } catch (err: unknown) {
        const error = err as Error;
        showFeedback(`Network error: ${error.message || 'Could not connect to cloud storage.'}`);
        return { success: false, message: error.message || 'Network error.' };
      }
    },
    [mode, user, showFeedback]
  );

  const deleteLog = useCallback(
    async (date: string) => {
      if (mode === 'demo' || !user?.uid) {
        setLogs((prev) => prev.filter((l) => l.date !== date));
        showFeedback('Daily journal entry deleted.');
        return { success: true };
      }

      try {
        const res = await deleteDailyLog(user.uid, date);
        if (!res.success) {
          showFeedback(`Error: ${res.error || 'Failed to delete daily log.'}`);
          return { success: false, error: res.error };
        }
        setLogs((prev) => prev.filter((l) => l.date !== date));
        showFeedback('Daily journal entry removed from cloud storage.');
        return { success: true };
      } catch (err: unknown) {
        const error = err as Error;
        showFeedback(`Error: ${error.message || 'Failed to delete log.'}`);
        return { success: false, error: error.message };
      }
    },
    [mode, user, showFeedback]
  );

  const getLogForDate = useCallback(
    (date: string) => {
      return logs.find((l) => l.date === date);
    },
    [logs]
  );

  // Pagination for historical logs
  const loadMoreLogs = useCallback(async (): Promise<boolean> => {
    if (mode === 'demo' || !user?.uid) return false;

    try {
      const res = await getPaginatedDailyLogs(user.uid, 50, lastLogSnapshot);
      if (res.logs.length > 0) {
        setLogs((prev) => {
          const existingDates = new Set(prev.map((l) => l.date));
          const newUniqueLogs = res.logs.filter((l) => !existingDates.has(l.date));
          return [...prev, ...newUniqueLogs];
        });
        setLastLogSnapshot(res.lastVisibleSnapshot);
        setHasMoreLogs(res.hasMore);
        return true;
      }
      setHasMoreLogs(false);
      return false;
    } catch (err) {
      console.error('Failed to load more logs:', err);
      return false;
    }
  }, [mode, user, lastLogSnapshot]);

  // Export all logs without silent truncation
  const exportAllLogs = useCallback(async (): Promise<DailyLog[]> => {
    if (mode === 'demo' || !user?.uid) {
      return logs;
    }
    try {
      return await fetchAllLogsForExport(user.uid);
    } catch (err) {
      console.error('Failed to export all logs:', err);
      return logs; // fallback to loaded logs
    }
  }, [mode, user, logs]);

  const value = useMemo(
    () => ({
      mode,
      setMode,
      toggleMode,
      periods: processedPeriods,
      logs,
      stats,
      selectedDate,
      setSelectedDate,
      addPeriod,
      updatePeriod,
      deletePeriod,
      saveDailyLog,
      deleteLog,
      getLogForDate,
      loadMoreLogs,
      hasMoreLogs,
      exportAllLogs,
      resetToDemo,
      clearAll,
      feedbackMessage,
      clearFeedback,
      isLoadingData,
      persistenceError,
    }),
    [
      mode,
      setMode,
      toggleMode,
      processedPeriods,
      logs,
      stats,
      selectedDate,
      addPeriod,
      updatePeriod,
      deletePeriod,
      saveDailyLog,
      deleteLog,
      getLogForDate,
      loadMoreLogs,
      hasMoreLogs,
      exportAllLogs,
      resetToDemo,
      clearAll,
      feedbackMessage,
      clearFeedback,
      isLoadingData,
      persistenceError,
    ]
  );

  return (
    <MenstrualHealthContext.Provider value={value}>
      {children}
    </MenstrualHealthContext.Provider>
  );
}

export function useMenstrualHealth() {
  const context = useContext(MenstrualHealthContext);
  if (!context) {
    throw new Error('useMenstrualHealth must be used within a MenstrualHealthProvider');
  }
  return context;
}
