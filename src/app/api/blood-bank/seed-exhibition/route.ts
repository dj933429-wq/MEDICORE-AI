import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import {
  EXHIBITION_BLOOD_BANK_CENTERS,
  EXHIBITION_NETWORK_REQUESTS,
  EXHIBITION_INVENTORY_UNITS,
} from '@/lib/blood-bank/exhibition-data';

export async function POST(req: Request) {
  try {
    const batch = adminDb.batch();
    const now = new Date().toISOString();
    const primaryCenterId = 'center-metropolis-central';

    // 1. Seed Verified Centers
    for (const center of EXHIBITION_BLOOD_BANK_CENTERS) {
      const cRef = adminDb.collection('bloodBank').doc(center.id);
      batch.set(cRef, {
        ...center,
        updatedAt: now,
      });
    }

    // 2. Seed Network Requests
    for (const nReq of EXHIBITION_NETWORK_REQUESTS) {
      const rRef = adminDb.collection('networkRequests').doc(nReq.id);
      batch.set(rRef, {
        ...nReq,
        updatedAt: now,
      });
    }

    // 3. Seed Metropolis Central Donors
    const sampleDonors = [
      {
        id: 'donor_metro_01',
        centerId: primaryCenterId,
        donorReferenceId: 'DON-2026-1001',
        fullName: 'Alexander Vance',
        nationalIdOrPassport: 'PASSPORT-US-9912',
        dateOfBirth: '1990-05-15',
        gender: 'male',
        bloodGroup: 'A+',
        contact: { phone: '+1 555-0199', email: 'alex.vance@example.com', address: '124 Broadway, Metropolis' },
        eligibilityStatus: 'eligible',
        donationCount: 4,
        verifiedByStaffUid: 'system_admin',
        createdAt: '2026-01-10T10:00:00Z',
        updatedAt: now,
      },
      {
        id: 'donor_metro_02',
        centerId: primaryCenterId,
        donorReferenceId: 'DON-2026-1002',
        fullName: 'Brenda Lin',
        nationalIdOrPassport: 'DL-NY-4820',
        dateOfBirth: '1992-08-20',
        gender: 'female',
        bloodGroup: 'O-',
        contact: { phone: '+1 555-0144', email: 'brenda.lin@example.com', address: '45 Lexington Ave, Metropolis' },
        eligibilityStatus: 'eligible',
        donationCount: 6,
        verifiedByStaffUid: 'system_admin',
        createdAt: '2026-01-15T11:00:00Z',
        updatedAt: now,
      },
      {
        id: 'donor_metro_03',
        centerId: primaryCenterId,
        donorReferenceId: 'DON-2026-1003',
        fullName: 'Carlos Mendez',
        nationalIdOrPassport: 'DL-NY-9182',
        dateOfBirth: '1988-11-10',
        gender: 'male',
        bloodGroup: 'B+',
        contact: { phone: '+1 555-0188', email: 'carlos.m@example.com', address: '88 Hudson St, Metropolis' },
        eligibilityStatus: 'eligible',
        donationCount: 2,
        verifiedByStaffUid: 'system_admin',
        createdAt: '2026-02-01T09:00:00Z',
        updatedAt: now,
      },
    ];

    for (const donor of sampleDonors) {
      const dRef = adminDb.collection('bloodBank').doc(primaryCenterId).collection('donors').doc(donor.id);
      batch.set(dRef, donor);
    }

    // 4. Seed Metropolis Central Donations
    const sampleDonations = [
      {
        id: 'don_exhibit_01',
        centerId: primaryCenterId,
        donorId: 'donor_metro_02',
        donorReferenceId: 'DON-2026-1002',
        donorName: 'Brenda Lin',
        bloodGroup: 'O-',
        donationDate: '2026-02-25T09:00:00Z',
        volumeMl: 450,
        collectionStatus: 'completed',
        screeningStatus: 'tested_passed',
        screeningStaffUid: 'staff_lab_01',
        screeningNotes: 'HIV, Hepatitis B/C, Syphilis non-reactive; hemoglobin 14.2 g/dL',
        collectionStaffUid: 'staff_draw_01',
        createdAt: '2026-02-25T09:30:00Z',
        updatedAt: now,
      },
      {
        id: 'don_exhibit_02',
        centerId: primaryCenterId,
        donorId: 'donor_metro_02',
        donorReferenceId: 'DON-2026-1002',
        donorName: 'Brenda Lin',
        bloodGroup: 'O-',
        donationDate: '2026-02-26T14:30:00Z',
        volumeMl: 450,
        collectionStatus: 'completed',
        screeningStatus: 'tested_passed',
        screeningStaffUid: 'staff_lab_01',
        screeningNotes: 'Serology clean; validated whole blood',
        collectionStaffUid: 'staff_draw_01',
        createdAt: '2026-02-26T15:00:00Z',
        updatedAt: now,
      },
      {
        id: 'don_exhibit_03',
        centerId: primaryCenterId,
        donorId: 'donor_metro_01',
        donorReferenceId: 'DON-2026-1001',
        donorName: 'Alexander Vance',
        bloodGroup: 'A+',
        donationDate: '2026-02-28T08:00:00Z',
        volumeMl: 450,
        collectionStatus: 'completed',
        screeningStatus: 'tested_passed',
        screeningStaffUid: 'staff_lab_02',
        screeningNotes: 'Plateletpheresis passed; bacterial screening negative',
        collectionStaffUid: 'staff_draw_02',
        createdAt: '2026-02-28T08:30:00Z',
        updatedAt: now,
      },
    ];

    for (const don of sampleDonations) {
      const donRef = adminDb.collection('bloodBank').doc(primaryCenterId).collection('donations').doc(don.id);
      batch.set(donRef, don);
    }

    // 5. Seed Inventory Units
    const allUnits = [
      ...EXHIBITION_INVENTORY_UNITS,
      {
        id: 'unit_metro_bpos_01',
        centerId: primaryCenterId,
        donationId: 'don_exhibit_03',
        donorId: 'donor_metro_03',
        bloodGroup: 'B+',
        componentType: 'red_blood_cells',
        collectionDate: '2026-02-27T10:00:00Z',
        expiryDate: '2026-04-10T10:00:00Z',
        volumeMl: 300,
        storageLocation: 'Cold Vault 2 - Shelf B1',
        status: 'available',
        isExhibitionData: true,
        createdAt: '2026-02-27T12:00:00Z',
        updatedAt: now,
      },
      {
        id: 'unit_metro_opos_01',
        centerId: primaryCenterId,
        donationId: 'don_exhibit_01',
        donorId: 'donor_metro_02',
        bloodGroup: 'O+',
        componentType: 'whole_blood',
        collectionDate: '2026-02-24T09:00:00Z',
        expiryDate: '2026-03-31T09:00:00Z',
        volumeMl: 450,
        storageLocation: 'Cold Vault 1 - Tray C3',
        status: 'available',
        isExhibitionData: true,
        createdAt: '2026-02-24T11:00:00Z',
        updatedAt: now,
      },
    ];

    for (const unit of allUnits) {
      const uRef = adminDb.collection('bloodBank').doc(primaryCenterId).collection('inventory').doc(unit.id);
      batch.set(uRef, { ...unit, updatedAt: now });
    }

    // 6. Seed Hospital Blood Requests
    const sampleRequests = [
      {
        id: 'req_metro_hosp_01',
        centerId: primaryCenterId,
        requestingOrganization: 'Metropolis General Hospital - Emergency Trauma',
        departmentOrWard: 'Resuscitation Bay 2',
        patientIdentifier: 'PT-TRAUMA-991',
        bloodGroup: 'O-',
        componentType: 'whole_blood',
        quantityUnits: 2,
        urgency: 'urgent',
        requiredByDate: '2026-03-08T18:00:00Z',
        clinicalIndication: 'Acute hemorrhagic anemia following motor vehicle accident',
        status: 'approved',
        decisionNotes: 'Clinical justification verified; allocated for immediate pickup',
        createdAt: '2026-03-01T08:00:00Z',
        updatedAt: now,
      },
      {
        id: 'req_metro_icu_02',
        centerId: primaryCenterId,
        requestingOrganization: 'St. Luke Cancer Institute',
        departmentOrWard: 'Chemotherapy Day Clinic',
        patientIdentifier: 'PT-ONC-442',
        bloodGroup: 'A+',
        componentType: 'platelets',
        quantityUnits: 1,
        urgency: 'routine',
        requiredByDate: '2026-03-09T09:00:00Z',
        clinicalIndication: 'Thrombocytopenia secondary to cycle 3 chemotherapy',
        status: 'submitted',
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: now,
      },
    ];

    for (const reqItem of sampleRequests) {
      const reqRef = adminDb.collection('bloodBank').doc(primaryCenterId).collection('requests').doc(reqItem.id);
      batch.set(reqRef, reqItem);
    }

    // 7. Seed Initial Audit Logs
    const sampleAuditLogs = [
      {
        id: `audit_seed_01`,
        centerId: primaryCenterId,
        actorUid: 'system_admin',
        actorRole: 'blood_bank',
        action: 'INVENTORY_UNIT_CREATED',
        entity: 'inventory',
        entityId: 'unit_exhibit_oneg_01',
        details: { bloodGroup: 'O-', componentType: 'whole_blood', status: 'available' },
        timestamp: '2026-02-25T11:00:00Z',
      },
      {
        id: `audit_seed_02`,
        centerId: primaryCenterId,
        actorUid: 'system_admin',
        actorRole: 'blood_bank',
        action: 'DONOR_REGISTERED',
        entity: 'donor',
        entityId: 'donor_metro_01',
        details: { fullName: 'Alexander Vance', bloodGroup: 'A+' },
        timestamp: '2026-01-10T10:00:00Z',
      },
    ];

    for (const log of sampleAuditLogs) {
      const logRef = adminDb.collection('bloodBank').doc(primaryCenterId).collection('auditLogs').doc(log.id);
      batch.set(logRef, log);
    }

    // Commit entire seed batch atomically
    await batch.commit();

    return NextResponse.json({
      success: true,
      message: 'Exhibition blood bank dataset successfully seeded into Metropolis Central and Shared Network.',
      centersCount: EXHIBITION_BLOOD_BANK_CENTERS.length,
      requestsCount: EXHIBITION_NETWORK_REQUESTS.length,
      inventoryCount: allUnits.length,
      donorsCount: sampleDonors.length,
      donationsCount: sampleDonations.length,
      hospitalRequestsCount: sampleRequests.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[BloodBankSeedAPI] Error seeding exhibition data:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
