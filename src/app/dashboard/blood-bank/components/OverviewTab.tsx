'use client';

import { BloodBankMetrics, BloodInventoryUnit, BloodRequest } from '@/lib/blood-bank/types';
import { CLINICAL_SAFETY_DISCLAIMER, REQUEST_URGENCY_LABELS } from '@/lib/blood-bank/constants';

interface OverviewTabProps {
  metrics: BloodBankMetrics;
  recentInventory: BloodInventoryUnit[];
  recentRequests: BloodRequest[];
  onNavigateTab: (tab: string) => void;
  onOpenModal: (modal: string) => void;
}

export default function OverviewTab({
  metrics,
  recentInventory,
  recentRequests,
  onNavigateTab,
  onOpenModal,
}: OverviewTabProps) {
  const statCards = [
    {
      label: 'Registered Donors',
      value: metrics.totalDonors,
      sublabel: `${metrics.eligibleDonors} currently eligible`,
      color: 'border-l-indigo-500 text-indigo-600',
      action: () => onNavigateTab('donors'),
    },
    {
      label: 'Total Donations',
      value: metrics.totalDonations,
      sublabel: 'Recorded collection sessions',
      color: 'border-l-rose-500 text-rose-600',
      action: () => onNavigateTab('donations'),
    },
    {
      label: 'Available Units',
      value: metrics.availableUnits,
      sublabel: `${metrics.quarantinedUnits} quarantined / ${metrics.expiredUnits} expired`,
      color: 'border-l-emerald-500 text-emerald-600',
      action: () => onNavigateTab('inventory'),
    },
    {
      label: 'Pending Requests',
      value: metrics.pendingRequests,
      sublabel: `${metrics.urgentRequests} urgent / STAT`,
      color: 'border-l-amber-500 text-amber-600',
      action: () => onNavigateTab('requests'),
    },
    {
      label: 'Issued Dispatches',
      value: metrics.totalDistributions,
      sublabel: 'Traceable deliveries logged',
      color: 'border-l-sky-500 text-sky-600',
      action: () => onNavigateTab('distribution'),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Mandatory Clinical Safety Banner */}
      <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-xl shadow-xs">
        <div className="flex items-start gap-3">
          <div className="text-amber-600 mt-0.5 shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-800">
              Regulatory & Clinical Safety Guardrail
            </h4>
            <p className="text-xs text-amber-900 mt-1 leading-relaxed">
              {CLINICAL_SAFETY_DISCLAIMER}
            </p>
          </div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            onClick={card.action}
            className={`bg-white rounded-xl p-5 border border-slate-100 shadow-sm border-l-4 cursor-pointer hover:shadow-md transition-shadow ${card.color}`}
          >
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">{card.label}</div>
            <div className="text-3xl font-bold text-slate-900 mt-2">{card.value}</div>
            <div className="text-xs text-slate-400 mt-1">{card.sublabel}</div>
          </div>
        ))}
      </div>

      {/* Quick Operations Bar */}
      <div className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <svg className="w-4 h-4 text-rose-500" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
          </svg>
          Direct Operational Actions
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            onClick={() => onOpenModal('donor')}
            className="flex flex-col items-center justify-center p-3.5 bg-slate-50 hover:bg-rose-50 hover:text-rose-700 text-slate-700 rounded-xl border border-slate-200 transition-colors text-xs font-medium gap-2"
          >
            <svg className="w-5 h-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
            Register Donor
          </button>
          <button
            onClick={() => onOpenModal('donation')}
            className="flex flex-col items-center justify-center p-3.5 bg-slate-50 hover:bg-rose-50 hover:text-rose-700 text-slate-700 rounded-xl border border-slate-200 transition-colors text-xs font-medium gap-2"
          >
            <svg className="w-5 h-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
            Record Donation
          </button>
          <button
            onClick={() => onOpenModal('inventory')}
            className="flex flex-col items-center justify-center p-3.5 bg-slate-50 hover:bg-rose-50 hover:text-rose-700 text-slate-700 rounded-xl border border-slate-200 transition-colors text-xs font-medium gap-2"
          >
            <svg className="w-5 h-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            Add Blood Unit
          </button>
          <button
            onClick={() => onOpenModal('request')}
            className="flex flex-col items-center justify-center p-3.5 bg-slate-50 hover:bg-rose-50 hover:text-rose-700 text-slate-700 rounded-xl border border-slate-200 transition-colors text-xs font-medium gap-2"
          >
            <svg className="w-5 h-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Submit Blood Request
          </button>
        </div>
      </div>

      {/* Two Column Grid: Pending Requests & Active Inventory */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Urgent & Active Requests */}
        <div className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-semibold text-slate-900">Active Requests</h3>
            <button
              onClick={() => onNavigateTab('requests')}
              className="text-xs font-medium text-rose-600 hover:text-rose-700"
            >
              View all ({recentRequests.length})
            </button>
          </div>

          {recentRequests.length === 0 ? (
            <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
              <p className="text-xs text-slate-500 font-medium">No active blood requests</p>
              <p className="text-xs text-slate-400 mt-0.5">Submitted hospital requests will appear here</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {recentRequests.slice(0, 4).map((req) => (
                <div
                  key={req.id}
                  className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-semibold text-slate-900">{req.requestingOrganization}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {req.quantityUnits} unit(s) • <span className="font-bold text-rose-600">{req.bloodGroup}</span> ({req.componentType.replace(/_/g, ' ')})
                    </div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${REQUEST_URGENCY_LABELS[req.urgency]?.color || 'bg-slate-200'}`}>
                    {req.urgency.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Inventory Units Quick Overview */}
        <div className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-semibold text-slate-900">Inventory Units</h3>
            <button
              onClick={() => onNavigateTab('inventory')}
              className="text-xs font-medium text-rose-600 hover:text-rose-700"
            >
              View inventory ({recentInventory.length})
            </button>
          </div>

          {recentInventory.length === 0 ? (
            <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
              <p className="text-xs text-slate-500 font-medium">No blood units in inventory</p>
              <p className="text-xs text-slate-400 mt-0.5">Units created from completed donations will be tracked here</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {recentInventory.slice(0, 4).map((unit) => (
                <div
                  key={unit.id}
                  className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-semibold text-slate-900">
                      Unit {unit.id} • <span className="text-rose-600 font-bold">{unit.bloodGroup}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {unit.volumeMl}ml • Expires: {unit.expiryDate}
                    </div>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-medium">
                    {unit.status.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

