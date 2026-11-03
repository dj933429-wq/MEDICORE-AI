'use client';

import { useState } from 'react';
import { BloodDonor, BloodGroup, DonorEligibilityStatus, DonorGender } from '@/lib/blood-bank/types';
import { BLOOD_GROUPS, ELIGIBILITY_STATUS_LABELS } from '@/lib/blood-bank/constants';

interface DonorsTabProps {
  donors: BloodDonor[];
  isRegisterOpen: boolean;
  onCloseRegister: () => void;
  onOpenRegister: () => void;
  onSubmitRegister: (data: Omit<BloodDonor, 'id' | 'centerId' | 'createdAt' | 'updatedAt' | 'donationCount'>) => Promise<void>;
  staffUid: string;
}

export default function DonorsTab({
  donors,
  isRegisterOpen,
  onCloseRegister,
  onOpenRegister,
  onSubmitRegister,
  staffUid,
}: DonorsTabProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBloodGroup, setSelectedBloodGroup] = useState<string>('all');
  const [selectedEligibility, setSelectedEligibility] = useState<string>('all');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    fullName: '',
    nationalIdOrPassport: '',
    dateOfBirth: '',
    gender: 'male' as DonorGender,
    bloodGroup: 'O+' as BloodGroup,
    phone: '',
    email: '',
    address: '',
    eligibilityStatus: 'eligible' as DonorEligibilityStatus,
    deferralReason: '',
    deferralUntil: '',
  });

  const filteredDonors = donors.filter((donor) => {
    const matchesSearch =
      donor.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      donor.nationalIdOrPassport.toLowerCase().includes(searchTerm.toLowerCase()) ||
      donor.contact.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesGroup = selectedBloodGroup === 'all' || donor.bloodGroup === selectedBloodGroup;
    const matchesEligibility = selectedEligibility === 'all' || donor.eligibilityStatus === selectedEligibility;
    return matchesSearch && matchesGroup && matchesEligibility;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await onSubmitRegister({
        fullName: formData.fullName.trim(),
        nationalIdOrPassport: formData.nationalIdOrPassport.trim(),
        dateOfBirth: formData.dateOfBirth,
        gender: formData.gender,
        bloodGroup: formData.bloodGroup,
        contact: {
          phone: formData.phone.trim(),
          email: formData.email.trim(),
          address: formData.address.trim() || undefined,
        },
        eligibilityStatus: formData.eligibilityStatus,
        deferralReason: formData.deferralReason.trim() || undefined,
        deferralUntil: formData.deferralUntil || undefined,
        verifiedByStaffUid: staffUid,
      });
      // Reset form
      setFormData({
        fullName: '',
        nationalIdOrPassport: '',
        dateOfBirth: '',
        gender: 'male',
        bloodGroup: 'O+',
        phone: '',
        email: '',
        address: '',
        eligibilityStatus: 'eligible',
        deferralReason: '',
        deferralUntil: '',
      });
      onCloseRegister();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to register donor';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Controls: Search, Filters, and Register Action */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <input
            type="text"
            placeholder="Search donors by name or ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500 w-full sm:w-64"
          />

          <select
            value={selectedBloodGroup}
            onChange={(e) => setSelectedBloodGroup(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
          >
            <option value="all">All Blood Groups</option>
            {BLOOD_GROUPS.map((bg) => (
              <option key={bg} value={bg}>
                {bg}
              </option>
            ))}
          </select>

          <select
            value={selectedEligibility}
            onChange={(e) => setSelectedEligibility(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="eligible">Eligible</option>
            <option value="pending_screening">Pending Screening</option>
            <option value="temporarily_deferred">Temporarily Deferred</option>
            <option value="permanently_deferred">Permanently Deferred</option>
          </select>
        </div>

        <button
          onClick={onOpenRegister}
          className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-xs"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          Register Donor
        </button>
      </div>

      {/* Donors Table */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        {filteredDonors.length === 0 ? (
          <div className="text-center py-12 px-4">
            <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h4 className="text-sm font-semibold text-slate-900">No donors registered yet</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
              Registered donors who have completed clinical screening and physical questionnaires will appear in this registry.
            </p>
            <button
              onClick={onOpenRegister}
              className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg text-xs font-medium transition-colors"
            >
              + Add first donor
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-100">
                  <th className="py-3 px-4">Donor Name</th>
                  <th className="py-3 px-4">Identification</th>
                  <th className="py-3 px-4">Blood Group</th>
                  <th className="py-3 px-4">DOB / Gender</th>
                  <th className="py-3 px-4">Contact</th>
                  <th className="py-3 px-4">Eligibility</th>
                  <th className="py-3 px-4 text-center">Donations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDonors.map((donor) => {
                  const badge = ELIGIBILITY_STATUS_LABELS[donor.eligibilityStatus] || {
                    label: donor.eligibilityStatus,
                    color: 'bg-slate-100 text-slate-700',
                  };
                  return (
                    <tr key={donor.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3.5 px-4 font-semibold text-slate-900">{donor.fullName}</td>
                      <td className="py-3.5 px-4 font-mono text-slate-600">{donor.nationalIdOrPassport}</td>
                      <td className="py-3.5 px-4">
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700 border border-rose-200">
                          {donor.bloodGroup}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 capitalize">
                        {donor.dateOfBirth} ({donor.gender})
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        <div>{donor.contact.phone}</div>
                        <div className="text-[11px] text-slate-400">{donor.contact.email}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${badge.color}`}>
                          {badge.label}
                        </span>
                        {donor.deferralUntil && (
                          <div className="text-[10px] text-orange-600 mt-0.5">Until {donor.deferralUntil}</div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold text-slate-700">{donor.donationCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Register Donor Modal */}
      {isRegisterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Register New Donor</h3>
              <button
                onClick={onCloseRegister}
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
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Legal Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Johnathan Doe"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">National ID / Passport *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. ID-8941249"
                    value={formData.nationalIdOrPassport}
                    onChange={(e) => setFormData({ ...formData, nationalIdOrPassport: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Date of Birth *</label>
                  <input
                    type="date"
                    required
                    value={formData.dateOfBirth}
                    onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Gender *</label>
                  <select
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value as DonorGender })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none"
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
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
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number *</label>
                  <input
                    type="tel"
                    required
                    placeholder="+1 555-0192"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address *</label>
                  <input
                    type="email"
                    required
                    placeholder="donor@example.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Residential Address</label>
                <input
                  type="text"
                  placeholder="Street address, city"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Staff-Verified Eligibility Status *</label>
                <select
                  value={formData.eligibilityStatus}
                  onChange={(e) => setFormData({ ...formData, eligibilityStatus: e.target.value as DonorEligibilityStatus })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none"
                >
                  <option value="eligible">Eligible (Passed physical/screening check)</option>
                  <option value="pending_screening">Pending Laboratory Screening</option>
                  <option value="temporarily_deferred">Temporarily Deferred</option>
                  <option value="permanently_deferred">Permanently Deferred</option>
                </select>
              </div>

              {formData.eligibilityStatus === 'temporarily_deferred' && (
                <div className="grid grid-cols-2 gap-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <div>
                    <label className="block text-[11px] font-semibold text-amber-900 mb-1">Deferred Until *</label>
                    <input
                      type="date"
                      required
                      value={formData.deferralUntil}
                      onChange={(e) => setFormData({ ...formData, deferralUntil: e.target.value })}
                      className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded bg-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-amber-900 mb-1">Deferral Reason</label>
                    <input
                      type="text"
                      placeholder="e.g. Recent dental procedure"
                      value={formData.deferralReason}
                      onChange={(e) => setFormData({ ...formData, deferralReason: e.target.value })}
                      className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded bg-white focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div className="text-[11px] text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200">
                Staff Verification Audit: Action will be logged under staff UID <span className="font-mono text-slate-700">{staffUid}</span>.
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onCloseRegister}
                  className="px-4 py-2 text-xs text-slate-600 hover:text-slate-800 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors shadow-xs"
                >
                  {submitting ? 'Registering...' : 'Confirm Registration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
