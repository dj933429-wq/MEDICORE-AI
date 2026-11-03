'use client';

import { useState } from 'react';
import {
  BloodInventoryUnit,
  BloodDonation,
  BloodGroup,
  BloodComponentType,
  InventoryUnitStatus,
} from '@/lib/blood-bank/types';
import {
  BLOOD_GROUPS,
  BLOOD_COMPONENTS,
  INVENTORY_STATUS_LABELS,
} from '@/lib/blood-bank/constants';
import { isValidInventoryTransition } from '@/lib/blood-bank/validation';

interface InventoryTabProps {
  inventory: BloodInventoryUnit[];
  donations: BloodDonation[];
  isAddUnitOpen: boolean;
  onCloseAddUnit: () => void;
  onOpenAddUnit: () => void;
  onSubmitAddUnit: (data: Omit<BloodInventoryUnit, 'centerId' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onUpdateStatus: (unitId: string, newStatus: InventoryUnitStatus, reason?: string) => Promise<void>;
  staffUid: string;
}

export default function InventoryTab({
  inventory,
  donations,
  isAddUnitOpen,
  onCloseAddUnit,
  onOpenAddUnit,
  onSubmitAddUnit,
  onUpdateStatus,
}: InventoryTabProps) {
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedComponent, setSelectedComponent] = useState<string>('all');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Status transition modal
  const [statusModalUnit, setStatusModalUnit] = useState<BloodInventoryUnit | null>(null);
  const [nextStatus, setNextStatus] = useState<InventoryUnitStatus>('available');
  const [statusReason, setStatusReason] = useState('');
  const [transitionError, setTransitionError] = useState<string | null>(null);

  // Add Unit Form State
  const [formData, setFormData] = useState({
    id: '',
    donationId: '',
    bloodGroup: 'O+' as BloodGroup,
    componentType: 'whole_blood' as BloodComponentType,
    collectionDate: new Date().toISOString().split('T')[0],
    expiryDate: '',
    volumeMl: 450,
    storageLocation: 'Cold Room 1 - Shelf A-1',
    status: 'available' as InventoryUnitStatus,
  });

  // Calculate inventory counts per blood group (available only)
  const groupCounts: Record<BloodGroup, number> = {
    'A+': 0, 'A-': 0, 'B+': 0, 'B-': 0, 'AB+': 0, 'AB-': 0, 'O+': 0, 'O-': 0,
  };
  inventory.forEach((u) => {
    if (u.status === 'available') {
      groupCounts[u.bloodGroup] = (groupCounts[u.bloodGroup] || 0) + 1;
    }
  });

  const filteredInventory = inventory.filter((u) => {
    const matchesGroup = selectedGroup === 'all' || u.bloodGroup === selectedGroup;
    const matchesStatus = selectedStatus === 'all' || u.status === selectedStatus;
    const matchesComp = selectedComponent === 'all' || u.componentType === selectedComponent;
    return matchesGroup && matchesStatus && matchesComp;
  });

  const handleComponentChange = (comp: BloodComponentType) => {
    const compSpec = BLOOD_COMPONENTS.find((c) => c.type === comp);
    const shelfLife = compSpec ? compSpec.defaultShelfLifeDays : 35;
    const colDate = formData.collectionDate || new Date().toISOString().split('T')[0];
    const exp = new Date(colDate);
    exp.setDate(exp.getDate() + shelfLife);

    setFormData({
      ...formData,
      componentType: comp,
      volumeMl: compSpec ? compSpec.standardVolumeMl : 450,
      expiryDate: exp.toISOString().split('T')[0],
    });
  };

  const handleDonationSelect = (donId: string) => {
    const don = donations.find((d) => d.id === donId);
    if (don) {
      const colDate = don.donationDate.split('T')[0];
      const compSpec = BLOOD_COMPONENTS.find((c) => c.type === formData.componentType);
      const shelfLife = compSpec ? compSpec.defaultShelfLifeDays : 35;
      const exp = new Date(colDate);
      exp.setDate(exp.getDate() + shelfLife);

      setFormData({
        ...formData,
        donationId: don.id,
        bloodGroup: don.bloodGroup,
        collectionDate: colDate,
        expiryDate: exp.toISOString().split('T')[0],
        id: `UNIT-${don.bloodGroup.replace('+', 'P').replace('-', 'N')}-${Date.now().toString().slice(-6)}`,
      });
    } else {
      setFormData({ ...formData, donationId: donId });
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);

    const don = donations.find((d) => d.id === formData.donationId);
    if (!don) {
      setFormError('Please select a valid originating donation session.');
      setSubmitting(false);
      return;
    }

    try {
      await onSubmitAddUnit({
        id: formData.id.trim(),
        donationId: don.id,
        donorId: don.donorId,
        bloodGroup: formData.bloodGroup,
        componentType: formData.componentType,
        collectionDate: formData.collectionDate,
        expiryDate: formData.expiryDate,
        volumeMl: Number(formData.volumeMl),
        storageLocation: formData.storageLocation.trim(),
        status: formData.status,
      });

      setFormData({
        id: '',
        donationId: '',
        bloodGroup: 'O+',
        componentType: 'whole_blood',
        collectionDate: new Date().toISOString().split('T')[0],
        expiryDate: '',
        volumeMl: 450,
        storageLocation: 'Cold Room 1 - Shelf A-1',
        status: 'available',
      });
      onCloseAddUnit();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add inventory unit';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTransitionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusModalUnit) return;
    setSubmitting(true);
    setTransitionError(null);

    if (!isValidInventoryTransition(statusModalUnit.status, nextStatus)) {
      setTransitionError(`Transition from ${statusModalUnit.status} to ${nextStatus} is prohibited.`);
      setSubmitting(false);
      return;
    }

    try {
      await onUpdateStatus(statusModalUnit.id, nextStatus, statusReason.trim() || undefined);
      setStatusModalUnit(null);
      setStatusReason('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update status';
      setTransitionError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Blood Group Stock Summary Pills */}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {BLOOD_GROUPS.map((bg) => (
          <div
            key={bg}
            onClick={() => setSelectedGroup(selectedGroup === bg ? 'all' : bg)}
            className={`p-3 rounded-xl border text-center cursor-pointer transition-all ${
              selectedGroup === bg
                ? 'bg-rose-600 text-white border-rose-600 shadow-md ring-2 ring-rose-300'
                : 'bg-white text-slate-800 border-slate-100 hover:border-rose-200'
            }`}
          >
            <div className="text-xs font-bold tracking-wider">{bg}</div>
            <div className={`text-xl font-extrabold mt-1 ${selectedGroup === bg ? 'text-white' : 'text-slate-900'}`}>
              {groupCounts[bg]}
            </div>
            <div className={`text-[10px] ${selectedGroup === bg ? 'text-rose-100' : 'text-slate-400'}`}>
              available
            </div>
          </div>
        ))}
      </div>

      {/* Filter and Action Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
          >
            <option value="all">All Blood Groups</option>
            {BLOOD_GROUPS.map((bg) => (
              <option key={bg} value={bg}>
                {bg}
              </option>
            ))}
          </select>

          <select
            value={selectedComponent}
            onChange={(e) => setSelectedComponent(e.target.value)}
            className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
          >
            <option value="all">All Components</option>
            {BLOOD_COMPONENTS.map((c) => (
              <option key={c.type} value={c.type}>
                {c.label}
              </option>
            ))}
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="available">Available</option>
            <option value="reserved">Reserved</option>
            <option value="quarantine">Quarantined</option>
            <option value="transfused">Transfused</option>
            <option value="expired">Expired</option>
            <option value="discarded">Discarded</option>
          </select>
        </div>

        <button
          onClick={onOpenAddUnit}
          className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-xs"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          Add Blood Unit
        </button>
      </div>

      {/* Inventory Table */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        {filteredInventory.length === 0 ? (
          <div className="text-center py-12 px-4">
            <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <h4 className="text-sm font-semibold text-slate-900">No blood units in inventory</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
              Screened and tested donations processed into blood components appear here with temperature and expiry tracking.
            </p>
            <button
              onClick={onOpenAddUnit}
              className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg text-xs font-medium transition-colors"
            >
              + Add first unit
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-100">
                  <th className="py-3 px-4">Unit Barcode</th>
                  <th className="py-3 px-4">Blood Group</th>
                  <th className="py-3 px-4">Component</th>
                  <th className="py-3 px-4">Volume</th>
                  <th className="py-3 px-4">Collected</th>
                  <th className="py-3 px-4">Expiry Date</th>
                  <th className="py-3 px-4">Storage Location</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInventory.map((unit) => {
                  const badge = INVENTORY_STATUS_LABELS[unit.status] || {
                    label: unit.status,
                    color: 'bg-slate-100 text-slate-700',
                  };
                  const isExpiringSoon =
                    unit.status === 'available' &&
                    new Date(unit.expiryDate).getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000;

                  return (
                    <tr key={unit.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-800">{unit.id}</td>
                      <td className="py-3.5 px-4">
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700 border border-rose-200">
                          {unit.bloodGroup}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-700 font-medium capitalize">
                        {unit.componentType.replace(/_/g, ' ')}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">{unit.volumeMl} ml</td>
                      <td className="py-3.5 px-4 text-slate-600">{unit.collectionDate}</td>
                      <td className="py-3.5 px-4">
                        <span className={isExpiringSoon ? 'text-rose-600 font-bold' : 'text-slate-600'}>
                          {unit.expiryDate}
                        </span>
                        {isExpiringSoon && (
                          <span className="block text-[10px] text-rose-500 font-semibold">Soon</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">{unit.storageLocation}</td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${badge.color}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {['transfused', 'discarded'].includes(unit.status) ? (
                          <span className="text-[11px] text-slate-400">Archived</span>
                        ) : (
                          <button
                            onClick={() => {
                              setStatusModalUnit(unit);
                              setNextStatus(unit.status === 'available' ? 'reserved' : 'available');
                              setStatusReason('');
                              setTransitionError(null);
                            }}
                            className="px-2.5 py-1 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition-colors"
                          >
                            Update
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Unit Modal */}
      {isAddUnitOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Add Screened Blood Unit</h3>
              <button
                onClick={onCloseAddUnit}
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

            <form onSubmit={handleAddSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Select Donation Session *</label>
                {donations.length === 0 ? (
                  <div className="p-3 bg-amber-50 rounded-lg text-xs text-amber-800 border border-amber-200">
                    No donation sessions recorded yet. Please record a donation session first.
                  </div>
                ) : (
                  <select
                    required
                    value={formData.donationId}
                    onChange={(e) => handleDonationSelect(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none"
                  >
                    <option value="">-- Select Donation Session --</option>
                    {donations.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.id} — {d.donorName} ({d.bloodGroup}) — {d.screeningStatus}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Unit Barcode / ID *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. MED-BB-2026-001"
                    value={formData.id}
                    onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-rose-500 font-mono focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Blood Group *</label>
                  <input
                    type="text"
                    readOnly
                    value={formData.bloodGroup}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-100 font-bold text-rose-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Blood Component Type *</label>
                  <select
                    value={formData.componentType}
                    onChange={(e) => handleComponentChange(e.target.value as BloodComponentType)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none"
                  >
                    {BLOOD_COMPONENTS.map((c) => (
                      <option key={c.type} value={c.type}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Volume (ml) *</label>
                  <input
                    type="number"
                    required
                    value={formData.volumeMl}
                    onChange={(e) => setFormData({ ...formData, volumeMl: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Collection Date *</label>
                  <input
                    type="date"
                    required
                    value={formData.collectionDate}
                    onChange={(e) => setFormData({ ...formData, collectionDate: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Approved Expiry Date *</label>
                  <input
                    type="date"
                    required
                    value={formData.expiryDate}
                    onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Storage Location *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Cold Room 1 - Shelf B-2"
                  value={formData.storageLocation}
                  onChange={(e) => setFormData({ ...formData, storageLocation: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Initial Status *</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as InventoryUnitStatus })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none"
                >
                  <option value="available">Available for Issuing</option>
                  <option value="quarantine">Quarantine (Under Additional Evaluation)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onCloseAddUnit}
                  className="px-4 py-2 text-xs text-slate-600 hover:text-slate-800 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || donations.length === 0}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors shadow-xs"
                >
                  {submitting ? 'Saving...' : 'Add Unit to Inventory'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Update Status Modal */}
      {statusModalUnit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
            <h3 className="text-base font-bold text-slate-900 pb-2 border-b border-slate-100">
              Update Unit Status: {statusModalUnit.id}
            </h3>

            {transitionError && (
              <div className="mt-3 p-3 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-xs font-medium">
                {transitionError}
              </div>
            )}

            <form onSubmit={handleTransitionSubmit} className="mt-4 space-y-4">
              <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200">
                Current status: <span className="font-bold text-slate-900 uppercase">{statusModalUnit.status}</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">New Status *</label>
                <select
                  value={nextStatus}
                  onChange={(e) => setNextStatus(e.target.value as InventoryUnitStatus)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none"
                >
                  <option value="available">Available</option>
                  <option value="reserved">Reserved</option>
                  <option value="quarantine">Quarantine</option>
                  <option value="expired">Expired</option>
                  <option value="discarded">Discarded (Biohazard waste)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reason for Status Change</label>
                <input
                  type="text"
                  placeholder="e.g. Temperature variation, routine reserve, or QC inspection"
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStatusModalUnit(null)}
                  className="px-4 py-2 text-xs text-slate-600 hover:text-slate-800 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors shadow-xs"
                >
                  {submitting ? 'Updating...' : 'Confirm Transition'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
