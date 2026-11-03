'use client';

import React, { useState } from 'react';
import Icon from './Icon';
import { useMenstrualHealth } from '../../lib/menstrual-health/context';
import { PeriodRecord } from '../../lib/menstrual-health/types';
import { formatDateISO } from '../../lib/menstrual-health/calculations';

interface PeriodRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialStartDate?: string;
  editRecord?: PeriodRecord | null;
}

export default function PeriodRecordModal({
  isOpen,
  onClose,
  initialStartDate,
  editRecord
}: PeriodRecordModalProps) {
  if (!isOpen) return null;

  return (
    <PeriodRecordForm
      key={`${editRecord?.id || 'new'}-${initialStartDate || 'today'}`}
      onClose={onClose}
      initialStartDate={initialStartDate}
      editRecord={editRecord}
    />
  );
}

function PeriodRecordForm({
  onClose,
  initialStartDate,
  editRecord
}: {
  onClose: () => void;
  initialStartDate?: string;
  editRecord?: PeriodRecord | null;
}) {
  const { addPeriod, updatePeriod, deletePeriod } = useMenstrualHealth();

  const [startDate, setStartDate] = useState(() => {
    if (editRecord) return editRecord.startDate;
    return initialStartDate || formatDateISO(new Date());
  });

  const [endDate, setEndDate] = useState<string>(() => {
    if (editRecord && editRecord.endDate) return editRecord.endDate;
    const base = new Date(initialStartDate ? new Date(initialStartDate) : new Date());
    base.setDate(base.getDate() + 4);
    return formatDateISO(base);
  });

  const [flow, setFlow] = useState<'light' | 'medium' | 'heavy'>(() => {
    return editRecord ? editRecord.flow : 'medium';
  });

  const [notes, setNotes] = useState(() => {
    return editRecord?.notes || '';
  });

  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (editRecord) {
      const res = await updatePeriod(editRecord.id, {
        startDate,
        endDate,
        flow,
        notes
      });
      if (!res.success) {
        setError(res.error || 'Failed to update period.');
        return;
      }
    } else {
      const res = await addPeriod({
        startDate,
        endDate,
        flow,
        notes
      });
      if (!res.success) {
        setError(res.error || 'Failed to record period.');
        return;
      }
    }

    onClose();
  };

  const handleDelete = async () => {
    if (editRecord) {
      await deletePeriod(editRecord.id);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-inverse-surface/40 backdrop-blur-xs animate-fade-in">
      <div className="w-full max-w-md bg-surface-container-lowest rounded-2xl shadow-2xl p-6 sm:p-7 flex flex-col gap-5 border border-surface-container">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-surface-container/60 pb-3">
          <div className="flex flex-col">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-secondary">
              Cycle Manager
            </span>
            <h3 className="text-xl font-serif text-on-surface">
              {editRecord ? 'Edit Recorded Period' : 'Log Menstrual Span'}
            </h3>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="p-1.5 rounded-xl hover:bg-surface-container text-on-surface-variant transition-colors"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-error/10 border border-error/20 text-error text-xs font-medium flex items-center gap-2">
            <Icon name="info" size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-on-surface">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
              className="p-2.5 rounded-xl bg-surface-container-low text-on-surface text-sm border border-surface-container focus:outline-none focus:ring-1 focus:ring-primary focus:bg-surface-container-lowest"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-on-surface">End Date (Estimated or Known)</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
              className="p-2.5 rounded-xl bg-surface-container-low text-on-surface text-sm border border-surface-container focus:outline-none focus:ring-1 focus:ring-primary focus:bg-surface-container-lowest"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-on-surface">Overall Flow Intensity</label>
            <select
              value={flow}
              onChange={(e) => setFlow(e.target.value as 'light' | 'medium' | 'heavy')}
              className="p-2.5 rounded-xl bg-surface-container-low text-on-surface text-sm border border-surface-container focus:outline-none focus:ring-1 focus:ring-primary focus:bg-surface-container-lowest"
            >
              <option value="light">Light (Spotting / Low)</option>
              <option value="medium">Medium (Standard flow)</option>
              <option value="heavy">Heavy (Frequent replacement)</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-on-surface">Notes (Optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Mild cramps first 2 days"
              className="p-2.5 rounded-xl bg-surface-container-low text-on-surface text-sm border border-surface-container focus:outline-none focus:ring-1 focus:ring-primary focus:bg-surface-container-lowest"
            />
          </div>

          <div className="p-3 rounded-xl bg-surface-container-low text-xs text-on-surface-variant flex items-center gap-2">
            <Icon name="info" size={16} className="text-secondary shrink-0" />
            <span>Stored in temporary session state for this demo.</span>
          </div>

          <div className="flex items-center justify-between pt-2">
            {editRecord ? (
              <button
                type="button"
                onClick={handleDelete}
                className="text-xs text-error font-semibold hover:underline"
              >
                Delete Record
              </button>
            ) : (
              <div></div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-on-surface-variant text-xs font-semibold hover:bg-surface-container transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-semibold shadow-xs hover:bg-[#7b3e4a] transition-colors"
              >
                {editRecord ? 'Save Changes' : 'Record Period'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
