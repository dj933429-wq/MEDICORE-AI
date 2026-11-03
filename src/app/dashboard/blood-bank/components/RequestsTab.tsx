'use client';

import { useState } from 'react';
import {
  BloodRequest,
  BloodGroup,
  BloodComponentType,
  RequestUrgency,
  RequestStatus,
} from '@/lib/blood-bank/types';
import {
  BLOOD_GROUPS,
  BLOOD_COMPONENTS,
  REQUEST_URGENCY_LABELS,
} from '@/lib/blood-bank/constants';

interface RequestsTabProps {
  requests: BloodRequest[];
  isSubmitOpen: boolean;
  onCloseSubmit: () => void;
  onOpenSubmit: () => void;
  onSubmitRequest: (data: Omit<BloodRequest, 'id' | 'centerId' | 'status' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onUpdateRequestStatus: (requestId: string, status: RequestStatus, notes?: string) => Promise<void>;
  staffUid: string;
}

export default function RequestsTab({
  requests,
  isSubmitOpen,
  onCloseSubmit,
  onOpenSubmit,
  onSubmitRequest,
  onUpdateRequestStatus,
}: RequestsTabProps) {
  const [selectedUrgency, setSelectedUrgency] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Status Modal State
  const [statusModalReq, setStatusModalReq] = useState<BloodRequest | null>(null);
  const [newStatus, setNewStatus] = useState<RequestStatus>('approved');
  const [decisionNotes, setDecisionNotes] = useState('');

  // Submit Request Form State
  const [formData, setFormData] = useState({
    requestingOrganization: '',
    departmentOrWard: '',
    patientIdentifier: '',
    bloodGroup: 'O+' as BloodGroup,
    componentType: 'red_blood_cells' as BloodComponentType,
    quantityUnits: 2,
    urgency: 'routine' as RequestUrgency,
    requiredByDate: '',
    clinicalIndication: '',
  });

  const filteredRequests = requests.filter((req) => {
    const matchesUrgency = selectedUrgency === 'all' || req.urgency === selectedUrgency;
    const matchesStatus = selectedStatus === 'all' || req.status === selectedStatus;
    return matchesUrgency && matchesStatus;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      await onSubmitRequest({
        requestingOrganization: formData.requestingOrganization.trim(),
        departmentOrWard: formData.departmentOrWard.trim() || undefined,
        patientIdentifier: formData.patientIdentifier.trim() || undefined,
        bloodGroup: formData.bloodGroup,
        componentType: formData.componentType,
        quantityUnits: Number(formData.quantityUnits),
        urgency: formData.urgency,
        requiredByDate: formData.requiredByDate,
        clinicalIndication: formData.clinicalIndication.trim() || undefined,
      });

      setFormData({
        requestingOrganization: '',
        departmentOrWard: '',
        patientIdentifier: '',
        bloodGroup: 'O+',
        componentType: 'red_blood_cells',
        quantityUnits: 2,
        urgency: 'routine',
        requiredByDate: '',
        clinicalIndication: '',
      });
      onCloseSubmit();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit blood request';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusModalReq) return;
    setSubmitting(true);

    try {
      await onUpdateRequestStatus(statusModalReq.id, newStatus, decisionNotes.trim() || undefined);
      setStatusModalReq(null);
      setDecisionNotes('');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedUrgency}
            onChange={(e) => setSelectedUrgency(e.target.value)}
            className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
          >
            <option value="all">All Urgencies</option>
            <option value="emergency_stat">Emergency (STAT)</option>
            <option value="urgent">Urgent</option>
            <option value="routine">Routine</option>
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="submitted">Submitted</option>
            <option value="under_review">Under Review</option>
            <option value="approved">Approved</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <button
          onClick={onOpenSubmit}
          className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-xs"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          Submit Blood Request
        </button>
      </div>

      {/* Requests Table */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        {filteredRequests.length === 0 ? (
          <div className="text-center py-12 px-4">
            <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h4 className="text-sm font-semibold text-slate-900">No active blood requests</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
              Clinical departments and partner hospitals submit transfusion supply orders here for triage and fulfillment.
            </p>
            <button
              onClick={onOpenSubmit}
              className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg text-xs font-medium transition-colors"
            >
              + Submit first request
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-100">
                  <th className="py-3 px-4">Request ID</th>
                  <th className="py-3 px-4">Requesting Hospital / Dept</th>
                  <th className="py-3 px-4">Blood Group</th>
                  <th className="py-3 px-4">Component</th>
                  <th className="py-3 px-4">Qty</th>
                  <th className="py-3 px-4">Urgency</th>
                  <th className="py-3 px-4">Required By</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-medium text-slate-700">{req.id}</td>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900">{req.requestingOrganization}</div>
                      {req.departmentOrWard && (
                        <div className="text-[11px] text-slate-400">{req.departmentOrWard}</div>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700 border border-rose-200">
                        {req.bloodGroup}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 capitalize text-slate-700 font-medium">
                      {req.componentType.replace(/_/g, ' ')}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-slate-900">{req.quantityUnits} unit(s)</td>
                    <td className="py-3.5 px-4">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${REQUEST_URGENCY_LABELS[req.urgency]?.color || 'bg-slate-200'}`}>
                        {req.urgency.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">
                      {req.requiredByDate ? req.requiredByDate.replace('T', ' ').slice(0, 16) : 'ASAP'}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          req.status === 'approved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : req.status === 'fulfilled'
                            ? 'bg-purple-100 text-purple-800'
                            : req.status === 'under_review'
                            ? 'bg-sky-100 text-sky-800'
                            : req.status === 'rejected'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {req.status.replace(/_/g, ' ').toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <button
                        onClick={() => {
                          setStatusModalReq(req);
                          setNewStatus(req.status === 'submitted' ? 'under_review' : 'approved');
                          setDecisionNotes(req.decisionNotes || '');
                        }}
                        className="px-2.5 py-1 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition-colors"
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Submit Request Modal */}
      {isSubmitOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Submit Clinical Blood Request</h3>
              <button
                onClick={onCloseSubmit}
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
                <label className="block text-xs font-semibold text-slate-700 mb-1">Requesting Facility / Hospital *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. City General Hospital"
                  value={formData.requestingOrganization}
                  onChange={(e) => setFormData({ ...formData, requestingOrganization: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Department / Ward</label>
                  <input
                    type="text"
                    placeholder="e.g. Trauma ICU / Surgery 3"
                    value={formData.departmentOrWard}
                    onChange={(e) => setFormData({ ...formData, departmentOrWard: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Patient Ref / Indication</label>
                  <input
                    type="text"
                    placeholder="e.g. PT-941 (Optional)"
                    value={formData.patientIdentifier}
                    onChange={(e) => setFormData({ ...formData, patientIdentifier: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Blood Group *</label>
                  <select
                    value={formData.bloodGroup}
                    onChange={(e) => setFormData({ ...formData, bloodGroup: e.target.value as BloodGroup })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white font-bold text-rose-700 focus:outline-none"
                  >
                    {BLOOD_GROUPS.map((bg) => (
                      <option key={bg} value={bg}>
                        {bg}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Component Type *</label>
                  <select
                    value={formData.componentType}
                    onChange={(e) => setFormData({ ...formData, componentType: e.target.value as BloodComponentType })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none"
                  >
                    {BLOOD_COMPONENTS.map((c) => (
                      <option key={c.type} value={c.type}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Quantity Units *</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    required
                    value={formData.quantityUnits}
                    onChange={(e) => setFormData({ ...formData, quantityUnits: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Urgency Classification *</label>
                  <select
                    value={formData.urgency}
                    onChange={(e) => setFormData({ ...formData, urgency: e.target.value as RequestUrgency })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white font-semibold focus:outline-none"
                  >
                    <option value="routine">Routine</option>
                    <option value="urgent">Urgent (&lt; 6 hours)</option>
                    <option value="emergency_stat">EMERGENCY (STAT - Immediate)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Required By Timestamp *</label>
                <input
                  type="datetime-local"
                  required
                  value={formData.requiredByDate}
                  onChange={(e) => setFormData({ ...formData, requiredByDate: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onCloseSubmit}
                  className="px-4 py-2 text-xs text-slate-600 hover:text-slate-800 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors shadow-xs"
                >
                  {submitting ? 'Submitting...' : 'Send Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Review Request Modal */}
      {statusModalReq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
            <h3 className="text-base font-bold text-slate-900 pb-2 border-b border-slate-100">
              Review Request: {statusModalReq.id}
            </h3>

            <div className="mt-3 text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1">
              <div><strong>Facility:</strong> {statusModalReq.requestingOrganization}</div>
              <div><strong>Requirement:</strong> {statusModalReq.quantityUnits} unit(s) of {statusModalReq.bloodGroup} {statusModalReq.componentType.replace(/_/g, ' ')}</div>
              <div><strong>Current status:</strong> <span className="uppercase font-semibold">{statusModalReq.status}</span></div>
            </div>

            <form onSubmit={handleStatusSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">New Review Status *</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as RequestStatus)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none"
                >
                  <option value="under_review">Under Review</option>
                  <option value="approved">Approved</option>
                  <option value="partially_fulfilled">Partially Fulfilled</option>
                  <option value="fulfilled">Fulfilled</option>
                  <option value="rejected">Rejected (Out of Stock / Incompatible)</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reviewer Notes / Clinical Sign-off</label>
                <textarea
                  placeholder="Reason for approval/rejection or cross-match instructions..."
                  value={decisionNotes}
                  onChange={(e) => setDecisionNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none"
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStatusModalReq(null)}
                  className="px-4 py-2 text-xs text-slate-600 hover:text-slate-800 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors shadow-xs"
                >
                  {submitting ? 'Saving...' : 'Update Status'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
