'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { db } from '../../lib/firebase';
import { collection, query, getDocs, where, doc, getDoc, updateDoc, addDoc, serverTimestamp, orderBy } from 'firebase/firestore';

interface Patient {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  doctorId?: string;
  records?: any[];
}

interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  date: string;
  time: string;
  status: 'pending' | 'scheduled' | 'completed' | 'cancelled';
  notes: string;
  recordAdded?: boolean;
}

export default function DoctorDashboard() {
  const { user } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'today' | 'upcoming'>('all');
  const [loading, setLoading] = useState(true);
  
  // Record Modal State
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedApptId, setSelectedApptId] = useState('');
  const [recordForm, setRecordForm] = useState({ diagnosis: '', medicines: '', notes: '' });
  const [submittingRecord, setSubmittingRecord] = useState(false);
  const [recordSuccess, setRecordSuccess] = useState('');
  
  const router = useRouter();

  useEffect(() => {
    if (!user) return;

    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        
        // 1. Fetch Appointments explicitly mapped to this Doctor First
        const qAppt = query(collection(db, 'appointments'), where('doctorId', '==', user.uid));
        const aSnap = await getDocs(qAppt);
        const apptsFound: Appointment[] = [];
        aSnap.forEach(a => apptsFound.push({ ...a.data(), id: a.id } as Appointment));
        
        apptsFound.sort((a,b) => (b.date + b.time).localeCompare(a.date + a.time));
        setAppointments(apptsFound);

        // 2. Extract Unique Patient IDs off derived history securely
        const completedAppts = apptsFound.filter(a => a.status === 'completed' || a.recordAdded);
        const patientIds = [...new Set(completedAppts.map(a => a.patientId))];

        // 3. Fetch core Patient Models independently
        const fetchedPatients: Patient[] = [];
        
        await Promise.all(
          patientIds.map(async (pId) => {
             let docSnap = await getDoc(doc(db, 'patients', pId));
             if (!docSnap.exists()) {
                 docSnap = await getDoc(doc(db, 'users', pId));
             }
             if (docSnap.exists()) {
                 const pData = { ...docSnap.data(), id: docSnap.id } as Patient;
                 const rSnap = await getDocs(query(collection(db, `patients/${pId}/medicalRecords`), orderBy('createdAt', 'desc')));
                 const recs: any[] = [];
                 rSnap.forEach(r => recs.push({ ...r.data(), id: r.id }));
                 pData.records = recs;
                 fetchedPatients.push(pData);
             }
          })
        );
        
        setPatients(fetchedPatients);
      } catch (err: unknown) {
        console.error("Error fetching doctor components:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [user]);

  const handleUpdateStatus = async (apptId: string, newStatus: Appointment['status']) => {
    try {
      const apptRef = doc(db, 'appointments', apptId);
      await updateDoc(apptRef, { status: newStatus });
      
      const appt = appointments.find(a => a.id === apptId);
      if (appt && (newStatus === 'scheduled' || newStatus === 'completed')) {
        try {
          await updateDoc(doc(db, 'patients', appt.patientId), { doctorId: user?.uid });
          await updateDoc(doc(db, 'users', appt.patientId), { doctorId: user?.uid });
        } catch (linkErr) {
          console.error("Failed to link patient bounds", linkErr);
        }
      }

      setAppointments(appointments.map(a => a.id === apptId ? { ...a, status: newStatus } : a));
    } catch (err) {
      console.error("Status update execution failed:", err);
    }
  };

  const handleAddRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatientId || !selectedApptId || !user) return;
    setSubmittingRecord(true);
    try {
      const newRec = {
        diagnosis: recordForm.diagnosis,
        medicines: recordForm.medicines,
        notes: recordForm.notes,
        doctorId: user.uid,
        createdAt: serverTimestamp()
      };
      await addDoc(collection(db, `patients/${selectedPatientId}/medicalRecords`), newRec);
      
      const apptRef = doc(db, 'appointments', selectedApptId);
      await updateDoc(apptRef, { status: 'completed', recordAdded: true });
      
      try {
        await updateDoc(doc(db, 'patients', selectedPatientId), { doctorId: user?.uid });
        await updateDoc(doc(db, 'users', selectedPatientId), { doctorId: user?.uid });
      } catch (linkErr) {
        console.error("Failed to map patient on complete.", linkErr);
      }
      
      setAppointments(appointments.map(a => a.id === selectedApptId ? { ...a, status: 'completed', recordAdded: true } : a));
      
      setPatients(prev => prev.map(p => {
        if (p.id === selectedPatientId) {
            return {
                ...p,
                records: [{ ...newRec, createdAt: { toDate: () => new Date() } }, ...(p.records || [])]
            };
        }
        return p;
      }));
      
      setShowRecordModal(false);
      setRecordForm({ diagnosis: '', medicines: '', notes: '' });
      setSelectedApptId('');
      setRecordSuccess('Medical record added successfully.');
      setTimeout(() => setRecordSuccess(''), 3000);
    } catch (err) {
      console.error('Failed to save record:', err);
    } finally {
      setSubmittingRecord(false);
    }
  };

  const todayStr = new Date().toISOString().split('T')[0];
  
  const processedAppointments = appointments.filter(a => {
    if (a.status === 'completed' || a.recordAdded) {
      const apptDate = new Date(`${a.date}T${a.time}`);
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      if (apptDate < oneDayAgo) return false;
    }
    if (filter === 'today') return a.date === todayStr;
    if (filter === 'upcoming') return a.date >= todayStr;
    return true; // All
  });

  // Display locally mapped data directly.
  const processedPatients = patients;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <span className="px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 text-xs font-bold uppercase tracking-wider">Pending</span>;
      case 'scheduled': return <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-800 text-xs font-bold uppercase tracking-wider">Scheduled</span>;
      case 'completed': return <span className="px-3 py-1 rounded-full bg-green-100 text-green-800 text-xs font-bold uppercase tracking-wider">Completed</span>;
      case 'cancelled': return <span className="px-3 py-1 rounded-full bg-red-100 text-red-800 text-xs font-bold uppercase tracking-wider">Cancelled</span>;
      default: return null;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <header className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Welcome, Dr. {user?.name?.split(' ')[0] || 'Doctor'}
            </h1>
            <p className="text-gray-600">Your practice dashboard overview.</p>
          </div>
        </header>

        <div className="space-y-12">
          {recordSuccess && (
            <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg mb-6 shadow-sm">
              {recordSuccess}
            </div>
          )}
          
          {/* Appointment Workflow Layer */}
          <section>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Appointments</h2>
              <select 
                 className="border border-gray-300 rounded-lg px-4 py-2 bg-white focus:ring-2 focus:ring-blue-600 outline-none"
                 value={filter}
                 onChange={e => setFilter(e.target.value as 'all' | 'today' | 'upcoming')}
              >
                  <option value="all">View All</option>
                  <option value="today">Today Only</option>
                  <option value="upcoming">Upcoming</option>
              </select>
            </div>
            
            {processedAppointments.length === 0 ? (
               <div className="bg-white rounded-xl shadow-md p-10 text-center border border-gray-100">
                  <p className="text-gray-500">No appointments mapped to the specific criteria.</p>
               </div>
            ) : (
               <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {processedAppointments.map(appt => (
                    <div key={appt.id} className="bg-white rounded-xl shadow-md p-6 border border-gray-100 flex flex-col gap-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="text-xs text-gray-500 font-semibold mb-1 tracking-wider uppercase">{appt.date} • {appt.time}</div>
                            <h3 className="text-lg font-bold text-gray-900">{appt.patientName}</h3>
                          </div>
                          {getStatusBadge(appt.status)}
                        </div>
                        {appt.notes && <p className="text-gray-600 text-sm italic bg-gray-50 p-3 rounded-lg border border-gray-100">{appt.notes}</p>}
                        
                        {/* Control Actions */}
                        <div className="mt-auto pt-4 flex gap-2 flex-wrap border-t border-gray-100">
                          {appt.status === 'pending' && (
                            <>
                              <button onClick={() => handleUpdateStatus(appt.id, 'scheduled')} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium">Accept</button>
                              <button onClick={() => handleUpdateStatus(appt.id, 'cancelled')} className="px-4 py-2 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium">Reject</button>
                            </>
                          )}
                          {appt.status === 'scheduled' && !appt.recordAdded && (
                            <>
                              <button onClick={() => { setSelectedPatientId(appt.patientId); setSelectedApptId(appt.id); setShowRecordModal(true); }} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium w-full mb-2">
                                Add Medical Record & Complete
                              </button>
                              <button onClick={() => handleUpdateStatus(appt.id, 'cancelled')} className="px-4 py-2 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium w-full">Cancel</button>
                            </>
                          )}
                          {(appt.status === 'completed' || appt.recordAdded) && (
                            <div className="w-full text-center text-sm font-medium text-gray-500 py-2 bg-gray-50 rounded-lg border border-gray-200">
                               👤 Completed & Locked
                            </div>
                          )}
                        </div>
                    </div>
                  ))}
               </div>
            )}
          </section>

          {/* Patient Records Block */}
          <section>
            <div className="flex justify-between items-end mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Patient Records</h2>
              <div className="w-full md:w-80 ml-auto">
                <input
                  type="text"
                  placeholder="Search patients..."
                  className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 outline-none transition-all shadow-sm"
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            {processedPatients.filter(p => p.name?.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 ? (
              <div className="bg-white rounded-xl shadow-md p-12 text-center border border-gray-100">
                <h3 className="text-lg font-medium text-gray-900 mb-1">No patients found</h3>
                <p className="text-gray-500">No patients assigned to you.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {processedPatients.filter(p => p.name?.toLowerCase().includes(searchTerm.toLowerCase())).map(patient => (
                  <div key={patient.id} className="bg-white rounded-xl shadow-md p-6 border border-gray-100 flex flex-col h-full hover:shadow-lg transition-shadow">
                    <div className="flex items-center gap-4 mb-4 pb-4 border-b border-gray-100">
                      <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xl uppercase flex-shrink-0">
                        {patient.name?.charAt(0) || 'P'}
                      </div>
                      <div className="overflow-hidden">
                        <h3 className="text-lg font-bold text-gray-900 truncate">{patient.name || 'Unknown'}</h3>
                        <p className="text-sm text-gray-500 truncate">{patient.email || 'No email'}</p>
                      </div>
                    </div>
                    
                    {patient.records && patient.records.length > 0 ? (
                      <div className="text-sm text-gray-700 space-y-2 mb-4">
                        <div className="font-semibold text-gray-900 border-l-2 border-blue-500 pl-2 mb-3">
                          Latest Visit: {patient.records[0].createdAt ? (patient.records[0].createdAt.toDate ? patient.records[0].createdAt.toDate().toLocaleDateString() : new Date().toLocaleDateString()) : 'N/A'}
                        </div>
                        <p><span className="font-medium text-blue-900">Diagnosis:</span><br/> {patient.records[0].diagnosis}</p>
                        <p><span className="font-medium text-blue-900">Medicines:</span><br/> {patient.records[0].medicines}</p>
                        <p className="line-clamp-3 text-gray-500 italic mt-2"><span className="font-medium text-blue-900 not-italic">Notes:</span><br/> {patient.records[0].notes}</p>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500 italic mb-4 py-4 px-2 bg-gray-50 rounded-lg text-center border border-dashed border-gray-200">
                        No medical records explicitly on file.
                      </div>
                    )}
                    
                    <div className="flex-grow"></div>

                    <button
                      onClick={() => router.push(`/dashboard/patients/${patient.id}`)}
                      className="w-full bg-white border border-blue-200 text-blue-600 font-medium py-2 px-4 rounded-lg hover:bg-blue-50 transition-colors mt-4"
                    >
                      View Full History
                    </button>
                  </div>
                ))}
            </div>
            )}
          </section>
        </div>
        
        {/* Record Overlap Modal */}
        {showRecordModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-100">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h2 className="text-xl font-bold text-gray-900">Add Medical Record</h2>
                <button onClick={() => setShowRecordModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
              </div>
              <div className="p-6">
                <form onSubmit={handleAddRecord} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Diagnosis</label>
                    <input type="text" required value={recordForm.diagnosis} onChange={e => setRecordForm({...recordForm, diagnosis: e.target.value})} className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-600 outline-none" placeholder="Primary diagnosis" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Medicines</label>
                    <input type="text" required value={recordForm.medicines} onChange={e => setRecordForm({...recordForm, medicines: e.target.value})} className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-600 outline-none" placeholder="Prescription details" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                    <textarea required value={recordForm.notes} onChange={e => setRecordForm({...recordForm, notes: e.target.value})} className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-600 outline-none resize-none" rows={3} placeholder="Additional medical notes..."></textarea>
                  </div>
                  <div className="pt-4 flex gap-3">
                    <button type="button" onClick={() => setShowRecordModal(false)} disabled={submittingRecord} className="w-full py-2 px-4 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition">Cancel</button>
                    <button type="submit" disabled={submittingRecord} className="w-full py-2 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                      {submittingRecord ? 'Saving...' : 'Save Record'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
