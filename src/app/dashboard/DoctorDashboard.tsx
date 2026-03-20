'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { db } from '../../lib/firebase';
import { collection, query, getDocs, where, doc, updateDoc } from 'firebase/firestore';

interface Patient {
  id: string;
  name?: string;
  email?: string;
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
}

export default function DoctorDashboard() {
  const { user } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'today' | 'upcoming'>('all');
  const [loading, setLoading] = useState(true);
  
  const router = useRouter();

  useEffect(() => {
    if (!user) return;

    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        // Fetch All Patients
        const querySnapshot = await getDocs(collection(db, 'patients'));
        const fetchedPatients: Patient[] = [];
        querySnapshot.forEach((doc) => {
          fetchedPatients.push({ id: doc.id, ...doc.data() } as Patient);
        });
        setPatients(fetchedPatients);

        // Fetch Appointments mapped to this specific Doctor
        const qAppt = query(collection(db, 'appointments'), where('doctorId', '==', user.uid));
        const aSnap = await getDocs(qAppt);
        const apptsFound: Appointment[] = [];
        aSnap.forEach(a => apptsFound.push({ id: a.id, ...a.data() as Appointment }));
        
        // Sort effectively chronologically backwards
        apptsFound.sort((a,b) => (a.date + a.time).localeCompare(b.date + b.time));
        setAppointments(apptsFound);
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
      setAppointments(appointments.map(a => a.id === apptId ? { ...a, status: newStatus } : a));
    } catch (err) {
      console.error("Status update execution failed:", err);
    }
  };

  const todayStr = new Date().toISOString().split('T')[0];
  
  const processedAppointments = appointments.filter(a => {
    if (filter === 'today') return a.date === todayStr;
    if (filter === 'upcoming') return a.date >= todayStr;
    return true; // All
  });

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
                          {appt.status === 'scheduled' && (
                            <>
                              <button onClick={() => handleUpdateStatus(appt.id, 'completed')} className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium">Mark Completed</button>
                              <button onClick={() => handleUpdateStatus(appt.id, 'cancelled')} className="px-4 py-2 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium">Cancel</button>
                            </>
                          )}
                        </div>
                    </div>
                  ))}
               </div>
            )}
          </section>

          {/* Core Patients Block */}
          <section>
            <div className="flex justify-between items-end mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Patient Roster</h2>
              <div className="w-full md:w-80 ml-auto">
                <input
                  type="text"
                  placeholder="Search patients..."
                  className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 outline-none transition-all shadow-sm"
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            {patients.filter(p => p.name?.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 ? (
              <div className="bg-white rounded-xl shadow-md p-12 text-center border border-gray-100">
                <h3 className="text-lg font-medium text-gray-900 mb-1">No patients found</h3>
                <p className="text-gray-500">Wait for users to register as patients.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {patients.filter(p => p.name?.toLowerCase().includes(searchTerm.toLowerCase())).map(patient => (
                  <div key={patient.id} className="bg-white rounded-xl shadow-md p-6 border border-gray-100 flex flex-col h-full">
                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xl uppercase">
                        {patient.name?.charAt(0) || 'P'}
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">{patient.name || 'Unknown'}</h3>
                        <p className="text-sm text-gray-500">{patient.email || 'No email'}</p>
                      </div>
                    </div>
                    
                    <div className="flex-grow"></div>

                    <button
                      onClick={() => router.push(`/dashboard/patients/${patient.id}`)}
                      className="w-full bg-blue-600 text-white font-medium py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors mt-4"
                    >
                      View Records
                    </button>
                  </div>
                ))}
            </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
