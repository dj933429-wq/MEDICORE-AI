'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { db } from '../../../lib/firebase';
import { collection, addDoc, getDocs, query, orderBy } from 'firebase/firestore';

interface Medicine {
  id: string;
  name: string;
  batch: string;
  expiry: string;
  stock: number;
}

export default function PharmacistDashboard() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Form State
  const [name, setName] = useState('');
  const [batch, setBatch] = useState('');
  const [expiry, setExpiry] = useState('');
  const [stock, setStock] = useState('');
  
  // UI State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [error, setError] = useState('');

  // Inventory State
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [isLoadingInventory, setIsLoadingInventory] = useState(true);

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push('/login');
      } else if (user.role !== 'pharmacist') {
        router.push('/dashboard');
      } else {
        fetchInventory();
      }
    }
  }, [user, loading, router]);

  const fetchInventory = async () => {
    if (!user) return;
    setIsLoadingInventory(true);
    try {
      const q = query(
        collection(db, `inventory/${user.uid}/medicines`),
        orderBy('createdAt', 'desc')
      );
      const querySnapshot = await getDocs(q);
      const meds: Medicine[] = [];
      querySnapshot.forEach((doc) => {
        meds.push({ id: doc.id, ...doc.data() } as Medicine);
      });
      setMedicines(meds);
    } catch (err) {
      console.error('Failed to fetch inventory:', err);
      // Fallback if query indexing fails or anything else
      try {
        const fallbackQ = collection(db, `inventory/${user.uid}/medicines`);
        const fallbackSnapshot = await getDocs(fallbackQ);
        const fallbackMeds: Medicine[] = [];
        fallbackSnapshot.forEach(doc => {
          fallbackMeds.push({ id: doc.id, ...doc.data() } as Medicine);
        });
        // Sort manually
        fallbackMeds.sort((a: any, b: any) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        setMedicines(fallbackMeds);
      } catch (innerErr) {
        console.error('Fallback query failed', innerErr);
      }
    } finally {
      setIsLoadingInventory(false);
    }
  };

  const handleAddMedicine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!name || !batch || !expiry || !stock) {
      setError('Please fill out all fields.');
      return;
    }
    
    setError('');
    setSuccessMessage('');
    setIsSubmitting(true);

    try {
      await addDoc(collection(db, `inventory/${user.uid}/medicines`), {
        name,
        batch,
        expiry,
        stock: parseInt(stock, 10),
        createdBy: user.uid,
        createdAt: new Date()
      });
      
      setSuccessMessage('Medicine added successfully!');
      setName('');
      setBatch('');
      setExpiry('');
      setStock('');
      
      // Refresh inventory
      fetchInventory();
      
      // Clear message after 3 seconds
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to add medicine.');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleScanImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanning(true);
    setScanError('');
    setSuccessMessage('');
    setError('');

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64 = reader.result;
        
        const response = await fetch('/api/scan-medicine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64 })
        });
        
        if (!response.ok) {
          throw new Error('Scan failed');
        }
        
        const data = await response.json();
        
        if (data.name) setName(data.name);
        if (data.batch) setBatch(data.batch);
        if (data.expiry) setExpiry(data.expiry);
        
        setSuccessMessage('Scanned successfully. Please review and fill quantity.');
        setIsScanning(false);
      };
      
      reader.onerror = () => {
        throw new Error('File read failed');
      };
    } catch (err) {
      console.error(err);
      setScanError('Unable to detect. Please enter manually.');
      setIsScanning(false);
    } finally {
      e.target.value = '';
    }
  };

  if (loading || !user || user.role !== 'pharmacist') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-16 h-16 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-12 font-sans text-slate-800">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-extrabold text-slate-800 tracking-tight">
              Pharmacist <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-teal-600">Inventory</span>
            </h1>
            <p className="text-slate-500 mt-2 text-lg">Manage medicines securely from your personal dashboard.</p>
          </div>
          <button 
            onClick={() => router.push('/dashboard')}
            className="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 hover:text-slate-900 transition-all font-medium shadow-sm"
          >
            ← Back to Router
          </button>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Add Medicine Form (Left Column) */}
          <div className="bg-white rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 lg:col-span-1 h-fit">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                </span>
                Add Medicine
              </h2>
              
              <label className="cursor-pointer inline-flex items-center justify-center bg-blue-50 text-blue-600 hover:bg-blue-100 px-3 py-2 rounded-lg font-semibold text-sm transition-colors" title="Scan Medicine Image">
                {isScanning ? (
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                ) : (
                  <>
                    <svg className="w-5 h-5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                    Scan
                  </>
                )}
                <input type="file" accept="image/*" onChange={handleScanImage} className="hidden" disabled={isScanning} />
              </label>
            </div>

            {error && (
              <div className="mb-6 p-4 rounded-xl bg-red-50 text-red-700 text-sm font-medium border border-red-100 flex items-start gap-3">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                {error}
              </div>
            )}
            
            {scanError && (
              <div className="mb-6 p-4 rounded-xl bg-orange-50 text-orange-700 text-sm font-medium border border-orange-100 flex items-start gap-3">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                {scanError}
              </div>
            )}
            
            {successMessage && (
              <div className="mb-6 p-4 rounded-xl bg-emerald-50 text-emerald-700 text-sm font-medium border border-emerald-100 flex items-start gap-3">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                {successMessage}
              </div>
            )}

            <form onSubmit={handleAddMedicine} className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Medicine Name</label>
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                  placeholder="e.g. Paracetamol 500mg"
                />
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Batch Number</label>
                <input 
                  type="text" 
                  value={batch}
                  onChange={(e) => setBatch(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                  placeholder="e.g. BATCH-2023X"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Expiry Date</label>
                  <input 
                    type="month" 
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Stock Qty</label>
                  <input 
                    type="number" 
                    min="0"
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                    placeholder="e.g. 100"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3.5 px-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold rounded-xl shadow-[0_4px_14px_0_rgba(16,185,129,0.39)] hover:shadow-[0_6px_20px_rgba(16,185,129,0.23)] transition-all disabled:opacity-70 disabled:cursor-not-allowed mt-2"
              >
                {isSubmitting ? 'Adding...' : 'Add to Inventory'}
              </button>
            </form>
          </div>

          {/* Inventory Display (Right Column) */}
          <div className="bg-white rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 lg:col-span-2 flex flex-col min-h-[500px]">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-bold flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                </span>
                Current Inventory
              </h2>
              <div className="px-4 py-1.5 bg-slate-100 text-slate-600 font-semibold rounded-full text-sm">
                {medicines.length} Items
              </div>
            </div>

            {isLoadingInventory ? (
              <div className="flex-1 flex flex-col items-center justify-center space-y-4">
                <div className="w-10 h-10 border-4 border-slate-100 border-t-emerald-500 rounded-full animate-spin"></div>
                <p className="text-slate-500 font-medium animate-pulse">Loading stock data...</p>
              </div>
            ) : medicines.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center text-slate-300 shadow-sm mb-4">
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path></svg>
                </div>
                <h3 className="text-xl font-bold text-slate-700 mb-2">Inventory Empty</h3>
                <p className="text-slate-500 max-w-sm">No medicines added yet. Use the form on the left to start building your inventory.</p>
              </div>
            ) : (
              <div className="flex-1 overflow-x-auto -mx-8 px-8">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 text-sm uppercase tracking-wider font-semibold">
                      <th className="pb-4 pt-1 px-4 cursor-default">Medicine Name</th>
                      <th className="pb-4 pt-1 px-4 cursor-default text-center">Batch No.</th>
                      <th className="pb-4 pt-1 px-4 cursor-default text-center">Expiry</th>
                      <th className="pb-4 pt-1 px-4 cursor-default text-right">Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {medicines.map((med) => (
                      <tr key={med.id} className="hover:bg-slate-50/80 transition-colors group">
                        <td className="py-4 px-4 whitespace-nowrap">
                          <span className="font-bold text-slate-800">{med.name}</span>
                        </td>
                        <td className="py-4 px-4 text-center">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-slate-100 text-slate-600 text-xs font-mono font-medium">
                            {med.batch}
                          </span>
                        </td>
                        <td className="py-4 px-4 text-center">
                          <span className={`${
                            new Date(med.expiry) <= new Date() ? 'text-red-600 font-bold' : 'text-slate-500 font-medium'
                          }`}>
                            {med.expiry || 'N/A'}
                          </span>
                        </td>
                        <td className="py-4 px-4 text-right">
                          <span className={`inline-flex items-center justify-center min-w-[3rem] px-3 py-1.5 rounded-full text-sm font-bold ${
                            med.stock <= 10 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'
                          }`}>
                            {med.stock}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            
          </div>

        </div>
      </div>
    </div>
  );
}
