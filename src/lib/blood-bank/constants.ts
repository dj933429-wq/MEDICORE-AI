/**
 * MEDICORE-AI — Isolated Blood Bank Constants & Guardrails
 * Domain reference constants for Phase 4A
 */

import { BloodGroup, BloodComponentType, RequestUrgency, DonorEligibilityStatus, InventoryUnitStatus } from './types';

export const DEFAULT_BLOOD_BANK_CENTER_ID = 'center-primary';

export const BLOOD_GROUPS: readonly BloodGroup[] = [
  'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'
] as const;

export const BLOOD_COMPONENTS: readonly {
  type: BloodComponentType;
  label: string;
  defaultShelfLifeDays: number;
  recommendedStorageTemp: string;
  standardVolumeMl: number;
}[] = [
  {
    type: 'whole_blood',
    label: 'Whole Blood (WB)',
    defaultShelfLifeDays: 35,
    recommendedStorageTemp: '+2°C to +6°C',
    standardVolumeMl: 450,
  },
  {
    type: 'red_blood_cells',
    label: 'Packed Red Blood Cells (PRBC)',
    defaultShelfLifeDays: 42,
    recommendedStorageTemp: '+2°C to +6°C',
    standardVolumeMl: 300,
  },
  {
    type: 'platelets',
    label: 'Platelet Concentrate',
    defaultShelfLifeDays: 5,
    recommendedStorageTemp: '+20°C to +24°C (agitation)',
    standardVolumeMl: 250,
  },
  {
    type: 'fresh_frozen_plasma',
    label: 'Fresh Frozen Plasma (FFP)',
    defaultShelfLifeDays: 365,
    recommendedStorageTemp: '≤ -18°C',
    standardVolumeMl: 250,
  },
  {
    type: 'cryoprecipitate',
    label: 'Cryoprecipitate',
    defaultShelfLifeDays: 365,
    recommendedStorageTemp: '≤ -18°C',
    standardVolumeMl: 15,
  },
] as const;

export const ELIGIBILITY_STATUS_LABELS: Record<DonorEligibilityStatus, { label: string; color: string }> = {
  eligible: { label: 'Eligible', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  pending_screening: { label: 'Pending Screening', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  temporarily_deferred: { label: 'Temporarily Deferred', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  permanently_deferred: { label: 'Permanently Deferred', color: 'bg-rose-50 text-rose-700 border-rose-200' },
};

export const INVENTORY_STATUS_LABELS: Record<InventoryUnitStatus, { label: string; color: string }> = {
  available: { label: 'Available', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  reserved: { label: 'Reserved', color: 'bg-sky-50 text-sky-700 border-sky-200' },
  quarantine: { label: 'Quarantined', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  transfused: { label: 'Transfused', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  expired: { label: 'Expired', color: 'bg-rose-50 text-rose-700 border-rose-200' },
  discarded: { label: 'Discarded', color: 'bg-gray-50 text-gray-700 border-gray-200' },
};

export const REQUEST_URGENCY_LABELS: Record<RequestUrgency, { label: string; color: string }> = {
  emergency_stat: { label: 'EMERGENCY (STAT)', color: 'bg-rose-600 text-white font-bold animate-pulse' },
  urgent: { label: 'Urgent', color: 'bg-amber-100 text-amber-800 font-semibold' },
  routine: { label: 'Routine', color: 'bg-slate-100 text-slate-700' },
};

/**
 * MANDATORY CLINICAL DISCLAIMER:
 * Strict medical safety notice to be shown on the Blood Bank dashboard,
 * reports, and inventory management interfaces.
 */
export const CLINICAL_SAFETY_DISCLAIMER = 
  'CLINICAL NOTICE: Transfusion safety requires physical laboratory screening (ABO/Rh typing, antibody screen, infectious disease testing) and authorized medical staff sign-off. This management software records verified operational data and does NOT compute automated clinical eligibility or match transfusion compatibility.';
