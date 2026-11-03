'use client';

import React, { useState } from 'react';
import Icon from './Icon';
import { useMenstrualHealth } from '../../lib/menstrual-health/context';
import { FlowLevel } from '../../lib/menstrual-health/types';
import { formatDateISO } from '../../lib/menstrual-health/calculations';

interface QuickLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultFlow?: FlowLevel;
}

export default function QuickLogModal({ isOpen, onClose, defaultFlow = 'medium' }: QuickLogModalProps) {
  const { saveDailyLog, getLogForDate } = useMenstrualHealth();
  const todayStr = formatDateISO(new Date());

  const existing = getLogForDate(todayStr);

  const [flow, setFlow] = useState<FlowLevel>(existing?.flow || defaultFlow);
  const [notes, setNotes] = useState<string>(existing?.notes || '');

  if (!isOpen) return null;

  const handleSave = () => {
    saveDailyLog({
      date: todayStr,
      flow,
      symptoms: existing?.symptoms || [],
      mood: existing?.mood,
      energy: existing?.energy,
      sleepHours: existing?.sleepHours,
      sleepQuality: existing?.sleepQuality,
      notes
    });
    onClose();
  };

  const flowOptions: { id: FlowLevel; label: string }[] = [
    { id: 'spotting', label: 'Spotting' },
    { id: 'light', label: 'Light' },
    { id: 'medium', label: 'Medium' },
    { id: 'heavy', label: 'Heavy' }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-inverse-surface/40 backdrop-blur-xs animate-fade-in">
      <div className="w-full max-w-lg rounded-2xl bg-surface-container-lowest p-6 sm:p-8 shadow-2xl flex flex-col gap-6 relative border border-surface-container">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-surface-container/60 pb-4">
          <div className="flex flex-col">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-secondary">
              Interactive Log
            </span>
            <h3 className="text-xl font-serif text-on-surface">Record Menstrual Status</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors"
            aria-label="Close modal"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Bleeding Intensity selector */}
        <div className="flex flex-col gap-2.5">
          <label className="text-sm font-semibold text-on-surface">Select Bleeding Intensity</label>
          <div className="grid grid-cols-4 gap-2">
            {flowOptions.map((opt) => {
              const selected = flow === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setFlow(opt.id)}
                  className={`py-2.5 px-2 rounded-xl text-xs font-semibold transition-all ${
                    selected
                      ? 'bg-primary text-on-primary shadow-xs'
                      : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Notes textarea */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-on-surface">Cervical & Physical Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Log any feelings, energy changes, or physical observations today..."
            className="w-full p-3 rounded-xl bg-surface-container-low text-on-surface text-sm border border-surface-container focus:outline-none focus:ring-1 focus:ring-primary focus:bg-surface-container-lowest resize-none transition-colors"
          ></textarea>
        </div>

        {/* Demo banner note */}
        <div className="p-3 rounded-xl bg-surface-container-low text-xs text-on-surface-variant flex items-center gap-2">
          <Icon name="info" size={16} className="text-secondary shrink-0" />
          <span>Entries are saved in temporary prototype state for this demo.</span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-on-surface-variant text-sm font-medium hover:bg-surface-container transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold shadow-xs hover:bg-[#7b3e4a] transition-colors"
          >
            Save Daily Log
          </button>
        </div>
      </div>
    </div>
  );
}

