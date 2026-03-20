'use client';

import { useParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import { db } from '../../../../lib/firebase';
import { useAuth } from '../../../../lib/auth';
import { doc, getDoc, collection, query, orderBy, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';

interface Patient {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  userId?: string;
}

interface MedicalRecord {
  id: string;
  date?: string;
  diagnosis?: string;
  doctor?: string;
  notes?: string;
}

export default function PatientDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  
  const [patient, setPatient] = useState<Patient | null>(null);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [showAddRecordForm, setShowAddRecordForm] = useState(false);
  const [newRecord, setNewRecord] = useState({ date: '', diagnosis: '', notes: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fetchPatientAndRecords = async () => {
    try {
      setLoading(true);
      
      const patientRef = doc(db, 'patients', id as string);
      const patientSnap = await getDoc(patientRef);
      
      if (!patientSnap.exists()) {
        setError('Patient not found.');
        return;
      }
      setPatient({ id: patientSnap.id, ...(patientSnap.data() as Omit<Patient, 'id'>) });

      const recordsRef = collection(db, 'patients', id as string, 'medicalRecords');
      const q = query(recordsRef, orderBy('date', 'desc'));
      const recordsSnap = await getDocs(q);
      
      const fetchedRecords: MedicalRecord[] = [];
      recordsSnap.forEach(snapDoc => {
        fetchedRecords.push({ id: snapDoc.id, ...(snapDoc.data() as Omit<MedicalRecord, 'id'>) });
      });
      setRecords(fetchedRecords);
      
    } catch (err: unknown) {
      console.error(err);
      setError('Error fetching patient data.');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (user && id) {
      fetchPatientAndRecords();
    }
  }, [user, id]);

  const handleAddRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRecord.date || !newRecord.diagnosis || !newRecord.notes) return;
    
    setIsSubmitting(true);
    
    try {
      const recordsRef = collection(db, 'patients', id as string, 'medicalRecords');
      const recordPayload = {
        ...newRecord,
        doctor: user?.name || user?.email?.split('@')[0] || 'Doctor',
        createdAt: serverTimestamp()
      };
      
      const docRef = await addDoc(recordsRef, recordPayload);
      setRecords([{ id: docRef.id, ...recordPayload }, ...records]);
      
      setNewRecord({ date: '', diagnosis: '', notes: '' });
      setShowAddRecordForm(false);
    } catch (err: unknown) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error || !patient) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="bg-white p-8 rounded-xl shadow-md text-center max-w-lg w-full">
           <h2 className="text-xl font-bold text-gray-900 mb-2">Error</h2>
           <p className="text-gray-600">{error || 'Patient not found.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        
        {/* Patient Profile Card */}
        <section className="mb-8">
          <div className="bg-white rounded-xl shadow-md p-6 border border-gray-100">
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center text-3xl font-bold uppercase shadow-sm">
                {patient.name?.charAt(0) || 'P'}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-1">{patient.name || 'Unknown Patient'}</h1>
                <div className="text-gray-600 flex flex-col sm:flex-row gap-2 sm:gap-6">
                  <span>{patient.email || 'N/A'}</span>
                  <span className="hidden sm:block">•</span>
                  <span>{patient.phone || 'N/A'}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Medical History Section */}
        <section>
          <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
            <h2 className="text-xl font-bold text-gray-900">Medical History</h2>
            <button 
              onClick={() => setShowAddRecordForm(!showAddRecordForm)}
              className={`font-medium py-2 px-4 rounded-lg transition-colors ${showAddRecordForm ? 'bg-gray-200 text-gray-800 hover:bg-gray-300' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-md hover:shadow-lg'}`}
            >
              {showAddRecordForm ? 'Cancel Form' : 'Add New Record'}
            </button>
          </div>

          {showAddRecordForm && (
            <div className="bg-white p-6 rounded-xl shadow-md border border-gray-100 mb-8">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Create Record</h3>
              <form onSubmit={handleAddRecord} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-700 text-sm font-medium mb-1">Visit Date</label>
                    <input 
                      type="date" 
                      value={newRecord.date} 
                      onChange={e => setNewRecord({...newRecord, date: e.target.value})} 
                      className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-600 outline-none transition-all" 
                      disabled={isSubmitting}
                      required 
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 text-sm font-medium mb-1">Diagnosis</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Common Cold" 
                      value={newRecord.diagnosis} 
                      onChange={e => setNewRecord({...newRecord, diagnosis: e.target.value})} 
                      className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-600 outline-none transition-all" 
                      disabled={isSubmitting}
                      required 
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-1">Notes</label>
                  <textarea 
                    placeholder="Patient reported symptoms..." 
                    value={newRecord.notes} 
                    onChange={e => setNewRecord({...newRecord, notes: e.target.value})} 
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-600 outline-none transition-all resize-none" 
                    rows={4} 
                    disabled={isSubmitting}
                    required
                  ></textarea>
                </div>
                <button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 mt-2"
                >
                  {isSubmitting ? 'Saving...' : 'Save Record'}
                </button>
              </form>
            </div>
          )}

          {records.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center border border-gray-100">
              <div className="text-gray-400 mb-4 flex justify-center">
                <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-1">No records yet</h3>
              <p className="text-gray-500">There are no medical history records currently associated with this patient.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {records.map(record => (
                <div key={record.id} className="p-6 rounded-xl border border-gray-100 bg-white shadow-md">
                  <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-4">
                    <div>
                      <span className="inline-block px-3 py-1 bg-blue-50 text-blue-700 text-sm font-semibold rounded-lg mb-2">
                        {record.date}
                      </span>
                      <h3 className="text-lg font-bold text-gray-900">{record.diagnosis}</h3>
                    </div>
                    <div className="text-gray-600 font-medium mt-2 sm:mt-0">
                      {record.doctor}
                    </div>
                  </div>
                  <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{record.notes}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
