'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const mockAppointments = [
  {
    id: '1',
    doctor: 'Dr. Smith',
    date: '2023-11-15',
    time: '10:00 AM',
    status: 'Confirmed',
  },
  {
    id: '2',
    doctor: 'Dr. Jones',
    date: '2023-11-20',
    time: '2:30 PM',
    status: 'Pending',
  },
];

const mockMedicalHistory = [
  {
    id: '1',
    date: '2023-10-26',
    diagnosis: 'Common Cold',
    prescription: 'Rest and fluids',
  },
  {
    id: '2',
    date: '2023-08-12',
    diagnosis: 'Allergies',
    prescription: 'Antihistamines',
  },
];

export default function PatientDashboard() {
  const [appointments, setAppointments] = useState(mockAppointments);
  const [medicalHistory, setMedicalHistory] = useState(mockMedicalHistory);
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-800 mb-6">Patient Dashboard</h1>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Appointments Section */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Your Appointments</h2>
            <button className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded mb-4">Book New Appointment</button>
            <div className="space-y-4">
              {appointments.map(appointment => (
                <div key={appointment.id} className="p-4 rounded-lg border border-gray-200">
                  <p className="font-bold">Dr. {appointment.doctor}</p>
                  <p>{appointment.date} at {appointment.time}</p>
                  <p>Status: <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${appointment.status === 'Confirmed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{appointment.status}</span></p>
                </div>
              ))}
            </div>
          </div>
          {/* Medical History Section */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Medical History</h2>
            <div className="space-y-4">
              {medicalHistory.map(record => (
                <div key={record.id} className="p-4 rounded-lg border border-gray-200">
                  <p className="font-bold">{record.date}</p>
                  <p><span className="font-semibold">Diagnosis:</span> {record.diagnosis}</p>
                  <p><span className="font-semibold">Prescription:</span> {record.prescription}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
