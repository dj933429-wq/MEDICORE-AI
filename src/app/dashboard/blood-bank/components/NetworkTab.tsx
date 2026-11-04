'use client';

import { useState } from 'react';
import {
  NetworkBloodRequest,
  BloodBankCenter,
  BloodInventoryUnit,
} from '@/lib/blood-bank/types';
import {
  REQUEST_URGENCY_LABELS,
} from '@/lib/blood-bank/constants';

interface NetworkTabProps {
  networkRequests: NetworkBloodRequest[];
  bloodBankCenters: BloodBankCenter[];
  inventory: BloodInventoryUnit[];
  currentCenterId: string;
  currentUser: { uid: string; email?: string };
  onRefresh: () => Promise<void>;
  onAcceptRequest: (requestId: string, centerId: string, assignedUnitIds: string[]) => Promise<void>;
  onRejectRequest: (requestId: string, centerId: string, reason: string) => Promise<void>;
  onSeedExhibition: () => Promise<void>;
}

export default function NetworkTab({
  networkRequests,
  bloodBankCenters,
  inventory,
  currentCenterId,
  onRefresh,
  onAcceptRequest,
  onRejectRequest,
  onSeedExhibition,
}: NetworkTabProps) {
  const [subView, setSubView] = useState<'requests' | 'centers'>('requests');
  const [requestFilter, setRequestFilter] = useState<'all' | 'broadcast' | 'targeted' | 'exhibition'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'submitted' | 'reserved' | 'rejected'>('all');

  // Accept Modal State
  const [acceptingReq, setAcceptingReq] = useState<NetworkBloodRequest | null>(null);
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const [acceptingError, setAcceptingError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Reject Modal State
  const [rejectingReq, setRejectingReq] = useState<NetworkBloodRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectingError, setRejectingError] = useState<string | null>(null);

  // Center Stock Modal State
  const [viewingCenter, setViewingCenter] = useState<BloodBankCenter | null>(null);

  // Seeding feedback state
  const [seedingStatus, setSeedingStatus] = useState<string | null>(null);

  // Filter requests
  const filteredRequests = networkRequests.filter((req) => {
    if (requestFilter === 'broadcast' && req.requestType !== 'shortage_broadcast') return false;
    if (requestFilter === 'targeted' && req.requestType !== 'targeted') return false;
    if (requestFilter === 'exhibition' && !req.isExhibitionData) return false;
    if (statusFilter !== 'all' && req.status !== statusFilter) return false;
    return true;
  });

  // Count metrics
  const activeBroadcastsCount = networkRequests.filter((r) => r.requestType === 'shortage_broadcast' && r.status === 'submitted').length;
  const targetedToMeCount = networkRequests.filter((r) => r.requestType === 'targeted' && r.targetCenterId === currentCenterId && r.status === 'submitted').length;
  const emergencyStatCount = networkRequests.filter((r) => r.urgency === 'emergency_stat' && r.status === 'submitted').length;

  const handleOpenAccept = (req: NetworkBloodRequest) => {
    setAcceptingReq(req);
    // Find eligible available units in current inventory matching bloodGroup and componentType
    const matching = inventory.filter(
      (u) =>
        u.status === 'available' &&
        u.bloodGroup === req.bloodGroup &&
        u.componentType === req.componentType
    );
    // Pre-select up to requested quantity
    const defaultSelection = matching.slice(0, req.quantityUnits).map((u) => u.id);
    setSelectedUnitIds(defaultSelection);
    setAcceptingError(null);
  };

  const handleConfirmAccept = async () => {
    if (!acceptingReq) return;
    if (selectedUnitIds.length === 0) {
      setAcceptingError('Please select at least one available inventory unit.');
      return;
    }
    if (selectedUnitIds.length > acceptingReq.quantityUnits) {
      setAcceptingError(`Cannot assign more than ${acceptingReq.quantityUnits} unit(s).`);
      return;
    }

    try {
      setIsProcessing(true);
      setAcceptingError(null);
      await onAcceptRequest(acceptingReq.id, currentCenterId, selectedUnitIds);
      setAcceptingReq(null);
      await onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to accept and reserve network request';
      setAcceptingError(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOpenReject = (req: NetworkBloodRequest) => {
    setRejectingReq(req);
    setRejectionReason('Current inventory depleted or reserved for scheduled surgical cases.');
    setRejectingError(null);
  };

  const handleConfirmReject = async () => {
    if (!rejectingReq) return;
    if (!rejectionReason.trim()) {
      setRejectingError('Please provide a clinical rejection explanation.');
      return;
    }

    try {
      setIsProcessing(true);
      setRejectingError(null);
      await onRejectRequest(rejectingReq.id, currentCenterId, rejectionReason.trim());
      setRejectingReq(null);
      await onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to reject network request';
      setRejectingError(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSeed = async () => {
    try {
      setIsProcessing(true);
      setSeedingStatus('Seeding network exhibition dataset into Firestore...');
      await onSeedExhibition();
      setSeedingStatus('Exhibition network dataset populated successfully!');
      setTimeout(() => setSeedingStatus(null), 4000);
      await onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to seed exhibition dataset';
      setSeedingStatus(`Error: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Exhibition Actions */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <h2 className="text-base font-bold text-slate-900 tracking-tight">
              Shared Blood Bank Network (Phase 4B)
            </h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200 uppercase">
              Cross-Center Interoperability
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Coordinating hospitals, patients, and certified regional blood centers. Discover public stock summaries,
            respond to emergency shortage broadcasts, and execute race-safe inventory reservation locks.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSeed}
            disabled={isProcessing}
            className="px-3.5 py-2 text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl transition-colors flex items-center gap-1.5 shadow-2xs disabled:opacity-50"
          >
            <svg className="w-4 h-4 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Seed Exhibition Network Data
          </button>
          <button
            onClick={onRefresh}
            className="p-2 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            title="Refresh Network Data"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {seedingStatus && (
        <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-900 flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-600 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
          </svg>
          <span>{seedingStatus}</span>
        </div>
      )}

      {/* Clinical Disclaimer Guardrail */}
      <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2.5">
        <svg className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div>
          <span className="font-bold">NON-AUTOMATED CLINICAL ALLOCATION GUARDRAIL:</span> The MEDICORE-AI platform manages stock discovery, inter-hospital logistics, and anti-collision reservation locks. Physical blood product selection, ABO/Rh crossmatching, antibody screening, and cold chain temperature compliance must be physically verified and authorized by licensed blood bank personnel before release.
        </div>
      </div>

      {/* High-Level Network Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
          <div className="text-[11px] font-semibold text-slate-500 uppercase">Emergency STAT Alerts</div>
          <div className="text-2xl font-bold text-rose-600 mt-1 flex items-center gap-2">
            {emergencyStatCount}
            {emergencyStatCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 animate-pulse">
                ACTION REQUIRED
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">Critical trauma shortages</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
          <div className="text-[11px] font-semibold text-slate-500 uppercase">Shortage Broadcasts</div>
          <div className="text-2xl font-bold text-amber-600 mt-1">{activeBroadcastsCount}</div>
          <p className="text-[11px] text-slate-400 mt-0.5">Unassigned network requests</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
          <div className="text-[11px] font-semibold text-slate-500 uppercase">Targeted To My Center</div>
          <div className="text-2xl font-bold text-indigo-600 mt-1">{targetedToMeCount}</div>
          <p className="text-[11px] text-slate-400 mt-0.5">Direct orders awaiting review</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
          <div className="text-[11px] font-semibold text-slate-500 uppercase">Registered Centers</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">{bloodBankCenters.length}</div>
          <p className="text-[11px] text-slate-400 mt-0.5">Verified regional facilities</p>
        </div>
      </div>

      {/* Sub-view switcher: Requests Portal vs Public Centers Directory */}
      <div className="flex border-b border-slate-200 gap-6">
        <button
          onClick={() => setSubView('requests')}
          className={`pb-3 text-xs font-bold transition-colors relative ${
            subView === 'requests'
              ? 'text-rose-600 border-b-2 border-rose-600'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          Network Requests & Shortage Broadcasts ({networkRequests.length})
        </button>
        <button
          onClick={() => setSubView('centers')}
          className={`pb-3 text-xs font-bold transition-colors relative ${
            subView === 'centers'
              ? 'text-rose-600 border-b-2 border-rose-600'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          Public Blood Bank Directory & Stock Explorer ({bloodBankCenters.length})
        </button>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* VIEW 1: Network Requests & Shortage Broadcasts */}
      {/* ------------------------------------------------------------------- */}
      {subView === 'requests' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 border border-slate-200 rounded-xl">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600">Type:</span>
              <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs">
                {(['all', 'broadcast', 'targeted', 'exhibition'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setRequestFilter(mode)}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      requestFilter === mode
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {mode === 'all'
                      ? 'All'
                      : mode === 'broadcast'
                      ? 'Broadcasts'
                      : mode === 'targeted'
                      ? 'Targeted'
                      : 'Exhibition'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="text-xs border border-slate-200 rounded-lg px-2.5 py-1 bg-white text-slate-700"
              >
                <option value="all">All Statuses</option>
                <option value="submitted">Submitted (Open)</option>
                <option value="reserved">Reserved / Claimed</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>

          {/* Request Cards Grid */}
          {filteredRequests.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500">
              <p className="text-sm font-semibold">No network blood requests found matching your filter.</p>
              <p className="text-xs text-slate-400 mt-1">
                Click &quot;Seed Exhibition Network Data&quot; above to load demonstration shortage broadcasts and targeted requests.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredRequests.map((req) => {
                const isEmergency = req.urgency === 'emergency_stat';
                const isUrgent = req.urgency === 'urgent';
                const isTargetedToMe = req.requestType === 'targeted' && req.targetCenterId === currentCenterId;
                const canClaim = req.status === 'submitted';

                return (
                  <div
                    key={req.id}
                    className={`bg-white border rounded-2xl p-5 shadow-xs transition-all relative ${
                      isEmergency
                        ? 'border-rose-300 ring-2 ring-rose-100'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {/* Header */}
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm font-black px-2.5 py-1 rounded-lg ${
                            req.bloodGroup.includes('+')
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-indigo-100 text-indigo-800'
                          }`}
                        >
                          {req.bloodGroup}
                        </span>
                        <div>
                          <span className="text-xs font-bold text-slate-900 capitalize">
                            {req.componentType.replace(/_/g, ' ')}
                          </span>
                          <span className="text-xs text-slate-500 ml-1.5">
                            ({req.quantityUnits} {req.quantityUnits === 1 ? 'unit' : 'units'})
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                            isEmergency
                              ? 'bg-rose-600 text-white animate-pulse'
                              : isUrgent
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {REQUEST_URGENCY_LABELS[req.urgency]?.label || req.urgency}
                        </span>

                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${
                            req.status === 'submitted'
                              ? 'bg-emerald-100 text-emerald-800'
                              : req.status === 'reserved'
                              ? 'bg-indigo-100 text-indigo-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {req.status}
                        </span>
                      </div>
                    </div>

                    {/* Routing Type Badge */}
                    <div className="mt-3 flex items-center gap-2">
                      {req.requestType === 'shortage_broadcast' ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-1">
                          <svg className="w-3 h-3 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                          </svg>
                          Network Shortage Broadcast
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-sky-50 text-sky-700 border border-sky-200">
                          Targeted: {req.targetCenterId || 'Center'}
                        </span>
                      )}

                      {req.isExhibitionData && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                          Exhibition
                        </span>
                      )}
                    </div>

                    {/* Details */}
                    <div className="mt-3 text-xs space-y-1.5 text-slate-600">
                      <div>
                        <span className="text-slate-400 font-medium">Requester:</span>{' '}
                        <span className="font-semibold text-slate-800">{req.requesterName}</span>{' '}
                        <span className="text-[10px] text-slate-500 uppercase">({req.requesterRole})</span>
                      </div>

                      {req.clinicalIndication && (
                        <div className="p-2 bg-slate-50 rounded-lg text-[11px] text-slate-700 italic border border-slate-100">
                          &quot;{req.clinicalIndication}&quot;
                        </div>
                      )}

                      <div>
                        <span className="text-slate-400 font-medium">Delivery To:</span>{' '}
                        <span className="font-semibold text-slate-800">
                          {req.deliveryAddress.hospitalOrFacilityName}
                        </span>{' '}
                        {req.deliveryAddress.departmentOrWard && (
                          <span className="text-slate-500">({req.deliveryAddress.departmentOrWard})</span>
                        )}
                        <div className="text-[11px] text-slate-500">
                          {req.deliveryAddress.city} | Tel: {req.deliveryAddress.contactPhone}
                        </div>
                      </div>

                      {req.status === 'reserved' && (
                        <div className="p-2.5 bg-indigo-50 border border-indigo-100 rounded-lg text-[11px] text-indigo-900">
                          <div className="font-bold flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                            </svg>
                            Reserved by: {req.acceptedCenterId}
                          </div>
                          <div className="mt-1 font-mono text-[10px] text-indigo-700">
                            Assigned Units: {req.assignedUnitIds?.join(', ') || 'None'}
                          </div>
                        </div>
                      )}

                      {req.status === 'rejected' && req.rejectionReason && (
                        <div className="p-2.5 bg-rose-50 border border-rose-100 rounded-lg text-[11px] text-rose-800">
                          <strong>Rejection Note:</strong> {req.rejectionReason}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    {canClaim && (
                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                        {isTargetedToMe && (
                          <button
                            onClick={() => handleOpenReject(req)}
                            className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors"
                          >
                            Decline Order
                          </button>
                        )}
                        <button
                          onClick={() => handleOpenAccept(req)}
                          className="px-4 py-1.5 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow-2xs transition-colors flex items-center gap-1"
                        >
                          <span>Accept &amp; Lock Units</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* VIEW 2: Public Blood Bank Centers Directory */}
      {/* ------------------------------------------------------------------- */}
      {subView === 'centers' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {bloodBankCenters.map((center) => {
            const isCurrentCenter = center.id === currentCenterId;
            const stockSummary = center.availableStockSummary || {};
            const totalStock = Object.values(stockSummary).reduce((acc, val) => acc + val, 0);

            return (
              <div
                key={center.id}
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 leading-snug">{center.name}</h3>
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                        License: {center.licenseNumber}
                      </div>
                    </div>
                    {center.verificationStatus === 'verified' && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0">
                        Verified
                      </span>
                    )}
                  </div>

                  {isCurrentCenter && (
                    <div className="mt-2 inline-block text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-800">
                      ★ Active Working Center
                    </div>
                  )}

                  {/* Location & Hours */}
                  <div className="mt-3 text-xs text-slate-600 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span>
                        {center.address.city}, {center.address.state}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="font-medium text-slate-700">{center.contact.operatingHours}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-500">
                      <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      <span>{center.contact.phone}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-rose-600 font-medium">
                      <svg className="w-3.5 h-3.5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span>Emergency Hotline: {center.contact.emergencyPhone}</span>
                    </div>
                  </div>
                </div>

                {/* Stock Summary Footer */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] text-slate-400">Published Units:</span>{' '}
                    <span className="text-xs font-bold text-slate-800">{totalStock}</span>
                  </div>
                  <button
                    onClick={() => setViewingCenter(center)}
                    className="px-2.5 py-1 text-xs font-semibold text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors"
                  >
                    View Stock Breakdown →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* MODAL 1: Accept Request & Assign Inventory Units */}
      {/* ------------------------------------------------------------------- */}
      {acceptingReq && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-bold text-slate-900">Accept Network Blood Request</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Select available units to atomically lock and reserve for this order.
                </p>
              </div>
              <button
                onClick={() => setAcceptingReq(null)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            {acceptingError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
                <strong>Error:</strong> {acceptingError}
              </div>
            )}

            <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1">
              <div>
                <strong>Requested:</strong> {acceptingReq.quantityUnits} unit(s) of{' '}
                <span className="font-bold text-rose-600">{acceptingReq.bloodGroup}</span>{' '}
                {acceptingReq.componentType.replace(/_/g, ' ')}
              </div>
              <div>
                <strong>Destination:</strong> {acceptingReq.deliveryAddress.hospitalOrFacilityName}
              </div>
            </div>

            {/* Inventory Unit Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Eligible Local Inventory Units ({acceptingReq.bloodGroup} {acceptingReq.componentType}):
              </label>
              {(() => {
                const eligible = inventory.filter(
                  (u) =>
                    u.status === 'available' &&
                    u.bloodGroup === acceptingReq.bloodGroup &&
                    u.componentType === acceptingReq.componentType
                );

                if (eligible.length === 0) {
                  return (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                      No matching available units in your center inventory. You cannot accept this request until compatible units are collected and tested.
                    </div>
                  );
                }

                return (
                  <div className="max-h-48 overflow-y-auto space-y-1.5 border border-slate-200 rounded-xl p-2">
                    {eligible.map((unit) => {
                      const isSelected = selectedUnitIds.includes(unit.id);
                      return (
                        <label
                          key={unit.id}
                          className={`flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer border transition-colors ${
                            isSelected
                              ? 'bg-rose-50 border-rose-300 text-rose-900'
                              : 'bg-white border-slate-100 hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedUnitIds([...selectedUnitIds, unit.id]);
                                } else {
                                  setSelectedUnitIds(selectedUnitIds.filter((id) => id !== unit.id));
                                }
                              }}
                              className="rounded text-rose-600 focus:ring-rose-500"
                            />
                            <span className="font-mono font-semibold">{unit.id}</span>
                          </div>
                          <span className="text-[11px] text-slate-400">Expires: {unit.expiryDate.split('T')[0]}</span>
                        </label>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setAcceptingReq(null)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAccept}
                disabled={isProcessing || selectedUnitIds.length === 0}
                className="px-4 py-1.5 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-xs disabled:opacity-50"
              >
                {isProcessing ? 'Claiming & Locking...' : 'Confirm Reservation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* MODAL 2: Reject Targeted Request */}
      {/* ------------------------------------------------------------------- */}
      {rejectingReq && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900">Decline Targeted Blood Request</h3>
            <p className="text-xs text-slate-500">
              The requester will be notified and empowered to convert this order into a network-wide shortage broadcast.
            </p>

            {rejectingError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
                <strong>Error:</strong> {rejectingError}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Clinical Reason for Declining:
              </label>
              <textarea
                rows={3}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded-xl p-2.5 bg-slate-50 focus:bg-white focus:ring-1 focus:ring-rose-500 outline-hidden"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setRejectingReq(null)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReject}
                disabled={isProcessing || !rejectionReason.trim()}
                className="px-4 py-1.5 text-xs font-bold bg-slate-800 hover:bg-slate-900 text-white rounded-xl shadow-xs disabled:opacity-50"
              >
                {isProcessing ? 'Declining...' : 'Confirm Decline'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* MODAL 3: Center Stock Breakdown */}
      {/* ------------------------------------------------------------------- */}
      {viewingCenter && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-bold text-slate-900">{viewingCenter.name}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Published Available Stock Summary (Updated: {new Date(viewingCenter.updatedAt).toLocaleTimeString()})
                </p>
              </div>
              <button
                onClick={() => setViewingCenter(null)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 max-h-80 overflow-y-auto">
              {Object.entries(viewingCenter.availableStockSummary || {}).map(([key, count]) => {
                const parts = key.split('_');
                const group = parts[0];
                const comp = parts.slice(1).join(' ');
                return (
                  <div
                    key={key}
                    className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-between"
                  >
                    <div>
                      <span className="text-xs font-bold text-slate-900">{group}</span>
                      <div className="text-[10px] text-slate-500 capitalize">{comp}</div>
                    </div>
                    <span className="text-sm font-black text-rose-600">{count} units</span>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                onClick={() => setViewingCenter(null)}
                className="px-4 py-1.5 text-xs font-bold bg-slate-800 text-white rounded-xl"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
