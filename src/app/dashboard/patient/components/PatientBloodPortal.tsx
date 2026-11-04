'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BloodBankCenter,
  NetworkBloodRequest,
  BloodGroup,
  BloodComponentType,
  RequestUrgency,
  NetworkRequestStatus,
} from '@/lib/blood-bank/types';
import {
  BLOOD_GROUPS,
  BLOOD_COMPONENTS,
  REQUEST_URGENCY_LABELS,
} from '@/lib/blood-bank/constants';
import {
  fetchPublicBloodBankCenters,
  createNetworkBloodRequest,
  fetchNetworkBloodRequests,
  cancelNetworkBloodRequest,
  convertRejectedToBroadcast,
} from '@/lib/blood-bank/firestore-service';
import {
  seedExhibitionNetworkData,
  EXHIBITION_BLOOD_BANK_CENTERS,
} from '@/lib/blood-bank/exhibition-data';

interface PatientBloodPortalProps {
  currentUser: {
    uid: string;
    email?: string | null;
    name?: string;
  };
}

function formatLocalDatetime(date: Date): string {
  const localMs = date.getTime() - date.getTimezoneOffset() * 60000;
  return new Date(localMs).toISOString().slice(0, 16);
}

export default function PatientBloodPortal({ currentUser }: PatientBloodPortalProps) {
  // Navigation State
  const [activeTab, setActiveTab] = useState<'discover' | 'my_requests'>('discover');

  // Core Datasets
  const [centers, setCenters] = useState<BloodBankCenter[]>([]);
  const [myRequests, setMyRequests] = useState<NetworkBloodRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Filters State
  const [selectedGroup, setSelectedGroup] = useState<BloodGroup | 'all'>('all');
  const [selectedComponent, setSelectedComponent] = useState<BloodComponentType | 'all'>('all');
  const [selectedCity, setSelectedCity] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Requests Tracker Filter
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Request Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'targeted' | 'shortage_broadcast'>('targeted');
  const [targetCenter, setTargetCenter] = useState<BloodBankCenter | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Form State
  const [formGroup, setFormGroup] = useState<BloodGroup>('O+');
  const [formComponent, setFormComponent] = useState<BloodComponentType>('whole_blood');
  const [formQuantity, setFormQuantity] = useState<number>(1);
  const [formUrgency, setFormUrgency] = useState<RequestUrgency>('routine');
  const [formRequiredBy, setFormRequiredBy] = useState<string>('');
  const [formHospital, setFormHospital] = useState<string>('');
  const [formWard, setFormWard] = useState<string>('');
  const [formCity, setFormCity] = useState<string>('');
  const [formPhone, setFormPhone] = useState<string>('');
  const [formIndication, setFormIndication] = useState<string>('');

  // Async Action Flags
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  // Load Data
  const loadPortalData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [allCenters, userReqs] = await Promise.all([
        fetchPublicBloodBankCenters().catch(() => []),
        fetchNetworkBloodRequests({ requesterUid: currentUser.uid }).catch(() => []),
      ]);

      // If database has no centers yet, provide exhibition centers as fallback for discoverability
      if (allCenters.length === 0) {
        setCenters(EXHIBITION_BLOOD_BANK_CENTERS);
      } else {
        setCenters(allCenters);
      }
      setMyRequests(userReqs);
    } catch (err: unknown) {
      console.error('Failed to load blood portal data:', err);
      const msg = err instanceof Error ? err.message : 'Unable to connect to Blood Bank Network';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [currentUser.uid]);

  useEffect(() => {
    loadPortalData();
  }, [loadPortalData]);

  // Distinct cities for filter dropdown
  const availableCities = useMemo(() => {
    const citySet = new Set<string>();
    centers.forEach((c) => {
      if (c.address?.city) citySet.add(c.address.city);
      else if (c.location && 'city' in (c.location as unknown as Record<string, unknown>)) {
        citySet.add(String((c.location as unknown as Record<string, unknown>).city));
      }
    });
    return Array.from(citySet).sort();
  }, [centers]);

  // Calculate matching stock units for a given center based on current filters
  const getMatchingUnits = useCallback(
    (center: BloodBankCenter) => {
      const summary = center.availableStockSummary || {};
      if (selectedGroup !== 'all' && selectedComponent !== 'all') {
        const key = `${selectedGroup}_${selectedComponent}`;
        return summary[key] || 0;
      }
      if (selectedGroup !== 'all') {
        return Object.entries(summary).reduce((acc, [k, v]) => {
          if (k.startsWith(`${selectedGroup}_`)) return acc + v;
          return acc;
        }, 0);
      }
      if (selectedComponent !== 'all') {
        return Object.entries(summary).reduce((acc, [k, v]) => {
          if (k.endsWith(`_${selectedComponent}`)) return acc + v;
          return acc;
        }, 0);
      }
      return Object.values(summary).reduce((acc, v) => acc + v, 0);
    },
    [selectedGroup, selectedComponent]
  );

  // Filtered Centers
  const filteredCenters = useMemo(() => {
    return centers.filter((center) => {
      if (selectedCity !== 'all' && center.address?.city !== selectedCity) {
        return false;
      }
      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase();
        const matchesName = center.name.toLowerCase().includes(q);
        const matchesCity = (center.address?.city || '').toLowerCase().includes(q);
        const matchesLicense = (center.licenseNumber || '').toLowerCase().includes(q);
        if (!matchesName && !matchesCity && !matchesLicense) return false;
      }
      return true;
    });
  }, [centers, selectedCity, searchQuery]);

  // Filtered User Requests
  const filteredRequests = useMemo(() => {
    return myRequests.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      return true;
    });
  }, [myRequests, statusFilter]);

  // Open modal for targeted request
  const handleOpenTargetedModal = (center: BloodBankCenter) => {
    setTargetCenter(center);
    setModalMode('targeted');
    if (selectedGroup !== 'all') setFormGroup(selectedGroup);
    if (selectedComponent !== 'all') setFormComponent(selectedComponent);
    setFormQuantity(1);
    setFormUrgency('routine');
    setFormRequiredBy(
      formatLocalDatetime(new Date(Date.now() + 24 * 60 * 60 * 1000))
    );
    setFormCity(center.address?.city || '');
    setFormHospital('');
    setFormWard('');
    setFormPhone('');
    setFormIndication('');
    setModalError(null);
    setIsModalOpen(true);
  };

  // Open modal for shortage broadcast
  const handleOpenBroadcastModal = () => {
    setTargetCenter(null);
    setModalMode('shortage_broadcast');
    if (selectedGroup !== 'all') setFormGroup(selectedGroup);
    if (selectedComponent !== 'all') setFormComponent(selectedComponent);
    setFormQuantity(1);
    setFormUrgency('urgent');
    setFormRequiredBy(
      formatLocalDatetime(new Date(Date.now() + 12 * 60 * 60 * 1000))
    );
    setFormCity('');
    setFormHospital('');
    setFormWard('');
    setFormPhone('');
    setFormIndication('');
    setModalError(null);
    setIsModalOpen(true);
  };

  // Submit Blood Request
  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    // Validation
    if (!formHospital.trim()) {
      setModalError('Hospital or medical facility name is required.');
      return;
    }
    if (!formCity.trim()) {
      setModalError('City of destination is required.');
      return;
    }
    if (!formPhone.trim()) {
      setModalError('Contact phone number is required for dispatch coordination.');
      return;
    }
    if (!formRequiredBy) {
      setModalError('Required-by date and time are required.');
      return;
    }
    const requiredDate = new Date(formRequiredBy);
    if (requiredDate.getTime() <= Date.now()) {
      setModalError('Required-by date must be in the future.');
      return;
    }
    if (formQuantity < 1 || formQuantity > 50) {
      setModalError('Requested quantity must be between 1 and 50 units.');
      return;
    }

    try {
      setSubmitting(true);
      await createNetworkBloodRequest(
        {
          requesterUid: currentUser.uid,
          requesterRole: 'patient',
          requesterName: currentUser.name || currentUser.email || 'Registered Patient',
          requestType: modalMode,
          targetCenterId: modalMode === 'targeted' ? targetCenter?.id : undefined,
          bloodGroup: formGroup,
          componentType: formComponent,
          quantityUnits: Number(formQuantity),
          urgency: formUrgency,
          requiredByDate: requiredDate.toISOString(),
          clinicalIndication: formIndication.trim() || undefined,
          deliveryAddress: {
            hospitalOrFacilityName: formHospital.trim(),
            departmentOrWard: formWard.trim() || undefined,
            city: formCity.trim(),
            contactPhone: formPhone.trim(),
          },
        },
        { uid: currentUser.uid, email: currentUser.email || undefined, role: 'patient' }
      );

      setIsModalOpen(false);
      setSuccessNotice(
        modalMode === 'targeted'
          ? `Targeted request successfully transmitted to ${targetCenter?.name || 'the blood center'}.`
          : 'Shortage broadcast transmitted to all registered blood bank centers across the network.'
      );
      setTimeout(() => setSuccessNotice(null), 5000);
      await loadPortalData();
      setActiveTab('my_requests');
    } catch (err: unknown) {
      console.error('Failed to submit network request:', err);
      const msg = err instanceof Error ? err.message : 'Failed to transmit network request.';
      setModalError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // Cancel Request
  const handleCancelRequest = async (requestId: string) => {
    if (!window.confirm('Are you sure you want to cancel this pending blood request?')) return;
    try {
      setActionInProgressId(requestId);
      await cancelNetworkBloodRequest(requestId, { uid: currentUser.uid });
      setSuccessNotice('Blood request cancelled successfully.');
      setTimeout(() => setSuccessNotice(null), 4000);
      await loadPortalData();
    } catch (err: unknown) {
      console.error('Failed to cancel request:', err);
      const msg = err instanceof Error ? err.message : 'Could not cancel request.';
      alert(`Cancellation Error: ${msg}`);
    } finally {
      setActionInProgressId(null);
    }
  };

  // Convert Rejected Targeted Request to Shortage Broadcast
  const handleConvertToBroadcast = async (requestId: string) => {
    try {
      setActionInProgressId(requestId);
      await convertRejectedToBroadcast(requestId, { uid: currentUser.uid });
      setSuccessNotice('Request successfully converted to network shortage broadcast!');
      setTimeout(() => setSuccessNotice(null), 4000);
      await loadPortalData();
    } catch (err: unknown) {
      console.error('Failed to convert to broadcast:', err);
      const msg = err instanceof Error ? err.message : 'Could not convert request.';
      alert(`Conversion Error: ${msg}`);
    } finally {
      setActionInProgressId(null);
    }
  };

  // Seed Exhibition Dataset for demonstration
  const handleSeedDemoData = async () => {
    try {
      setSeeding(true);
      await seedExhibitionNetworkData();
      setSuccessNotice('Exhibition centers and demonstration stock loaded successfully!');
      setTimeout(() => setSuccessNotice(null), 4000);
      await loadPortalData();
    } catch (err: unknown) {
      console.error('Failed to seed exhibition data:', err);
      const msg = err instanceof Error ? err.message : 'Failed to seed exhibition data.';
      alert(`Seeding Error: ${msg}`);
    } finally {
      setSeeding(false);
    }
  };

  // Status Badge Helper
  const renderStatusBadge = (status: NetworkRequestStatus) => {
    switch (status) {
      case 'submitted':
        return (
          <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
            Submitted (Awaiting Claim)
          </span>
        );
      case 'accepted':
      case 'reserved':
        return (
          <span className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>
            Reserved by Center
          </span>
        );
      case 'dispatched':
        return (
          <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-ping"></span>
            Dispatched (In Transit)
          </span>
        );
      case 'fulfilled':
        return (
          <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold uppercase tracking-wider">
            ✓ Fulfilled
          </span>
        );
      case 'rejected':
        return (
          <span className="px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold uppercase tracking-wider">
            ✕ Declined by Target Center
          </span>
        );
      case 'cancelled':
        return (
          <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200 text-xs font-bold uppercase tracking-wider">
            Cancelled
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-medium capitalize">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Clinical Safety & Compatibility Notice Banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 sm:p-5 shadow-2xs">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900">
              Mandatory Clinical Safety Notice
            </h3>
            <p className="text-xs sm:text-sm text-amber-800 mt-1 leading-relaxed">
              The platform handles availability search, inter-facility logistics, and anti-collision
              reservation locks. Final ABO/Rh crossmatching, antibody screening, and transfusion compatibility
              are verified physically by qualified laboratory staff.
            </p>
          </div>
        </div>
      </div>

      {/* Success / Error Alerts */}
      {successNotice && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs sm:text-sm text-emerald-800 flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
            <span>{successNotice}</span>
          </div>
          <button
            onClick={() => setSuccessNotice(null)}
            className="text-emerald-600 hover:text-emerald-900 font-bold ml-4"
          >
            &times;
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs sm:text-sm text-rose-800 flex items-center justify-between shadow-2xs">
          <span><strong>Notice:</strong> {error}</span>
          <button
            onClick={loadPortalData}
            className="text-xs font-bold text-rose-700 underline hover:text-rose-900 ml-4"
          >
            Retry
          </button>
        </div>
      )}

      {/* Top Header & Action Controls */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-600 text-white flex items-center justify-center font-black text-sm shadow-xs">
              🩸
            </div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              Patient Blood Requirement &amp; Discovery Portal
            </h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200 uppercase">
              Shared Network
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Search regional verified blood banks, examine real-time unit availability, order targeted units, or broadcast emergency shortages.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleOpenBroadcastModal}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
            </svg>
            <span>Broadcast Shortage</span>
          </button>

          <button
            onClick={handleSeedDemoData}
            disabled={seeding}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 disabled:opacity-50"
            title="Populate demo blood banks and stock summary for testing"
          >
            {seeding ? (
              <span className="w-3.5 h-3.5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin"></span>
            ) : (
              <span>✨</span>
            )}
            <span>Seed Demo Data</span>
          </button>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex border-b border-slate-200 gap-6">
        <button
          onClick={() => setActiveTab('discover')}
          className={`pb-3 text-xs sm:text-sm font-bold transition-colors relative flex items-center gap-2 ${
            activeTab === 'discover'
              ? 'text-rose-600 border-b-2 border-rose-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>🔍</span>
          <span>Find Blood &amp; Registered Centers ({centers.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('my_requests')}
          className={`pb-3 text-xs sm:text-sm font-bold transition-colors relative flex items-center gap-2 ${
            activeTab === 'my_requests'
              ? 'text-rose-600 border-b-2 border-rose-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>📋</span>
          <span>My Requirement Requests ({myRequests.length})</span>
          {myRequests.some((r) => r.status === 'submitted') && (
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
          )}
        </button>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* TAB 1: Search & Filter Controls + Centers Availability Grid         */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === 'discover' && (
        <div className="space-y-6">
          {/* Filter Bar */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-4">
            <div className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <svg className="w-4 h-4 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filter Regional Stock Discovery
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Blood Group */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Blood Group</label>
                <select
                  value={selectedGroup}
                  onChange={(e) => setSelectedGroup(e.target.value as BloodGroup | 'all')}
                  className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-rose-500 outline-hidden font-medium text-slate-800"
                >
                  <option value="all">All Blood Groups</option>
                  {BLOOD_GROUPS.map((bg) => (
                    <option key={bg} value={bg}>
                      {bg}
                    </option>
                  ))}
                </select>
              </div>

              {/* Component Type */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Component Type</label>
                <select
                  value={selectedComponent}
                  onChange={(e) => setSelectedComponent(e.target.value as BloodComponentType | 'all')}
                  className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-rose-500 outline-hidden font-medium text-slate-800 capitalize"
                >
                  <option value="all">All Components</option>
                  {BLOOD_COMPONENTS.map((c) => (
                    <option key={c.type} value={c.type}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* City / Region */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">City / Region</label>
                <select
                  value={selectedCity}
                  onChange={(e) => setSelectedCity(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-rose-500 outline-hidden font-medium text-slate-800"
                >
                  <option value="all">All Cities</option>
                  {availableCities.map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>
              </div>

              {/* Search */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Search Facility</label>
                <input
                  type="text"
                  placeholder="Facility name or address..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-rose-500 outline-hidden text-slate-800"
                />
              </div>
            </div>

            {/* Active Filter Indicators */}
            {(selectedGroup !== 'all' || selectedComponent !== 'all' || selectedCity !== 'all' || searchQuery) && (
              <div className="flex items-center gap-2 pt-2 border-t border-slate-100 flex-wrap text-xs">
                <span className="text-slate-500">Active criteria:</span>
                {selectedGroup !== 'all' && (
                  <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 font-bold">
                    Group: {selectedGroup}
                  </span>
                )}
                {selectedComponent !== 'all' && (
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 capitalize font-medium">
                    {selectedComponent.replace(/_/g, ' ')}
                  </span>
                )}
                {selectedCity !== 'all' && (
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium">
                    City: {selectedCity}
                  </span>
                )}
                <button
                  onClick={() => {
                    setSelectedGroup('all');
                    setSelectedComponent('all');
                    setSelectedCity('all');
                    setSearchQuery('');
                  }}
                  className="text-rose-600 hover:text-rose-800 font-semibold underline text-xs ml-auto"
                >
                  Reset Filters
                </button>
              </div>
            )}
          </div>

          {/* Centers Grid */}
          {loading ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
              <div className="w-10 h-10 border-4 border-rose-200 border-t-rose-600 rounded-full animate-spin mx-auto mb-3"></div>
              <p className="text-xs font-semibold text-slate-500">Discovering verified blood bank centers...</p>
            </div>
          ) : filteredCenters.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-3">
              <div className="text-3xl">🏥</div>
              <h3 className="text-sm font-bold text-slate-800">No blood bank centers match your search criteria.</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Try widening your city or blood group filter, or broadcast your need across the network so available centers can claim it.
              </p>
              <button
                onClick={handleOpenBroadcastModal}
                className="mt-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-xs"
              >
                Broadcast Shortage Instead
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {filteredCenters.map((center) => {
                const matchingUnits = getMatchingUnits(center);
                const isExhibition = center.isExhibitionCenter;

                return (
                  <div
                    key={center.id}
                    className="bg-white border border-slate-200 hover:border-slate-300 rounded-2xl p-5 shadow-xs transition-all flex flex-col justify-between"
                  >
                    <div>
                      {/* Center Header */}
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-base font-bold text-slate-900 leading-snug">
                              {center.name}
                            </h3>
                            {isExhibition && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200">
                                Exhibition Demo
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                            License: {center.licenseNumber}
                          </div>
                        </div>

                        {center.verificationStatus === 'verified' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0">
                            ✓ Verified
                          </span>
                        )}
                      </div>

                      {/* Location & Contact Info */}
                      <div className="mt-3 text-xs text-slate-600 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          <span>
                            {center.address?.street ? `${center.address.street}, ` : ''}
                            {center.address?.city || ''}, {center.address?.state || ''} {center.address?.postalCode || ''}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="font-medium text-slate-700">
                            {center.contact?.operatingHours || '24/7 Service'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                          <span>Tel: {center.contact?.phone || 'Available Upon Request'}</span>
                        </div>

                        {center.contact?.emergencyPhone && (
                          <div className="flex items-center gap-1.5 text-rose-600 font-semibold text-[11px]">
                            <svg className="w-3.5 h-3.5 text-rose-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            <span>Emergency STAT: {center.contact.emergencyPhone}</span>
                          </div>
                        )}
                      </div>

                      {/* Stock Summary Metrics Box */}
                      <div className="mt-4 p-3 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-between">
                        <div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            {selectedGroup !== 'all' || selectedComponent !== 'all'
                              ? `Matching Stock (${selectedGroup !== 'all' ? selectedGroup : 'All'} ${
                                  selectedComponent !== 'all' ? selectedComponent.replace(/_/g, ' ') : ''
                                })`
                              : 'Total Verified Inventory'}
                          </div>
                          <div className="text-xl font-black text-slate-900 mt-0.5">
                            {matchingUnits}{' '}
                            <span className="text-xs font-semibold text-slate-500">
                              {matchingUnits === 1 ? 'unit' : 'units'} available
                            </span>
                          </div>
                        </div>

                        {matchingUnits > 0 ? (
                          <span className="px-2 py-1 rounded-md bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                            In Stock
                          </span>
                        ) : (
                          <span className="px-2 py-1 rounded-md bg-rose-100 text-rose-700 text-[11px] font-bold">
                            Shortage / 0
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action Footer */}
                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                      <div className="text-[11px] text-slate-400">
                        Updated:{' '}
                        {center.updatedAt ? new Date(center.updatedAt).toLocaleDateString() : 'Active'}
                      </div>

                      {matchingUnits > 0 ? (
                        <button
                          onClick={() => handleOpenTargetedModal(center)}
                          className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
                        >
                          <span>Request Targeted Units</span>
                          <span>→</span>
                        </button>
                      ) : (
                        <button
                          onClick={handleOpenBroadcastModal}
                          className="px-3.5 py-1.5 bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-700 text-xs font-semibold rounded-xl transition-colors border border-slate-200"
                        >
                          Broadcast Shortage
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 2: My Blood Requirement Requests Tracker                        */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === 'my_requests' && (
        <div className="space-y-4">
          {/* Status Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 border border-slate-200 rounded-xl">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600">Filter Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2.5 py-1 bg-white text-slate-700 font-medium"
              >
                <option value="all">All ({myRequests.length})</option>
                <option value="submitted">Submitted / Open</option>
                <option value="reserved">Reserved / Claimed</option>
                <option value="dispatched">Dispatched</option>
                <option value="fulfilled">Fulfilled</option>
                <option value="rejected">Declined</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <button
              onClick={handleOpenBroadcastModal}
              className="px-3 py-1.5 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow-2xs"
            >
              + New Requirement Request
            </button>
          </div>

          {/* List of Requests */}
          {filteredRequests.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-500 space-y-3">
              <div className="text-3xl">📋</div>
              <h3 className="text-sm font-bold text-slate-800">No blood requirement requests found.</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                When you request blood units from a specific center or broadcast a regional shortage, your orders will appear here with live tracking.
              </p>
              <button
                onClick={() => setActiveTab('discover')}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-xl shadow-xs"
              >
                Browse Regional Centers
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredRequests.map((req) => {
                const isEmergency = req.urgency === 'emergency_stat';
                const isUrgent = req.urgency === 'urgent';
                const isActing = actionInProgressId === req.id;

                return (
                  <div
                    key={req.id}
                    className={`bg-white border rounded-2xl p-5 shadow-xs transition-all ${
                      isEmergency
                        ? 'border-rose-300 ring-2 ring-rose-100'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-3">
                      <div>
                        {/* Blood Group and Routing Badge */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-sm font-black px-2.5 py-1 rounded-lg ${
                              req.bloodGroup.includes('+')
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-indigo-100 text-indigo-800'
                            }`}
                          >
                            {req.bloodGroup}
                          </span>
                          <span className="text-sm font-bold text-slate-900 capitalize">
                            {req.componentType.replace(/_/g, ' ')}
                          </span>
                          <span className="text-xs text-slate-500">
                            ({req.quantityUnits} {req.quantityUnits === 1 ? 'unit' : 'units'})
                          </span>

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

                          {req.requestType === 'shortage_broadcast' ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200">
                              Network Shortage Broadcast
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-sky-50 text-sky-700 border border-sky-200">
                              Targeted Order: {req.targetCenterId || 'Center'}
                            </span>
                          )}
                        </div>

                        {/* Request ID and Timestamp */}
                        <div className="text-[11px] font-mono text-slate-400 mt-1">
                          Ref: {req.id} • Placed {new Date(req.createdAt).toLocaleString()}
                        </div>
                      </div>

                      {/* Status Badge */}
                      <div className="shrink-0">{renderStatusBadge(req.status)}</div>
                    </div>

                    {/* Delivery & Clinical Details */}
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs bg-slate-50 p-3 rounded-xl border border-slate-100 text-slate-700">
                      <div>
                        <span className="font-semibold text-slate-500">Destination:</span>{' '}
                        <span className="font-bold text-slate-900">
                          {req.deliveryAddress?.hospitalOrFacilityName}
                        </span>
                        {req.deliveryAddress?.departmentOrWard && (
                          <span className="text-slate-600"> ({req.deliveryAddress.departmentOrWard})</span>
                        )}
                        <div className="text-[11px] text-slate-500">
                          {req.deliveryAddress?.city} • Contact: {req.deliveryAddress?.contactPhone}
                        </div>
                      </div>

                      <div>
                        <span className="font-semibold text-slate-500">Required By:</span>{' '}
                        <span className="font-bold text-slate-900">
                          {new Date(req.requiredByDate).toLocaleString()}
                        </span>
                        {req.clinicalIndication && (
                          <div className="text-[11px] text-slate-600 italic mt-0.5">
                            &quot;{req.clinicalIndication}&quot;
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Active Reservation / Accepted Details */}
                    {req.status === 'reserved' && (
                      <div className="mt-3 p-3 bg-indigo-50 border border-indigo-100 rounded-xl text-xs text-indigo-900 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-indigo-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                          </svg>
                          <span>
                            <strong>Inventory Locked:</strong> Claimed by regional blood bank{' '}
                            <span className="font-mono font-bold">{req.acceptedCenterId}</span>. Units reserved and prepared for cold chain transfer.
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Rejection / Decline Details */}
                    {req.status === 'rejected' && (
                      <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 space-y-2">
                        <div>
                          <strong>Reason for Decline:</strong>{' '}
                          <span>{req.rejectionReason || 'Center unable to fulfill requested component.'}</span>
                        </div>
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[11px] text-rose-600">
                            You can broadcast this request to all other centers in the network with one click.
                          </span>
                          <button
                            onClick={() => handleConvertToBroadcast(req.id)}
                            disabled={isActing}
                            className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-xs shadow-2xs disabled:opacity-50"
                          >
                            {isActing ? 'Converting...' : 'Convert to Shortage Broadcast →'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Cancel Action for Submitted Requests */}
                    {req.status === 'submitted' && (
                      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-end">
                        <button
                          onClick={() => handleCancelRequest(req.id)}
                          disabled={isActing}
                          className="px-3 py-1 text-xs font-semibold text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition-colors border border-rose-200 disabled:opacity-50"
                        >
                          {isActing ? 'Cancelling...' : 'Cancel Request'}
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
      {/* INTERACTIVE REQUEST MODAL (Targeted vs Shortage Broadcast)           */}
      {/* ------------------------------------------------------------------- */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {modalMode === 'targeted'
                    ? `Request Targeted Units from ${targetCenter?.name || 'Center'}`
                    : 'Broadcast Shortage Across Network'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {modalMode === 'targeted'
                    ? 'Direct request submitted to the selected center with an inventory reservation hold.'
                    : 'Transmitted to all registered regional blood centers. The first center with stock can claim and reserve units.'}
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
              >
                &times;
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
                <strong>Error:</strong> {modalError}
              </div>
            )}

            <form onSubmit={handleSubmitRequest} className="space-y-4">
              {/* Request Type Toggle */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Request Routing Type</label>
                <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setModalMode('targeted')}
                    className={`py-1.5 text-xs font-bold rounded-lg transition-colors ${
                      modalMode === 'targeted'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Targeted Order
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalMode('shortage_broadcast')}
                    className={`py-1.5 text-xs font-bold rounded-lg transition-colors ${
                      modalMode === 'shortage_broadcast'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Shortage Broadcast
                  </button>
                </div>
              </div>

              {/* Blood Group and Component */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Required Blood Group</label>
                  <select
                    value={formGroup}
                    onChange={(e) => setFormGroup(e.target.value as BloodGroup)}
                    className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-rose-500 outline-hidden font-bold text-slate-800"
                  >
                    {BLOOD_GROUPS.map((bg) => (
                      <option key={bg} value={bg}>
                        {bg}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Blood Component</label>
                  <select
                    value={formComponent}
                    onChange={(e) => setFormComponent(e.target.value as BloodComponentType)}
                    className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-rose-500 outline-hidden capitalize text-slate-800"
                  >
                    {BLOOD_COMPONENTS.map((c) => (
                      <option key={c.type} value={c.type}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Quantity & Urgency */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Quantity (Units)</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={formQuantity}
                    onChange={(e) => setFormQuantity(Math.max(1, Math.min(50, Number(e.target.value))))}
                    className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-rose-500 outline-hidden font-bold text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Clinical Urgency</label>
                  <select
                    value={formUrgency}
                    onChange={(e) => setFormUrgency(e.target.value as RequestUrgency)}
                    className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-rose-500 outline-hidden font-semibold text-slate-800"
                  >
                    <option value="routine">Routine</option>
                    <option value="urgent">Urgent</option>
                    <option value="emergency_stat">EMERGENCY (STAT)</option>
                  </select>
                </div>
              </div>

              {/* Required By Date/Time */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Required By Date &amp; Time</label>
                <input
                  type="datetime-local"
                  value={formRequiredBy}
                  onChange={(e) => setFormRequiredBy(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-rose-500 outline-hidden text-slate-800"
                />
              </div>

              {/* Delivery Details */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-3">
                <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                  Delivery Destination Details
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Receiving Hospital / Facility Name *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Metropolis General Hospital"
                    value={formHospital}
                    onChange={(e) => setFormHospital(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-800 outline-hidden"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Department / Ward</label>
                    <input
                      type="text"
                      placeholder="e.g. ICU / Surgical Suite 2"
                      value={formWard}
                      onChange={(e) => setFormWard(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-800 outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">City *</label>
                    <input
                      type="text"
                      placeholder="e.g. Metropolis"
                      value={formCity}
                      onChange={(e) => setFormCity(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-800 outline-hidden"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Coordinator Contact Phone *
                  </label>
                  <input
                    type="tel"
                    placeholder="e.g. +1 (555) 012-3456"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-800 outline-hidden"
                  />
                </div>
              </div>

              {/* Clinical Indication */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Clinical Indication / Physician Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Scheduled elective surgery, severe acute anemia, oncology support..."
                  value={formIndication}
                  onChange={(e) => setFormIndication(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-xl p-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-rose-500 outline-hidden text-slate-800 resize-none"
                />
              </div>

              {/* Form Buttons */}
              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-xs disabled:opacity-50"
                >
                  {submitting ? 'Transmitting Request...' : 'Confirm & Transmit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
