'use client';

import { useParams } from 'next/navigation';
import { useState, useEffect } from 'react';

const mockPatientDetails = {
  id: '1',
  name: 'John Doe',
  email: 'john.doe@example.com',
  phone: '123-456-7890',
  address: '123 Main St, Anytown, USA',
  medicalHistory: [
    {
      id: '1',
      date: '2023-10-26',
      diagnosis: 'Common Cold',
      doctor: 'Dr. Smith',
      notes: 'Patient reported symptoms of a runny nose, cough, and sore throat. Advised rest and fluids.',
    },
    {
      id: '2',
      date: '2023-05-10',
      diagnosis: 'Sprained Ankle',
      doctor: 'Dr. Davis',
      notes: 'Patient fell while playing sports. X-ray showed a minor sprain. Prescribed R.I.C.E. and pain relievers.',
    },
  ],
};

export default function PatientDetailPage() {
  const { id } = useParams();
  const [patient, setPatient] = useState(null);
  const [showAddRecordForm, setShowAddRecordForm] = useState(false);
  const [newRecord, setNewRecord] = useState({ date: '', diagnosis: '', notes: '' });

  useEffect(() => {
    // In a real app, you would fetch patient data based on the id
    setPatient(mockPatientDetails);
  }, [id]);

  const handleAddRecord = (e) => {
    e.preventDefault();
    const newRecordWithId = { ...newRecord, id: Date.now().toString(), doctor: 'Dr. currentUser' }; // Mock doctor
    setPatient({ ...patient, medicalHistory: [newRecordWithId, ...patient.medicalHistory] });
    setNewRecord({ date: '', diagnosis: '', notes: '' });
    setShowAddRecordForm(false);
  };

  if (!patient) {
    return <div>Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-2xl p-6">
        <div className="flex items-center space-x-6 mb-8">
          <div className="w-32 h-32 bg-gray-300 rounded-full flex-shrink-0"></div>
          <div>
            <h1 className="text-4xl font-extrabold text-gray-900">{patient.name}</h1>
            <p className="text-gray-600 text-lg">{patient.email}</p>
            <p className="text-gray-600">{patient.phone}</p>
          </div>
        </div>

        <div className="mt-10">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-3xl font-bold text-gray-800">Medical History</h2>
            <button 
              onClick={() => setShowAddRecordForm(!showAddRecordForm)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-full focus:outline-none focus:shadow-outline transform transition-transform duration-300 hover:scale-105"
            >
              {showAddRecordForm ? 'Cancel' : 'Add New Record'}
            </button>
          </div>

          {showAddRecordForm && (
            <form onSubmit={handleAddRecord} className="bg-gray-50 p-6 rounded-lg shadow-inner mb-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <input type="date" value={newRecord.date} onChange={e => setNewRecord({...newRecord, date: e.target.value})} className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md" required />
                <input type="text" placeholder="Diagnosis" value={newRecord.diagnosis} onChange={e => setNewRecord({...newRecord, diagnosis: e.target.value})} className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md" required />
              </div>
              <textarea placeholder="Notes" value={newRecord.notes} onChange={e => setNewRecord({...newRecord, notes: e.target.value})} className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md" rows="3" required></textarea>
              <button type="submit" className="mt-4 w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline">Save Record</button>
            </form>
          )}

          <div className="space-y-8">
            {patient.medicalHistory.map(record => (
              <div key={record.id} className="p-6 rounded-xl border border-gray-200 bg-white shadow-md hover:shadow-lg transition-shadow duration-300">
                <p className="font-bold text-xl text-indigo-600">{record.date}</p>
                <p className="font-semibold text-lg text-gray-800">Diagnosis: {record.diagnosis}</p>
                <p className="text-sm text-gray-500">Doctor: {record.doctor}</p>
                <p className="mt-3 text-gray-700 whitespace-pre-wrap">{record.notes}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
