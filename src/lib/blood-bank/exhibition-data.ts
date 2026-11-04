/**
 * MEDICORE-AI — Blood Bank Shared Network Exhibition Dataset (Phase 4B.4)
 * FILE: src/lib/blood-bank/exhibition-data.ts
 *
 * Deterministic test/exhibition dataset containing verified blood bank centers,
 * stock summary projections, sample network shortage broadcasts, and exhibition units.
 * All demonstration records are tagged with `isExhibitionData: true` or `isExhibitionCenter: true`.
 */

import { doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import type {
  BloodBankCenter,
  NetworkBloodRequest,
  BloodInventoryUnit,
} from './types';

export const EXHIBITION_BLOOD_BANK_CENTERS: BloodBankCenter[] = [
  {
    id: 'center-metropolis-central',
    name: 'Metropolis Central Blood Bank',
    licenseNumber: 'LIC-BB-NY-001',
    verificationStatus: 'verified',
    location: {
      latitude: 40.7128,
      longitude: -74.006,
      geohash: 'dr5reg',
    },
    address: {
      street: '100 Health Science Blvd',
      city: 'Metropolis',
      state: 'NY',
      postalCode: '10001',
      country: 'US',
    },
    contact: {
      phone: '+1 (555) 234-5678',
      emergencyPhone: '+1 (555) 911-BLOD',
      email: 'metropolis.central@bloodbank.medicore.internal',
      operatingHours: '24/7 (Emergency STAT Capable)',
    },
    availableStockSummary: {
      'O+_whole_blood': 14,
      'O-_whole_blood': 6,
      'A+_whole_blood': 18,
      'A-_whole_blood': 4,
      'B+_whole_blood': 11,
      'B-_whole_blood': 3,
      'AB+_whole_blood': 7,
      'AB-_whole_blood': 2,
      'O+_platelets': 9,
      'A+_platelets': 8,
      'O-_red_blood_cells': 5,
      'A+_red_blood_cells': 12,
    },
    isExhibitionCenter: true,
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-03-01T08:00:00Z',
  },
  {
    id: 'center-st-jude-regional',
    name: 'St. Jude Regional Blood Center',
    licenseNumber: 'LIC-BB-NY-002',
    verificationStatus: 'verified',
    location: {
      latitude: 40.7306,
      longitude: -73.9352,
      geohash: 'dr5ru2',
    },
    address: {
      street: '250 Mercy Parkway',
      city: 'Brooklyn',
      state: 'NY',
      postalCode: '11201',
      country: 'US',
    },
    contact: {
      phone: '+1 (555) 345-6789',
      emergencyPhone: '+1 (555) 911-JUDE',
      email: 'st.jude.regional@bloodbank.medicore.internal',
      operatingHours: '24/7 (Pediatric Priority)',
    },
    availableStockSummary: {
      'O+_whole_blood': 8,
      'O-_whole_blood': 3,
      'A+_whole_blood': 10,
      'B+_whole_blood': 15,
      'B-_whole_blood': 2,
      'AB+_whole_blood': 4,
      'O+_platelets': 5,
      'A-_red_blood_cells': 4,
    },
    isExhibitionCenter: true,
    createdAt: '2026-01-20T00:00:00Z',
    updatedAt: '2026-03-01T08:30:00Z',
  },
  {
    id: 'center-gotham-memorial',
    name: 'Gotham Memorial Transfusion Services',
    licenseNumber: 'LIC-BB-NJ-003',
    verificationStatus: 'verified',
    location: {
      latitude: 40.7357,
      longitude: -74.1724,
      geohash: 'dr5pze',
    },
    address: {
      street: '500 Memorial Drive',
      city: 'Newark',
      state: 'NJ',
      postalCode: '07102',
      country: 'US',
    },
    contact: {
      phone: '+1 (555) 456-7890',
      emergencyPhone: '+1 (555) 911-GOTH',
      email: 'gotham.memorial@bloodbank.medicore.internal',
      operatingHours: '24/7 (Trauma Level 1)',
    },
    availableStockSummary: {
      'O+_whole_blood': 22,
      'O-_whole_blood': 9,
      'A+_whole_blood': 14,
      'B+_whole_blood': 8,
      'AB+_whole_blood': 6,
      'O+_red_blood_cells': 15,
    },
    isExhibitionCenter: true,
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-03-01T09:00:00Z',
  },
  {
    id: 'center-starling-community',
    name: 'Starling Community Blood Center',
    licenseNumber: 'LIC-BB-PA-004',
    verificationStatus: 'verified',
    location: {
      latitude: 39.9526,
      longitude: -75.1652,
      geohash: 'dr4e32',
    },
    address: {
      street: '78 Independence Mall',
      city: 'Philadelphia',
      state: 'PA',
      postalCode: '19106',
      country: 'US',
    },
    contact: {
      phone: '+1 (555) 567-8901',
      emergencyPhone: '+1 (555) 911-STAR',
      email: 'starling.community@bloodbank.medicore.internal',
      operatingHours: 'Mon-Sat 08:00 - 20:00',
    },
    availableStockSummary: {
      'O+_whole_blood': 6,
      'A+_whole_blood': 9,
      'B+_whole_blood': 7,
      'AB+_whole_blood': 3,
    },
    isExhibitionCenter: true,
    createdAt: '2026-02-10T00:00:00Z',
    updatedAt: '2026-03-01T07:15:00Z',
  },
];

export const EXHIBITION_NETWORK_REQUESTS: NetworkBloodRequest[] = [
  {
    id: 'netreq_exhibit_stat_001',
    requesterUid: 'dr_trauma_lead_01',
    requesterRole: 'doctor',
    requesterName: 'Dr. Sarah Lin (Chief of Trauma Surgery)',
    requestType: 'shortage_broadcast',
    bloodGroup: 'O-',
    componentType: 'whole_blood',
    quantityUnits: 4,
    urgency: 'emergency_stat',
    requiredByDate: '2026-03-05T12:00:00Z',
    clinicalIndication: 'Emergency Trauma: Multiple casualty vehicle collision with severe hemorrhagic shock.',
    deliveryAddress: {
      hospitalOrFacilityName: 'Metropolis University Hospital',
      departmentOrWard: 'Trauma Resuscitation Bay 1',
      city: 'Metropolis',
      contactPhone: '+1 (555) 911-3000',
    },
    status: 'submitted',
    assignedUnitIds: [],
    fulfilledUnitIds: [],
    isExhibitionData: true,
    createdAt: '2026-03-01T10:00:00Z',
    updatedAt: '2026-03-01T10:00:00Z',
  },
  {
    id: 'netreq_exhibit_targeted_002',
    requesterUid: 'patient_john_doe_99',
    requesterRole: 'patient',
    requesterName: 'Johnathan Doe (Patient Care Coordinator)',
    requestType: 'targeted',
    targetCenterId: 'center-metropolis-central',
    bloodGroup: 'A+',
    componentType: 'platelets',
    quantityUnits: 2,
    urgency: 'urgent',
    requiredByDate: '2026-03-06T09:00:00Z',
    clinicalIndication: 'Scheduled Oncological Chemotherapy: Thrombocytopenia support.',
    deliveryAddress: {
      hospitalOrFacilityName: 'St. Luke Cancer Institute',
      departmentOrWard: 'Hematology Day Clinic',
      city: 'Metropolis',
      contactPhone: '+1 (555) 523-4000',
    },
    status: 'submitted',
    assignedUnitIds: [],
    fulfilledUnitIds: [],
    isExhibitionData: true,
    createdAt: '2026-03-01T10:15:00Z',
    updatedAt: '2026-03-01T10:15:00Z',
  },
  {
    id: 'netreq_exhibit_reserved_003',
    requesterUid: 'dr_pediatric_icu_02',
    requesterRole: 'doctor',
    requesterName: 'Dr. Marcus Vance (Pediatric Critical Care)',
    requestType: 'targeted',
    targetCenterId: 'center-st-jude-regional',
    acceptedCenterId: 'center-st-jude-regional',
    bloodGroup: 'B+',
    componentType: 'whole_blood',
    quantityUnits: 1,
    urgency: 'urgent',
    requiredByDate: '2026-03-05T18:00:00Z',
    clinicalIndication: 'Pediatric Cardiac Surgery: Pre-operative cross-match confirmed.',
    deliveryAddress: {
      hospitalOrFacilityName: 'Childrens Memorial Hospital',
      departmentOrWard: 'Pediatric ICU - Bed 4',
      city: 'Brooklyn',
      contactPhone: '+1 (555) 355-6000',
    },
    status: 'reserved',
    assignedUnitIds: ['unit_stjude_ex_bpos_01'],
    fulfilledUnitIds: [],
    authorizedStaffUid: 'staff_stjude_01',
    isExhibitionData: true,
    createdAt: '2026-03-01T08:00:00Z',
    updatedAt: '2026-03-01T08:45:00Z',
  },
  {
    id: 'netreq_exhibit_rejected_004',
    requesterUid: 'patient_elena_frost_88',
    requesterRole: 'patient',
    requesterName: 'Elena Frost (Family Representative)',
    requestType: 'targeted',
    targetCenterId: 'center-starling-community',
    bloodGroup: 'AB-',
    componentType: 'whole_blood',
    quantityUnits: 1,
    urgency: 'routine',
    requiredByDate: '2026-03-07T14:00:00Z',
    clinicalIndication: 'Elective Orthopedic Joint Replacement surgery.',
    deliveryAddress: {
      hospitalOrFacilityName: 'Valley Orthopedic Center',
      departmentOrWard: 'Surgical Suite 3',
      city: 'Philadelphia',
      contactPhone: '+1 (555) 789-2222',
    },
    status: 'rejected',
    rejectionReason: 'Center inventory depleted for rare AB- whole blood; suggest converting to network shortage broadcast.',
    assignedUnitIds: [],
    fulfilledUnitIds: [],
    authorizedStaffUid: 'staff_starling_01',
    isExhibitionData: true,
    createdAt: '2026-03-01T09:00:00Z',
    updatedAt: '2026-03-01T09:30:00Z',
  },
];

export const EXHIBITION_INVENTORY_UNITS: BloodInventoryUnit[] = [
  {
    id: 'unit_exhibit_oneg_01',
    centerId: 'center-metropolis-central',
    donationId: 'don_exhibit_01',
    donorId: 'donor_exhibit_01',
    bloodGroup: 'O-',
    componentType: 'whole_blood',
    collectionDate: '2026-02-25T09:00:00Z',
    expiryDate: '2026-04-01T09:00:00Z',
    volumeMl: 450,
    storageLocation: 'Cold Vault 1 - Tray A1',
    status: 'available',
    isExhibitionData: true,
    createdAt: '2026-02-25T11:00:00Z',
    updatedAt: '2026-02-25T11:00:00Z',
  },
  {
    id: 'unit_exhibit_oneg_02',
    centerId: 'center-metropolis-central',
    donationId: 'don_exhibit_02',
    donorId: 'donor_exhibit_02',
    bloodGroup: 'O-',
    componentType: 'whole_blood',
    collectionDate: '2026-02-26T14:30:00Z',
    expiryDate: '2026-04-02T14:30:00Z',
    volumeMl: 450,
    storageLocation: 'Cold Vault 1 - Tray A2',
    status: 'available',
    isExhibitionData: true,
    createdAt: '2026-02-26T16:00:00Z',
    updatedAt: '2026-02-26T16:00:00Z',
  },
  {
    id: 'unit_exhibit_apos_platelet_01',
    centerId: 'center-metropolis-central',
    donationId: 'don_exhibit_03',
    donorId: 'donor_exhibit_03',
    bloodGroup: 'A+',
    componentType: 'platelets',
    collectionDate: '2026-02-28T08:00:00Z',
    expiryDate: '2026-03-05T08:00:00Z',
    volumeMl: 250,
    storageLocation: 'Agitator Incubator - Shelf 1',
    status: 'available',
    isExhibitionData: true,
    createdAt: '2026-02-28T10:00:00Z',
    updatedAt: '2026-02-28T10:00:00Z',
  },
];

/**
 * Seeds exhibition centers, requests, and units into Firestore
 */
export async function seedExhibitionNetworkData(
  firestoreInstance = db
): Promise<{ centersCount: number; requestsCount: number; inventoryCount: number }> {
  const batch = writeBatch(firestoreInstance);

  // 1. Seed centers
  for (const center of EXHIBITION_BLOOD_BANK_CENTERS) {
    const cRef = doc(firestoreInstance, 'bloodBank', center.id);
    batch.set(cRef, center);
  }

  // 2. Seed network requests
  for (const req of EXHIBITION_NETWORK_REQUESTS) {
    const rRef = doc(firestoreInstance, 'networkRequests', req.id);
    batch.set(rRef, req);
  }

  // 3. Seed inventory units for Metropolis Central
  for (const unit of EXHIBITION_INVENTORY_UNITS) {
    const uRef = doc(firestoreInstance, 'bloodBank', unit.centerId, 'inventory', unit.id);
    batch.set(uRef, unit);
  }

  await batch.commit();

  return {
    centersCount: EXHIBITION_BLOOD_BANK_CENTERS.length,
    requestsCount: EXHIBITION_NETWORK_REQUESTS.length,
    inventoryCount: EXHIBITION_INVENTORY_UNITS.length,
  };
}
