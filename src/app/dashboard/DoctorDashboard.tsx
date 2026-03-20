'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const mockPatients = [
  {
    id: '1',
    name: 'John Doe',
    lastVisit: '2023-10-26',
    diagnosis: 'Common Cold',
  },
  {
    id: '2',
    name: 'Jane Smith',
    lastVisit: '2023-10-25',
    diagnosis: 'Flu',
  },
  {
    id: '3',
    name: 'Peter Jones',
    lastVisit: '2023-10-24',
    diagnosis: 'Migraine',
  },
];

export default function DoctorDashboard() {
  const [patients, setPatients] = useState(mockPatients);
  const [searchTerm, setSearchTerm] = useState('');
  const router = useRouter();

  const handleViewRecord = (patientId) => {
    router.push(`/dashboard/patients/${patientId}`);
  };

  const filteredPatients = patients.filter(patient =>
    patient.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto bg-white rounded-lg shadow-md p-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-6">Doctor Dashboard</h1>
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search for patients"
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPatients.map(patient => (
            <div key={patient.id} className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow">
              <h3 className="text-xl font-bold text-gray-800 mb-2">{patient.name}</h3>
              <p className="text-gray-600 mb-1"><span className="font-semibold">Last Visit:</span> {patient.lastVisit}</p>
              <p className="text-gray-600 mb-4"><span className="font-semibold">Diagnosis:</span> {patient.diagnosis}</p>
              <button
                onClick={() => handleViewRecord(patient.id)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
              >
                View Records
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
