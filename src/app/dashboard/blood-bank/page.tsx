'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import {
  BloodDonor,
  BloodDonation,
  BloodInventoryUnit,
  BloodRequest,
  BloodDistribution,
  BloodBankAuditEvent,
  InventoryUnitStatus,
  RequestStatus,
} from '@/lib/blood-bank/types';
import {
  fetchDonors,
  fetchDonations,
  fetchInventory,
  fetchRequests,
  fetchDistributions,
  fetchAuditLogs,
  createDonor,
  createDonation,
  createInventoryUnit,
  updateInventoryStatus,
  createBloodRequest,
  updateRequestStatus,
  createDistribution,
  calculateMetrics,
} from '@/lib/blood-bank/firestore-service';

import AccessDenied from './components/AccessDenied';
import OverviewTab from './components/OverviewTab';
import DonorsTab from './components/DonorsTab';
import DonationsTab from './components/DonationsTab';
import InventoryTab from './components/InventoryTab';
import RequestsTab from './components/RequestsTab';
import DistributionTab from './components/DistributionTab';
import ReportsTab from './components/ReportsTab';

export default function BloodBankPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<string>('overview');
  const [dataLoading, setDataLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Collections state
  const [donors, setDonors] = useState<BloodDonor[]>([]);
  const [donations, setDonations] = useState<BloodDonation[]>([]);
  const [inventory, setInventory] = useState<BloodInventoryUnit[]>([]);
  const [requests, setRequests] = useState<BloodRequest[]>([]);
  const [distributions, setDistributions] = useState<BloodDistribution[]>([]);
  const [auditLogs, setAuditLogs] = useState<BloodBankAuditEvent[]>([]);

  // Modals state
  const [activeModal, setActiveModal] = useState<string | null>(null);

  // Load all blood bank datasets
  const loadAllData = useCallback(async () => {
    try {
      setDataLoading(true);
      setErrorMessage(null);
      const [dList, donList, invList, reqList, distList, logList] = await Promise.all([
        fetchDonors(),
        fetchDonations(),
        fetchInventory(),
        fetchRequests(),
        fetchDistributions(),
        fetchAuditLogs(),
      ]);
      setDonors(dList);
      setDonations(donList);
      setInventory(invList);
      setRequests(reqList);
      setDistributions(distList);
      setAuditLogs(logList);
    } catch (err: unknown) {
      console.error('Failed to load blood bank data:', err);
      const msg = err instanceof Error ? err.message : 'Failed to retrieve blood bank records';
      setErrorMessage(msg);
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        router.replace('/login');
      } else if (user.role === 'blood_bank') {
        loadAllData();
      }
    }
  }, [user, authLoading, router, loadAllData]);

  // Loading Screen
  if (authLoading || (user?.role === 'blood_bank' && dataLoading)) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-rose-200 border-t-rose-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
            Loading Blood Bank System...
          </p>
        </div>
      </div>
    );
  }

  // Access Guard: Strict Role Authorization
  if (!user || user.role !== 'blood_bank') {
    return <AccessDenied userRole={user?.role} userEmail={user?.email} />;
  }

  // Calculate high-level metrics
  const metrics = calculateMetrics(donors, donations, inventory, requests, distributions);

  // Tab definitions
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'donors', label: `Donors (${donors.length})` },
    { id: 'donations', label: `Donations (${donations.length})` },
    { id: 'inventory', label: `Inventory (${inventory.length})` },
    { id: 'requests', label: `Requests (${requests.length})` },
    { id: 'distribution', label: `Distribution (${distributions.length})` },
    { id: 'reports', label: 'Reports & Audit' },
  ];

  // Action handlers
  const handleRegisterDonor = async (payload: Parameters<typeof createDonor>[0]) => {
    await createDonor(payload, { uid: user.uid, email: user.email || undefined });
    await loadAllData();
  };

  const handleRecordDonation = async (payload: Parameters<typeof createDonation>[0]) => {
    await createDonation(payload, { uid: user.uid, email: user.email || undefined });
    await loadAllData();
  };

  const handleAddInventoryUnit = async (payload: Parameters<typeof createInventoryUnit>[0]) => {
    await createInventoryUnit(payload, { uid: user.uid, email: user.email || undefined });
    await loadAllData();
  };

  const handleUpdateInventoryStatus = async (
    unitId: string,
    newStatus: InventoryUnitStatus,
    reason?: string
  ) => {
    await updateInventoryStatus(unitId, newStatus, reason, { uid: user.uid, email: user.email || undefined });
    await loadAllData();
  };

  const handleSubmitRequest = async (payload: Parameters<typeof createBloodRequest>[0]) => {
    await createBloodRequest(payload, { uid: user.uid, email: user.email || undefined });
    await loadAllData();
  };

  const handleUpdateRequestStatus = async (
    requestId: string,
    status: RequestStatus,
    notes?: string
  ) => {
    await updateRequestStatus(requestId, status, notes, { uid: user.uid, email: user.email || undefined });
    await loadAllData();
  };

  const handleIssueDistribution = async (payload: Parameters<typeof createDistribution>[0]) => {
    await createDistribution(payload, { uid: user.uid, email: user.email || undefined });
    await loadAllData();
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-16">
      {/* Header Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center font-bold shadow-sm">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-bold text-slate-900 tracking-tight">
                    MEDICORE-AI
                  </h1>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200 uppercase tracking-wider">
                    Blood Bank
                  </span>
                </div>
                <p className="text-xs text-slate-500">Transfusion Safety & Blood Product Management</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <div className="text-xs font-semibold text-slate-900">{user.email}</div>
                <div className="text-[10px] font-mono text-rose-600 font-semibold uppercase">
                  Verified Role: {user.role}
                </div>
              </div>
              <button
                onClick={() => router.push('/dashboard')}
                className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 font-medium bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Exit to Portal
              </button>
            </div>
          </div>

          {/* Tab Navigation */}
          <nav className="flex space-x-1 sm:space-x-4 overflow-x-auto no-scrollbar border-t border-slate-100 py-2">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Content Body */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {errorMessage && (
          <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-between">
            <div>
              <strong>Error:</strong> {errorMessage}
            </div>
            <button
              onClick={loadAllData}
              className="text-xs font-semibold text-rose-700 underline ml-4 hover:text-rose-900"
            >
              Retry
            </button>
          </div>
        )}

        {activeTab === 'overview' && (
          <OverviewTab
            metrics={metrics}
            recentInventory={inventory}
            recentRequests={requests}
            onNavigateTab={setActiveTab}
            onOpenModal={setActiveModal}
          />
        )}

        {activeTab === 'donors' && (
          <DonorsTab
            donors={donors}
            isRegisterOpen={activeModal === 'donor'}
            onCloseRegister={() => setActiveModal(null)}
            onOpenRegister={() => setActiveModal('donor')}
            onSubmitRegister={handleRegisterDonor}
            staffUid={user.uid}
          />
        )}

        {activeTab === 'donations' && (
          <DonationsTab
            donations={donations}
            donors={donors}
            isRecordOpen={activeModal === 'donation'}
            onCloseRecord={() => setActiveModal(null)}
            onOpenRecord={() => setActiveModal('donation')}
            onSubmitRecord={handleRecordDonation}
            staffUid={user.uid}
          />
        )}

        {activeTab === 'inventory' && (
          <InventoryTab
            inventory={inventory}
            donations={donations}
            isAddUnitOpen={activeModal === 'inventory'}
            onCloseAddUnit={() => setActiveModal(null)}
            onOpenAddUnit={() => setActiveModal('inventory')}
            onSubmitAddUnit={handleAddInventoryUnit}
            onUpdateStatus={handleUpdateInventoryStatus}
            staffUid={user.uid}
          />
        )}

        {activeTab === 'requests' && (
          <RequestsTab
            requests={requests}
            isSubmitOpen={activeModal === 'request'}
            onCloseSubmit={() => setActiveModal(null)}
            onOpenSubmit={() => setActiveModal('request')}
            onSubmitRequest={handleSubmitRequest}
            onUpdateRequestStatus={handleUpdateRequestStatus}
            staffUid={user.uid}
          />
        )}

        {activeTab === 'distribution' && (
          <DistributionTab
            distributions={distributions}
            inventory={inventory}
            requests={requests}
            isIssueOpen={activeModal === 'distribution'}
            onCloseIssue={() => setActiveModal(null)}
            onOpenIssue={() => setActiveModal('distribution')}
            onSubmitIssue={handleIssueDistribution}
            staffUid={user.uid}
          />
        )}

        {activeTab === 'reports' && (
          <ReportsTab
            auditLogs={auditLogs}
            inventory={inventory}
            metrics={metrics}
          />
        )}
      </main>
    </div>
  );
}

