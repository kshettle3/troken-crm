import React, { useState, useEffect, useRef } from 'react';
import { db } from '../db';
import { supabase } from '../supabase';
import { formatCurrency, formatDate } from '../utils/helpers';

interface Props {
  onBack: () => void;
}

interface PropertyInfo {
  job_id: number;
  property_name: string;
  property_address: string;
  per_visit_rate: number;
  visits_this_month: number;
}

interface Invoice {
  id: number;
  job_id: number;
  property_name: string;
  visit_date: string;
  photo_urls: string[];
  status: 'submitted' | 'approved' | 'paid';
  due_date: string;
  paid_date: string | null;
  amount: number;
  notes: string | null;
  created_at: string;
}

export const OsegueraPortal: React.FC<Props> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<'home' | 'sites' | 'pay' | 'submit'>('home');
  const [properties, setProperties] = useState<PropertyInfo[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  // Submit visit state
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [selectedPropertyName, setSelectedPropertyName] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const today = new Date();
  const todayStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const firstOfMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      // Load properties
      const jobRows = await db.query(
        `SELECT j.id as job_id, j.property_name, j.property_address FROM jobs j WHERE j.sub_id = 3 AND j.metro = 'Aiken' ORDER BY j.property_name`
      );

      const props: PropertyInfo[] = [];
      for (const j of jobRows as any[]) {
        const rateRows = await db.query(
          `SELECT per_visit_rate FROM services WHERE job_id = ${j.job_id} AND service_type LIKE '%Landscape%' LIMIT 1`
        );
        const rate = rateRows.length > 0 ? (rateRows[0] as any).per_visit_rate : 0;

        const visitRows = await db.query(
          `SELECT COUNT(*) as cnt FROM aiken_invoices WHERE job_id = ${j.job_id} AND visit_date >= '${firstOfMonth}'`
        );
        const visits = visitRows.length > 0 ? Number((visitRows[0] as any).cnt) : 0;

        props.push({
          job_id: j.job_id,
          property_name: j.property_name,
          property_address: j.property_address || '',
          per_visit_rate: rate,
          visits_this_month: visits,
        });
      }
      setProperties(props);

      // Load invoices
      const invRows = await db.query(
        `SELECT * FROM aiken_invoices ORDER BY visit_date DESC`
      );
      setInvoices(invRows as unknown as Invoice[]);
    } catch (err) {
      console.error('Failed to load Oseguera data:', err);
    } finally {
      setLoading(false);
    }
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'submitted': return <span className="badge badge-warning badge-sm">Submitted</span>;
      case 'approved': return <span className="badge badge-info badge-sm">Approved</span>;
      case 'paid': return <span className="badge badge-success badge-sm">Paid</span>;
      default: return <span className="badge badge-ghost badge-sm">{status}</span>;
    }
  }

  function getDueCountdown(dueDate: string, status: string) {
    if (status === 'paid') return null;
    const due = new Date(dueDate + 'T00:00:00');
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > 0) {
      return <span className="text-xs text-base-content/50">Due in {diffDays} days</span>;
    } else if (diffDays === 0) {
      return <span className="text-xs text-warning">Due today</span>;
    } else {
      return <span className="text-xs text-error">Overdue by {Math.abs(diffDays)} days</span>;
    }
  }

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    const remaining = 10 - photos.length;
    const newPhotos = files.slice(0, remaining);
    const allPhotos = [...photos, ...newPhotos];
    setPhotos(allPhotos);

    // Generate preview URLs
    const newUrls = newPhotos.map(f => URL.createObjectURL(f));
    setPhotoPreviewUrls(prev => [...prev, ...newUrls]);
  }

  function removePhoto(index: number) {
    URL.revokeObjectURL(photoPreviewUrls[index]);
    setPhotos(prev => prev.filter((_, i) => i !== index));
    setPhotoPreviewUrls(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSubmitVisit() {
    if (!selectedJobId || photos.length === 0) return;
    setSubmitting(true);
    setSubmitSuccess(null);

    try {
      const dateStr = today.toISOString().split('T')[0];
      const uploadedUrls: string[] = [];

      // Step 1: Upload each photo to Supabase Storage
      for (let i = 0; i < photos.length; i++) {
        const file = photos[i];
        const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const path = `${selectedJobId}/${dateStr}/${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from('aiken-visit-photos')
          .upload(path, file, { contentType: file.type || 'image/jpeg' });

        if (uploadError) {
          alert(`Photo upload failed (${i + 1}/${photos.length}): ${uploadError.message}`);
          return;
        }

        uploadedUrls.push(path);
      }

      // Step 2: Get amount from properties state
      const prop = properties.find(p => p.job_id === selectedJobId);
      const amount = prop ? prop.per_visit_rate : 0;

      // Step 3: Build photo paths array and insert invoice
      const pathArrayStr = uploadedUrls.map(u => `'${u.replace(/'/g, "''")}'`).join(',');

      try {
        await db.execute(
          `INSERT INTO aiken_invoices (job_id, property_name, visit_date, photo_urls, invoice_status, payment_due_date, amount, photos_submitted_at)
           VALUES (${selectedJobId}, '${selectedPropertyName.replace(/'/g, "''")}', CURRENT_DATE, ARRAY[${pathArrayStr}], 'pending', CURRENT_DATE + INTERVAL '30 days', ${amount}, NOW())`
        );
      } catch (dbErr: any) {
        alert(`Photos uploaded but invoice save failed: ${dbErr?.message || 'Unknown error'}`);
        return;
      }

      const dueDate = new Date(today);
      dueDate.setDate(dueDate.getDate() + 30);
      setSubmitSuccess(`Visit submitted! Payment of ${formatCurrency(amount)} due by ${formatDate(dueDate.toISOString().split('T')[0])}`);

      // Step 4: Fire webhook → agent emails TC + texts Kenny (non-blocking)
      const webhookUrl = import.meta.env.VITE_OSEGUERA_WEBHOOK;
      if (webhookUrl) {
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'oseguera_visit_submitted',
            property_name: selectedPropertyName,
            job_id: selectedJobId,
            visit_date: dateStr,
            photo_paths: uploadedUrls,
            amount,
          }),
        }).catch(() => {});
      }

      // Reset form
      setPhotos([]);
      setPhotoPreviewUrls([]);
      setSelectedJobId(null);
      setSelectedPropertyName('');
      if (fileInputRef.current) fileInputRef.current.value = '';

      // Reload data
      await loadData();
    } catch (err: any) {
      console.error('Submit failed:', err);
      alert(`Submit failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  const totalOwed = invoices
    .filter(inv => inv.status !== 'paid')
    .reduce((sum, inv) => sum + Number(inv.amount), 0);

  const recentSubmissions = invoices.slice(0, 3);

  return (
    <div className="min-h-screen bg-base-100 max-w-md mx-auto p-4 pb-24">
      {/* Home Tab */}
      {activeTab === 'home' && (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-xl font-bold">Hey Team 👋</h1>
              <p className="text-xs text-base-content/50 mt-1">{todayStr}</p>
            </div>
            <button onClick={onBack} className="btn btn-ghost btn-sm text-xs">Logout</button>
          </div>

          {/* Nav Tiles */}
          <div className="grid grid-cols-3 gap-3">
            <button
              className="bg-base-200 hover:bg-base-300 active:scale-95 rounded-xl p-4 text-center transition-all"
              onClick={() => setActiveTab('sites')}
            >
              <div className="text-2xl mb-1">📍</div>
              <div className="font-bold text-sm">Sites</div>
              <div className="text-xs text-base-content/50">2 properties</div>
            </button>
            <button
              className="bg-base-200 hover:bg-base-300 active:scale-95 rounded-xl p-4 text-center transition-all"
              onClick={() => setActiveTab('pay')}
            >
              <div className="text-2xl mb-1">💰</div>
              <div className="font-bold text-sm">Pay</div>
              <div className="text-xs text-base-content/50">Payment status</div>
            </button>
            <button
              className="bg-base-200 hover:bg-base-300 active:scale-95 rounded-xl p-4 text-center transition-all"
              onClick={() => setActiveTab('submit')}
            >
              <div className="text-2xl mb-1">📸</div>
              <div className="font-bold text-sm">Submit Visit</div>
              <div className="text-xs text-base-content/50">Upload photos</div>
            </button>
          </div>

          {/* Recent Submissions */}
          <div>
            <h3 className="font-bold text-sm mb-2">Recent Submissions</h3>
            {recentSubmissions.length === 0 ? (
              <div className="bg-base-200 rounded-xl p-4 text-center text-sm text-base-content/50">
                No submissions yet. Submit your first visit!
              </div>
            ) : (
              <div className="space-y-2">
                {recentSubmissions.map(inv => (
                  <div key={inv.id} className="bg-base-200 rounded-xl p-3 flex justify-between items-center">
                    <div>
                      <div className="text-sm font-medium">{inv.property_name}</div>
                      <div className="text-xs text-base-content/50">{formatDate(inv.visit_date)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold">{formatCurrency(inv.amount)}</div>
                      {getStatusBadge(inv.status)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sites Tab */}
      {activeTab === 'sites' && (
        <div className="space-y-4">
          <button onClick={() => setActiveTab('home')} className="flex items-center gap-1 text-sm text-base-content/60 hover:text-base-content">← Home</button>
          <h2 className="text-lg font-bold">Your Properties</h2>

          {properties.map(prop => (
            <div key={prop.job_id} className="bg-base-200 rounded-xl p-4 space-y-2">
              <div className="font-bold text-sm">{prop.property_name}</div>
              <div className="text-xs text-base-content/50">{prop.property_address}</div>
              <div className="flex justify-between items-center mt-2">
                <div>
                  <span className="text-sm font-semibold text-primary">{formatCurrency(prop.per_visit_rate)}</span>
                  <span className="text-xs text-base-content/50 ml-1">/ visit</span>
                </div>
                <span className="text-xs text-base-content/50">2 visits / month</span>
              </div>
              <div className="text-xs text-base-content/40">
                {prop.visits_this_month} visit{prop.visits_this_month !== 1 ? 's' : ''} this month
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pay Tab */}
      {activeTab === 'pay' && (
        <div className="space-y-4">
          <button onClick={() => setActiveTab('home')} className="flex items-center gap-1 text-sm text-base-content/60 hover:text-base-content">← Home</button>
          <h2 className="text-lg font-bold">Payment Status</h2>

          {/* Total Owed */}
          <div className="bg-primary/10 rounded-xl p-4 text-center">
            <div className="text-xs text-base-content/50 mb-1">Total Owed</div>
            <div className="text-2xl font-bold text-primary">{formatCurrency(totalOwed)}</div>
          </div>

          {/* Invoice List */}
          <div className="space-y-2">
            {invoices.map(inv => (
              <div key={inv.id} className="bg-base-200 rounded-xl p-4 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-bold text-sm">{inv.property_name}</div>
                    <div className="text-xs text-base-content/50">{formatDate(inv.visit_date)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold">{formatCurrency(inv.amount)}</div>
                    {getStatusBadge(inv.status)}
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <div className="text-xs text-base-content/50">Due: {formatDate(inv.due_date)}</div>
                  {getDueCountdown(inv.due_date, inv.status)}
                </div>
                {inv.paid_date && (
                  <div className="text-xs text-success">Paid on {formatDate(inv.paid_date)}</div>
                )}
              </div>
            ))}
            {invoices.length === 0 && (
              <div className="bg-base-200 rounded-xl p-4 text-center text-sm text-base-content/50">
                No invoices yet.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Submit Visit Tab */}
      {activeTab === 'submit' && (
        <div className="space-y-4">
          <button onClick={() => { setActiveTab('home'); setSelectedJobId(null); setSelectedPropertyName(''); setPhotos([]); setPhotoPreviewUrls([]); setSubmitSuccess(null); }} className="flex items-center gap-1 text-sm text-base-content/60 hover:text-base-content">← Home</button>
          <h2 className="text-lg font-bold">Submit Visit</h2>

          {submitSuccess && (
            <div className="bg-success/10 border border-success/30 rounded-xl p-4 text-center">
              <div className="text-2xl mb-2">✅</div>
              <div className="text-sm font-medium text-success">{submitSuccess}</div>
            </div>
          )}

          {/* Step 1: Select Property */}
          <div>
            <div className="text-sm font-semibold mb-2">Step 1: Select Property</div>
            <div className="grid grid-cols-2 gap-3">
              {properties.map(prop => (
                <button
                  key={prop.job_id}
                  className={`rounded-xl p-3 text-left transition-all border-2 ${
                    selectedJobId === prop.job_id
                      ? 'border-primary bg-primary/10'
                      : 'border-base-300 bg-base-200 hover:bg-base-300'
                  }`}
                  onClick={() => { setSelectedJobId(prop.job_id); setSelectedPropertyName(prop.property_name); }}
                >
                  <div className="font-bold text-xs">{prop.property_name}</div>
                  <div className="text-xs text-base-content/50 mt-1">{formatCurrency(prop.per_visit_rate)} / visit</div>
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: Upload Photos */}
          {selectedJobId && (
            <div>
              <div className="text-sm font-semibold mb-2">Step 2: Upload Photos ({photos.length}/10)</div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handlePhotoSelect}
                className="file-input file-input-bordered file-input-sm w-full"
                disabled={photos.length >= 10}
              />

              {photoPreviewUrls.length > 0 && (
                <div className="grid grid-cols-5 gap-2 mt-3">
                  {photoPreviewUrls.map((url, i) => (
                    <div key={i} className="relative">
                      <img src={url} alt={`Photo ${i + 1}`} className="w-full h-16 object-cover rounded-lg" />
                      <button
                        onClick={() => removePhoto(i)}
                        className="absolute -top-1 -right-1 bg-error text-white rounded-full w-4 h-4 text-xs flex items-center justify-center"
                      >×</button>
                      <div className="text-[9px] text-center text-base-content/40 mt-0.5">
                        {i < 5 ? 'Before' : 'After'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Submit */}
          {selectedJobId && photos.length > 0 && !submitSuccess && (
            <button
              className="btn btn-primary w-full"
              onClick={handleSubmitVisit}
              disabled={submitting}
            >
              {submitting ? (
                <><span className="loading loading-spinner loading-sm" /> Uploading...</>
              ) : (
                `Submit Visit — ${formatCurrency(properties.find(p => p.job_id === selectedJobId)?.per_visit_rate || 0)}`
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
