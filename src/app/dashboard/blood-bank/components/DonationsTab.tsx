'use client';

import { useState } from 'react';
import { BloodDonation, BloodDonor, DonationCollectionStatus, ScreeningStatus } from '@/lib/blood-bank/types';

interface DonationsTabProps {
  donations: BloodDonation[];
  donors: BloodDonor[];
  isRecordOpen: boolean;
  onCloseRecord: () => void;
  onOpenRecord: () => void;
  onSubmitRecord: (data: Omit<BloodDonation, 'id' | 'centerId' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  staffUid: string;
}

export default function DonationsTab({
  donations,
  donors,
  isRecordOpen,
  onCloseRecord,
  onOpenRecord,
  onSubmitRecord,
  staffUid,
}: DonationsTabProps) {
  const [selectedScreening, setSelectedScreening] = useState<string>('all');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    donorId: '',
    volumeMl: 450,
    collectionStatus: 'completed' as DonationCollectionStatus,
    screeningStatus: 'pending' as ScreeningStatus,
    screeningNotes: '',
    adverseEventNotes: '',
  });

  const filteredDonations = donations.filter((don) => {
    return selectedScreening === 'all' || don.screeningStatus === selectedScreening;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);

    const selectedDonor = donors.find((d) => d.id === formData.donorId);
    if (!selectedDonor) {
      setFormError('Please select a registered donor.');
      setSubmitting(false);
      return;
    }

    try {
      await onSubmitRecord({
        donorId: selectedDonor.id,
        donorName: selectedDonor.fullName,
        bloodGroup: selectedDonor.bloodGroup,
        donationDate: new Date().toISOString(),
        volumeMl: Number(formData.volumeMl),
        collectionStatus: formData.collectionStatus,
        screeningStatus: formData.screeningStatus,
        screeningNotes: formData.screeningNotes.trim() || undefined,
        collectionStaffUid: staffUid,
        adverseEventNotes: formData.adverseEventNotes.trim() || undefined,
      });

      setFormData({
        donorId: '',
        volumeMl: 450,
        collectionStatus: 'completed',
        screeningStatus: 'pending',
        screeningNotes: '',
        adverseEventNotes: '',
      });
      onCloseRecord();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to record donation';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const eligibleDonors = donors.filter((d) => d.eligibilityStatus === 'eligible');

  return (
    <div className="space-y-6">
      {/* Top Filter and Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-slate-600">Screening Status:</label>
          <select
            value={selectedScreening}
            onChange={(e) => setSelectedScreening(e.target.value)}
            className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
          >
            <option value="all">All Screening Results</option>
            <option value="pending">Pending</option>
            <option value="tested_passed">Tested Passed</option>
            <option value="tested_failed">Tested Failed</option>
            <option value="quarantined">Quarantined</option>
          </select>
        </div>

        <button
          onClick={onOpenRecord}
          className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-xs"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          Record Donation
        </button>
      </div>

      {/* Donations Table */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        {filteredDonations.length === 0 ? (
          <div className="text-center py-12 px-4">
            <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
            <h4 className="text-sm font-semibold text-slate-900">No donation sessions recorded</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
              Collected blood volumes and laboratory screening outcomes are logged here following collection procedures.
            </p>
            <button
              onClick={onOpenRecord}
              className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg text-xs font-medium transition-colors"
            >
              + Record first donation
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-100">
                  <th className="py-3 px-4">Donation ID</th>
                  <th className="py-3 px-4">Donor Name</th>
                  <th className="py-3 px-4">Blood Group</th>
                  <th className="py-3 px-4">Volume</th>
                  <th className="py-3 px-4">Date / Time</th>
                  <th className="py-3 px-4">Collection Status</th>
                  <th className="py-3 px-4">Screening Status</th>
                  <th className="py-3 px-4">Staff UID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDonations.map((don) => (
                  <tr key={don.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-medium text-slate-700">{don.id}</td>
                    <td className="py-3.5 px-4 font-semibold text-slate-900">{don.donorName}</td>
                    <td className="py-3.5 px-4">
                      <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700 border border-rose-200">
                        {don.bloodGroup}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-medium text-slate-700">{don.volumeMl} ml</td>
                    <td className="py-3.5 px-4 text-slate-600">
                      {don.donationDate.replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="py-3.5 px-4 capitalize text-slate-700 font-medium">
                      {don.collectionStatus.replace(/_/g, ' ')}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          don.screeningStatus === 'tested_passed'
                            ? 'bg-emerald-100 text-emerald-800'
                            : don.screeningStatus === 'tested_failed'
                            ? 'bg-rose-100 text-rose-800'
                            : don.screeningStatus === 'quarantined'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {don.screeningStatus.replace(/_/g, ' ').toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-slate-500">{don.collectionStaffUid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record Donation Modal */}
      {isRecordOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Record Blood Donation</h3>
              <button
                onClick={onCloseRecord}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="mt-4 p-3 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-xs font-medium">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Select Registered Donor *</label>
                {eligibleDonors.length === 0 ? (
                  <div className="p-3 bg-amber-50 rounded-lg text-xs text-amber-800 border border-amber-200">
                    No eligible donors found. Please register an eligible donor first before recording a donation session.
                  </div>
                ) : (
                  <select
                    required
                    value={formData.donorId}
                    onChange={(e) => setFormData({ ...formData, donorId: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none"
                  >
                    <option value="">-- Select Donor --</option>
                    {eligibleDonors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.fullName} ({d.bloodGroup}) — Ref: {d.donorReferenceId}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Collection Volume (ml) *</label>
                  <input
                    type="number"
                    min="100"
                    max="600"
                    required
                    value={formData.volumeMl}
                    onChange={(e) => setFormData({ ...formData, volumeMl: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-400">Standard whole blood: 450 ml</span>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Collection Outcome *</label>
                  <select
                    value={formData.collectionStatus}
                    onChange={(e) => setFormData({ ...formData, collectionStatus: e.target.value as DonationCollectionStatus })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none"
                  >
                    <option value="completed">Completed (Full Draw)</option>
                    <option value="partial">Partial Draw</option>
                    <option value="adverse_reaction">Adverse Reaction</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Laboratory Screening Status *</label>
                <select
                  value={formData.screeningStatus}
                  onChange={(e) => setFormData({ ...formData, screeningStatus: e.target.value as ScreeningStatus })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none"
                >
                  <option value="pending">Pending Laboratory Panel</option>
                  <option value="tested_passed">Tested & Passed (All tests negative)</option>
                  <option value="tested_failed">Tested & Failed (Reactive / Incompatible)</option>
                  <option value="quarantined">Quarantined for Secondary Testing</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Laboratory Notes</label>
                <input
                  type="text"
                  placeholder="e.g. HIV/HBV/HCV/Syphilis non-reactive"
                  value={formData.screeningNotes}
                  onChange={(e) => setFormData({ ...formData, screeningNotes: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>

              {formData.collectionStatus === 'adverse_reaction' && (
                <div>
                  <label className="block text-xs font-semibold text-rose-700 mb-1">Adverse Reaction Notes *</label>
                  <textarea
                    required
                    placeholder="Document donor symptoms, staff intervention, and vital signs..."
                    value={formData.adverseEventNotes}
                    onChange={(e) => setFormData({ ...formData, adverseEventNotes: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-rose-300 rounded-lg focus:outline-none"
                    rows={2}
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onCloseRecord}
                  className="px-4 py-2 text-xs text-slate-600 hover:text-slate-800 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || eligibleDonors.length === 0}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors shadow-xs"
                >
                  {submitting ? 'Recording...' : 'Save Donation Session'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
