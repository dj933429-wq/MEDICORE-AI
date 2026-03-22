'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../lib/auth';
import { db } from '../../lib/firebase';
import { collection, query, getDocs, orderBy, doc, getDoc, where, addDoc, serverTimestamp } from 'firebase/firestore';

interface PatientDoc {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  userId?: string;
}

interface MedicalRecord {
  id: string;
  date?: string;
  createdAt?: any;
  diagnosis?: string;
  doctor?: string;
  medicines?: string;
  notes?: string;
}

interface Doctor {
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
  createdAt?: unknown;
}

interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
}

export default function PatientDashboard() {
  const { user } = useAuth();
  const [patientDoc, setPatientDoc] = useState<PatientDoc | null>(null);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [booking, setBooking] = useState(false);
  const [apptError, setApptError] = useState('');
  const [newAppt, setNewAppt] = useState({ doctorId: '', date: '', time: '', notes: '' });

  // AI Chat State
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      try {
        setLoading(true);

        // 1. Fetch Patient Document
        const patientRef = doc(db, 'patients', user.uid);
        const pSnap = await getDoc(patientRef);
        
        let pData = {
          name: user.name || user.email?.split('@')[0] || 'Unknown Patient',
          email: user.email || 'Unlisted',
          phone: 'Unlisted'
        };

        if (pSnap.exists()) {
          pData = { ...pData, ...(pSnap.data() as Partial<PatientDoc>) };
        }
        setPatientDoc({ id: user.uid, ...pData });
        
        // 2. Fetch Medical Records
        const recordsRef = collection(db, 'patients', user.uid, 'medicalRecords');
        const rQuery = query(recordsRef, orderBy('createdAt', 'desc'));
        const rSnap = await getDocs(rQuery);
        
        const fetchedRecords: MedicalRecord[] = [];
        rSnap.forEach(snapDoc => {
          fetchedRecords.push({ ...(snapDoc.data() as Omit<MedicalRecord, 'id'>), id: snapDoc.id });
        });
        
        // Secondary sort fallback in case missing index returns arbitrary ordering
        fetchedRecords.sort((a,b) => {
           const timeA = a.createdAt?.seconds || 0;
           const timeB = b.createdAt?.seconds || 0;
           return timeB - timeA;
        });
        
        setRecords(fetchedRecords);

        // 3. Fetch Doctors List
        try {
          const qDoc = query(collection(db, 'users'), where('role', '==', 'doctor'));
          const dSnap = await getDocs(qDoc);
          const docsFound: Doctor[] = [];
          dSnap.forEach(d => docsFound.push({ ...(d.data() as Doctor), id: d.id }));
          setDoctors(docsFound);
        } catch(e) { console.error("Error fetching available doctors", e); } // Rules fail-safe if doctor filtering blocked

        // 4. Fetch Appointments
        const qAppt = query(collection(db, 'appointments'), where('patientId', '==', user.uid));
        const aSnap = await getDocs(qAppt);
        const apptsFound: Appointment[] = [];
        aSnap.forEach(a => apptsFound.push({ ...a.data(), id: a.id } as Appointment));
        
        // Local sort (date + time desc)
        apptsFound.sort((a,b) => (b.date + b.time).localeCompare(a.date + a.time));
        setAppointments(apptsFound);

      } catch (err: unknown) {
        console.error("Error fetching data:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user]);

  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault();
    setApptError('');

    if (!newAppt.doctorId || !newAppt.date || !newAppt.time) {
      setApptError("Please select a doctor, date, and time.");
      return;
    }

    const selectedDateTime = new Date(`${newAppt.date}T${newAppt.time}`);
    if (selectedDateTime < new Date()) {
      setApptError("Cannot book appointments in the past.");
      return;
    }

    setBooking(true);
    try {
      // Slot validation logically scoping exact conflicts manually matching composite indexing limits.
      const qConflict = query(collection(db, 'appointments'), where('doctorId', '==', newAppt.doctorId), where('date', '==', newAppt.date));
      const conflictSnap = await getDocs(qConflict);
      
      const hasConflict = conflictSnap.docs.some(docData => {
        const data = docData.data();
        return data.time === newAppt.time && data.status === 'scheduled';
      });

      if (hasConflict) {
        setApptError("This specific time slot is already scheduled with the doctor. Choose another.");
        setBooking(false);
        return;
      }

      const docObj = doctors.find(d => d.id === newAppt.doctorId);
      const payload: Omit<Appointment, 'id'> = {
        patientId: user.uid,
        patientName: patientDoc?.name || 'Patient',
        doctorId: newAppt.doctorId,
        doctorName: docObj?.name || 'Doctor',
        date: newAppt.date,
        time: newAppt.time,
        status: 'pending',
        notes: newAppt.notes,
        createdAt: serverTimestamp()
      };

      const docRef = await addDoc(collection(db, 'appointments'), payload);
      setAppointments(prev => [{ id: docRef.id, ...(payload as Omit<Appointment, 'id'>) } as Appointment, ...prev].sort((a,b) => (b.date + b.time).localeCompare(a.date + a.time)));
      setShowModal(false);
      setNewAppt({ doctorId: '', date: '', time: '', notes: '' });
    } catch (err: unknown) {
      console.error(err);
      setApptError("Failure dispatching scheduling request.");
    } finally {
      setBooking(false);
    }
  };

  const handleSendChat = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;
    
    const userText = chatInput.trim();
    setChatMessages(prev => [...prev, { role: 'user', text: userText }]);
    setChatInput('');
    setChatLoading(true);

    try {
      const res = await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText })
      });
      
      const data = await res.json();
      if (res.ok) {
        setChatMessages(prev => [...prev, { role: 'ai', text: data.reply }]);
      } else {
        setChatMessages(prev => [...prev, { role: 'ai', text: "Error: " + (data.error || "unavailable") }]);
      }
    } catch (err) {
      console.error("AI Fetch Failure:", err);
      setChatMessages(prev => [...prev, { role: 'ai', text: "Network error connecting to the AI system." }]);
    } finally {
      setChatLoading(false);
    }
  };

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
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <header className="mb-10 flex flex-col sm:flex-row justify-between sm:items-end gap-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Welcome, {patientDoc?.name?.split(' ')[0] || 'Patient'}
            </h1>
            <p className="text-gray-600">Here is your clinical dashboard and schedules.</p>
          </div>
          <button 
            onClick={() => setShowModal(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg shadow-md transition-colors whitespace-nowrap"
          >
            + Book Appointment
          </button>
        </header>

        {/* Modal Override Block */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-100">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <h2 className="text-xl font-bold text-gray-900">Schedule Appointment</h2>
                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
              </div>
              <div className="p-6">
                {apptError && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{apptError}</div>}
                <form onSubmit={handleBook} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Select Physician</label>
                    <select 
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 bg-white focus:ring-2 focus:ring-blue-600 outline-none"
                      value={newAppt.doctorId}
                      onChange={e => setNewAppt({...newAppt, doctorId: e.target.value})}
                      disabled={booking}
                    >
                      <option value="">-- Choose a Doctor --</option>
                      {doctors.map(d => <option key={d.id} value={d.id}>Dr. {d.name}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                      <input 
                        type="date" 
                        className="w-full border border-gray-300 rounded-lg px-4 py-2 bg-white focus:ring-2 focus:ring-blue-600 outline-none"
                        value={newAppt.date}
                        min={new Date().toISOString().split('T')[0]}
                        onChange={e => setNewAppt({...newAppt, date: e.target.value})}
                        disabled={booking}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Time</label>
                      <input 
                        type="time" 
                        className="w-full border border-gray-300 rounded-lg px-4 py-2 bg-white focus:ring-2 focus:ring-blue-600 outline-none"
                        value={newAppt.time}
                        onChange={e => setNewAppt({...newAppt, time: e.target.value})}
                        disabled={booking}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Reason / Notes</label>
                    <textarea 
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 bg-white focus:ring-2 focus:ring-blue-600 outline-none resize-none"
                      rows={3}
                      value={newAppt.notes}
                      onChange={e => setNewAppt({...newAppt, notes: e.target.value})}
                      disabled={booking}
                      placeholder="Symptoms, requests, etc."
                    ></textarea>
                  </div>
                  <div className="pt-2 flex gap-3">
                    <button type="button" onClick={() => setShowModal(false)} disabled={booking} className="w-full py-2 px-4 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
                    <button type="submit" disabled={booking} className="w-full py-2 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
                      {booking ? 'Reserving...' : 'Confirm'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-8">
          
          {/* Active Appointments Layer */}
          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4 border-b border-gray-200 pb-2">Upcoming Appointments</h2>
            {appointments.length === 0 ? (
                <div className="bg-white rounded-xl shadow-md p-10 text-center border border-gray-100">
                  <p className="text-gray-500">You currently have no scheduled appointments.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {appointments.map(appt => (
                    <div key={appt.id} className="bg-white rounded-xl shadow-md p-5 border border-gray-100 flex flex-col gap-3">
                      <div className="flex justify-between items-start">
                        <div className="font-bold text-gray-900 text-lg">Dr. {appt.doctorName}</div>
                        {getStatusBadge(appt.status)}
                      </div>
                      <div className="text-gray-600 font-medium flex gap-4 text-sm bg-gray-50 p-3 rounded-lg border border-gray-200">
                         <span>📅 {appt.date}</span>
                         <span>⏰ {appt.time}</span>
                      </div>
                      {appt.notes && <p className="text-gray-500 text-sm mt-1 flex-1">{appt.notes}</p>}
                    </div>
                  ))}
                </div>
            )}
          </section>

          {/* Medical Timeline Array View */}
          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4 border-b border-gray-200 pb-2">Medical Timeline</h2>
            {records.length === 0 ? (
              <div className="bg-white rounded-xl shadow-md p-12 text-center border border-gray-100">
                <div className="text-gray-400 mb-4 flex justify-center">
                  <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-1">No records yet</h3>
                <p className="text-gray-500">Your medical history is currently empty.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {records.map(record => (
                  <div key={record.id} className="bg-white rounded-xl shadow-md p-6 border border-gray-100">
                    <div className="flex flex-col sm:flex-row justify-between mb-4">
                      <div>
                        <span className="inline-block px-3 py-1 bg-blue-50 text-blue-700 text-sm font-semibold rounded-lg mb-2">
                          {record.createdAt ? record.createdAt.toDate().toLocaleDateString() : (record.date || 'Unknown Date')}
                        </span>
                        <h3 className="text-xl font-bold text-gray-900">{record.diagnosis}</h3>
                      </div>
                      <div className="text-gray-600 font-medium mt-2 sm:mt-0">
                        {record.doctor}
                      </div>
                    </div>
                    {record.medicines && <p className="text-gray-900 font-medium my-2 bg-blue-50/50 p-3 rounded-lg border border-blue-100/50">Medicines: <span className="font-normal">{record.medicines}</span></p>}
                    <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{record.notes}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* AI Medical Assistant Array View */}
          <section className="mt-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4 border-b border-gray-200 pb-2">AI Medical Assistant</h2>
            <div className="bg-white rounded-xl shadow-md border border-gray-100 p-6 flex flex-col h-[500px]">
              <div className="flex-1 overflow-y-auto mb-4 space-y-4 pr-2">
                {chatMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center text-gray-500">
                    <svg className="w-12 h-12 mb-3 text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
                    <p className="font-medium">How can I assist you with your health profiling today?</p>
                    <p className="text-sm mt-1">Remember: Always consult a registered doctor for genuine diagnoses.</p>
                  </div>
                ) : (
                  chatMessages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-xl px-5 py-3 ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-none shadow-sm' : 'bg-gray-200 text-gray-900 rounded-bl-none shadow-sm'}`}>
                        <p className="whitespace-pre-wrap leading-relaxed text-sm md:text-base">{msg.text}</p>
                      </div>
                    </div>
                  ))
                )}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-gray-200 text-gray-500 max-w-[80%] rounded-xl rounded-bl-none px-5 py-3 shadow-sm flex gap-1 items-center">
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></span>
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.4s'}}></span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <form onSubmit={handleSendChat} className="flex gap-3 border-t border-gray-100 pt-4">
                <input
                  type="text"
                  placeholder="Ask a general health question..."
                  className="flex-1 border border-gray-300 rounded-lg px-4 py-3 bg-white focus:ring-2 focus:ring-blue-600 outline-none transition-shadow text-gray-800"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  disabled={chatLoading}
                />
                <button
                  type="submit"
                  disabled={chatLoading || !chatInput.trim()}
                  className="bg-blue-600 text-white rounded-lg px-6 py-3 font-medium hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
