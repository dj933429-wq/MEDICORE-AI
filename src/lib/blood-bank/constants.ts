/**
 * MEDICORE-AI — Isolated Blood Bank Constants & Guardrails
 * Domain reference constants for Phase 4A / 4A.1 Hardening
 *
 * IMPORTANT CLINICAL BOUNDARY NOTICE:
 * The shelf-life values, storage temperatures, and draw volumes defined in this file
 * are OPERATIONAL SOFTWARE BASELINES intended for UI assistance and form pre-population.
 * They DO NOT constitute medical directives, approved clinical protocols, or regulatory policy.
 *
 * Authorized blood bank medical directors and laboratory quality managers must review
 * and establish clinical criteria according to local regulatory standards and specific
 * preservative/anticoagulant solutions in use.
 */

import { BloodGroup, BloodComponentType, RequestUrgency, DonorEligibilityStatus, InventoryUnitStatus } from './types';

export const DEFAULT_BLOOD_BANK_CENTER_ID = 'center-metropolis-central';

export const BLOOD_GROUPS: readonly BloodGroup[] = [
  'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'
] as const;

/**
 * Baseline Reference Guidelines for Blood Components
 * (Advisory only — Staff must approve expiry date and storage conditions)
 */
export const BLOOD_COMPONENTS: readonly {
  type: BloodComponentType;
  label: string;
  advisoryShelfLifeDays: number;
  advisoryStorageTemp: string;
  advisoryStandardVolumeMl: number;
  isOperationalGuidelineOnly: boolean;
}[] = [
  {
    type: 'whole_blood',
    label: 'Whole Blood (WB)',
    advisoryShelfLifeDays: 35,
    advisoryStorageTemp: '+2°C to +6°C',
    advisoryStandardVolumeMl: 450,
    isOperationalGuidelineOnly: true,
  },
  {
    type: 'red_blood_cells',
    label: 'Packed Red Blood Cells (PRBC)',
    advisoryShelfLifeDays: 42,
    advisoryStorageTemp: '+2°C to +6°C',
    advisoryStandardVolumeMl: 300,
    isOperationalGuidelineOnly: true,
  },
  {
    type: 'platelets',
    label: 'Platelet Concentrate',
    advisoryShelfLifeDays: 5,
    advisoryStorageTemp: '+20°C to +24°C (agitation)',
    advisoryStandardVolumeMl: 250,
    isOperationalGuidelineOnly: true,
  },
  {
    type: 'fresh_frozen_plasma',
    label: 'Fresh Frozen Plasma (FFP)',
    advisoryShelfLifeDays: 365,
    advisoryStorageTemp: '≤ -18°C',
    advisoryStandardVolumeMl: 250,
    isOperationalGuidelineOnly: true,
  },
  {
    type: 'cryoprecipitate',
    label: 'Cryoprecipitate',
    advisoryShelfLifeDays: 365,
    advisoryStorageTemp: '≤ -18°C',
    advisoryStandardVolumeMl: 15,
    isOperationalGuidelineOnly: true,
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
