'use client';

import { useState } from 'react';
import {
  BloodDistribution,
  BloodInventoryUnit,
  BloodRequest,
  DispatchStatus,
} from '@/lib/blood-bank/types';

interface DistributionTabProps {
  distributions: BloodDistribution[];
  inventory: BloodInventoryUnit[];
  requests: BloodRequest[];
  isIssueOpen: boolean;
  onCloseIssue: () => void;
  onOpenIssue: () => void;
  onSubmitIssue: (data: Omit<BloodDistribution, 'id' | 'centerId' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  staffUid: string;
}

export default function DistributionTab({
  distributions,
  inventory,
  requests,
  isIssueOpen,
  onCloseIssue,
  onOpenIssue,
  onSubmitIssue,
  staffUid,
}: DistributionTabProps) {
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    requestId: '',
    destinationOrganization: '',
    departmentOrWard: '',
    selectedUnitIds: [] as string[],
    transportReference: '',
    temperatureLogVerified: false,
    dispatchStatus: 'dispatched' as DispatchStatus,
    notes: '',
  });

  const availableUnits = inventory.filter((u) => u.status === 'available');
  const approvedRequests = requests.filter((r) => ['approved', 'under_review'].includes(r.status));

  const handleRequestChange = (reqId: string) => {
    const req = requests.find((r) => r.id === reqId);
    if (req) {
      setFormData({
        ...formData,
        requestId: req.id,
        destinationOrganization: req.requestingOrganization,
        departmentOrWard: req.departmentOrWard || '',
      });
    } else {
      setFormData({ ...formData, requestId: reqId });
    }
  };

  const toggleUnitSelection = (unitId: string) => {
    const current = [...formData.selectedUnitIds];
    const index = current.indexOf(unitId);
    if (index > -1) {
      current.splice(index, 1);
    } else {
      current.push(unitId);
    }
    setFormData({ ...formData, selectedUnitIds: current });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);

    if (formData.selectedUnitIds.length === 0) {
      setFormError('Please select at least one available blood unit to issue.');
      setSubmitting(false);
      return;
    }

    if (!formData.temperatureLogVerified) {
      setFormError('You must verify and confirm the cold-chain temperature log prior to dispatch.');
      setSubmitting(false);
      return;
    }

    try {
      await onSubmitIssue({
        requestId: formData.requestId,
        destinationOrganization: formData.destinationOrganization.trim(),
        departmentOrWard: formData.departmentOrWard.trim() || undefined,
        issuedUnitIds: formData.selectedUnitIds,
        authorizedStaffUid: staffUid,
        dispatchStatus: formData.dispatchStatus,
        transportReference: formData.transportReference.trim() || undefined,
        temperatureLogVerified: formData.temperatureLogVerified,
        dispatchedAt: new Date().toISOString(),
        notes: formData.notes.trim() || undefined,
      });

      setFormData({
        requestId: '',
        destinationOrganization: '',
        departmentOrWard: '',
        selectedUnitIds: [],
        transportReference: '',
        temperatureLogVerified: false,
        dispatchStatus: 'dispatched',
        notes: '',
      });
      onCloseIssue();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to issue units';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
        <div className="text-xs text-slate-500">
          Showing {distributions.length} recorded dispatch & delivery events.
        </div>
        <button
          onClick={onOpenIssue}
          className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-xs"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          Issue Blood Units
        </button>
      </div>

      {/* Distribution Records Table */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        {distributions.length === 0 ? (
          <div className="text-center py-12 px-4">
            <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </div>
            <h4 className="text-sm font-semibold text-slate-900">No blood units distributed yet</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
              Issued and dispatched blood units with courier, recipient, and cold-chain temperature verification appear here.
            </p>
            <button
              onClick={onOpenIssue}
              className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg text-xs font-medium transition-colors"
            >
              + Issue first dispatch
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-100">
                  <th className="py-3 px-4">Issue ID</th>
                  <th className="py-3 px-4">Request ID</th>
                  <th className="py-3 px-4">Destination Facility</th>
                  <th className="py-3 px-4">Units Dispatched</th>
                  <th className="py-3 px-4">Dispatch Status</th>
                  <th className="py-3 px-4">Transport Ref</th>
                  <th className="py-3 px-4">Dispatched At</th>
                  <th className="py-3 px-4">Staff UID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {distributions.map((dist) => (
                  <tr key={dist.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-medium text-slate-700">{dist.id}</td>
                    <td className="py-3.5 px-4 font-mono text-slate-500">{dist.requestId}</td>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900">{dist.destinationOrganization}</div>
                      {dist.departmentOrWard && (
                        <div className="text-[11px] text-slate-400">{dist.departmentOrWard}</div>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex flex-wrap gap-1">
                        {dist.issuedUnitIds.map((u) => (
                          <span
                            key={u}
                            className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 font-mono text-[10px]"
                          >
                            {u}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          dist.dispatchStatus === 'delivered'
                            ? 'bg-purple-100 text-purple-800'
                            : dist.dispatchStatus === 'in_transit'
                            ? 'bg-sky-100 text-sky-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {dist.dispatchStatus.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 font-mono text-[11px]">
                      {dist.transportReference || '—'}
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">
                      {dist.dispatchedAt ? dist.dispatchedAt.replace('T', ' ').slice(0, 16) : '—'}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-slate-500">
                      {dist.authorizedStaffUid}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Issue Modal */}
      {isIssueOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Issue Blood Units for Dispatch</h3>
              <button
                onClick={onCloseIssue}
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
                <label className="block text-xs font-semibold text-slate-700 mb-1">Select Blood Request *</label>
                {approvedRequests.length === 0 ? (
                  <div className="p-3 bg-amber-50 rounded-lg text-xs text-amber-800 border border-amber-200">
                    No active approved requests found. You can enter the request and facility manually below.
                  </div>
                ) : (
                  <select
                    value={formData.requestId}
                    onChange={(e) => handleRequestChange(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none mb-2"
                  >
                    <option value="">-- Select Approved Request --</option>
                    {approvedRequests.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id} — {r.requestingOrganization} ({r.quantityUnits}x {r.bloodGroup} {r.componentType})
                      </option>
                    ))}
                  </select>
                )}
                {!formData.requestId && (
                  <input
                    type="text"
                    required
                    placeholder="Request ID (e.g. req_emergency_01)"
                    value={formData.requestId}
                    onChange={(e) => setFormData({ ...formData, requestId: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono focus:outline-none"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Destination Facility *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. City General Hospital - Surgery ICU"
                  value={formData.destinationOrganization}
                  onChange={(e) => setFormData({ ...formData, destinationOrganization: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Select Units from Available Inventory * ({formData.selectedUnitIds.length} selected)
                </label>
                {availableUnits.length === 0 ? (
                  <div className="p-3 bg-rose-50 text-rose-800 rounded-lg text-xs border border-rose-200">
                    No available units currently in stock to issue.
                  </div>
                ) : (
                  <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 p-2 space-y-1">
                    {availableUnits.map((u) => {
                      const isSelected = formData.selectedUnitIds.includes(u.id);
                      return (
                        <div
                          key={u.id}
                          onClick={() => toggleUnitSelection(u.id)}
                          className={`p-2 rounded text-xs flex items-center justify-between cursor-pointer transition-colors ${
                            isSelected ? 'bg-rose-50 border border-rose-200 text-rose-900' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div>
                            <span className="font-mono font-bold">{u.id}</span> •{' '}
                            <span className="font-bold text-rose-600">{u.bloodGroup}</span> ({u.componentType.replace(/_/g, ' ')})
                          </div>
                          <div className="text-[11px] text-slate-500">Exp: {u.expiryDate}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Transport / Courier Ref</label>
                  <input
                    type="text"
                    placeholder="e.g. AMBULANCE-LOG-401"
                    value={formData.transportReference}
                    onChange={(e) => setFormData({ ...formData, transportReference: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Dispatch Status *</label>
                  <select
                    value={formData.dispatchStatus}
                    onChange={(e) => setFormData({ ...formData, dispatchStatus: e.target.value as DispatchStatus })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none"
                  >
                    <option value="dispatched">Dispatched</option>
                    <option value="in_transit">In Transit</option>
                    <option value="delivered">Delivered (Direct Handover)</option>
                  </select>
                </div>
              </div>

              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    required
                    checked={formData.temperatureLogVerified}
                    onChange={(e) => setFormData({ ...formData, temperatureLogVerified: e.target.checked })}
                    className="mt-0.5 rounded border-amber-300 text-rose-600 focus:ring-rose-500"
                  />
                  <span className="text-xs text-amber-900 leading-tight">
                    <strong>Cold-Chain Verification Sign-off:</strong> I confirm that insulated transport container temperatures have been verified and comply with storage specifications prior to dispatch.
                  </span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onCloseIssue}
                  className="px-4 py-2 text-xs text-slate-600 hover:text-slate-800 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || availableUnits.length === 0}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors shadow-xs"
                >
                  {submitting ? 'Confirming Dispatch...' : 'Confirm Issue & Dispatch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

