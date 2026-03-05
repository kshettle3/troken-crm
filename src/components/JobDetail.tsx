import React, { useEffect, useState } from 'react';
import { ArrowLeft, Edit, Trash2, Calendar, DollarSign, AlertTriangle } from 'lucide-react';
import { Job, Service } from '../types';
import { formatCurrency, formatDate, calcSubPay, calcMyProfit, getStatusColor } from '../utils/helpers';
import { PropertyNotes } from './PropertyNotes';
import { PropertyContacts } from './PropertyContacts';
import { db } from '../db'

interface JobDetailProps {
  jobId: number;
  onBack: () => void;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
}

export const JobDetail: React.FC<JobDetailProps> = ({ jobId, onBack, onEdit, onDelete }) => {
  const [job, setJob] = useState<Job | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [jobId]);

  async function loadData() {
    setLoading(true);
    try {
      const jobRows = await db.query(
        `SELECT j.*, s.name as sub_name FROM jobs j LEFT JOIN subs s ON j.sub_id = s.id WHERE j.id = ${jobId}`
      );
      if (jobRows.length > 0) setJob(jobRows[0] as unknown as Job);

      const svcRows = await db.query(
        `SELECT * FROM services WHERE job_id = ${jobId} ORDER BY deadline ASC`
      );
      setServices(svcRows as unknown as Service[]);
    } catch (err) {
      console.error('Failed to load job detail:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="flex justify-center p-12"><span className="loading loading-spinner loading-lg text-primary" /></div>;
  if (!job) return <div className="p-4"><div className="alert alert-error">Job not found</div></div>;

  const subPay = services.reduce((sum, s) => {
    if (s.sub_per_visit_rate != null && s.total_visits != null) return sum + s.sub_per_visit_rate * s.total_visits;
    if (s.sub_per_visit_rate != null && s.per_visit_rate != null && s.per_visit_rate > 0 && s.total_value != null) {
      return sum + s.sub_per_visit_rate * Math.round(s.total_value / s.per_visit_rate);
    }
    return sum;
  }, 0);
  const profit = (job.total_contract_value ?? 0) - subPay;
  const totalVisits = services.reduce((sum, s) => sum + (s.total_visits ?? 0), 0);
  // Use stored per-visit rates from the contract (no calculating)
  const routineServices = services.filter(s => (s.total_value ?? 0) > 0 && s.service_type.toLowerCase().includes('routine'));
  const routineVisitRate = routineServices.length > 0 ? (routineServices[0].per_visit_rate ?? 0) : 0;
  const perVisitSub = routineServices.length > 0 ? (routineServices[0].sub_per_visit_rate ?? 0) : 0;
  const perVisitProfit = routineVisitRate - perVisitSub;
  const billableVisits = services.filter(s => (s.total_value ?? 0) > 0).reduce((sum, s) => sum + (s.total_visits ?? 0), 0);

  // Flag upcoming deadlines (within 30 days)
  const now = new Date();
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={18} /></button>
        <div className="flex-1">
          <h2 className="text-xl font-bold">{job.property_name}</h2>
          <p className="text-sm text-base-content/60">{job.property_address}</p>
        </div>
        <span className={`badge ${getStatusColor(job.status)}`}>{job.status}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => onEdit(job.id)}><Edit size={16} /></button>
        <button className="btn btn-ghost btn-sm text-error" onClick={() => onDelete(job.id)}><Trash2 size={16} /></button>
      </div>

      {/* Client & Agreement Info */}
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-base-content/60">Client</div>
              <div className="font-medium">{job.client_name ?? '—'}</div>
            </div>
            <div>
              <div className="text-base-content/60">Store #</div>
              <div className="font-medium">{job.store_number ?? '—'}</div>
            </div>
            <div>
              <div className="text-base-content/60">Agreement #</div>
              <div className="font-medium">{job.agreement_number ?? '—'}</div>
            </div>
            <div>
              <div className="text-base-content/60">Term</div>
              <div className="font-medium">{formatDate(job.contract_start)} — {formatDate(job.contract_end)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Financials */}
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <h3 className="font-semibold flex items-center gap-2 mb-3"><DollarSign size={16} className="opacity-60" /> Financials</h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-base-content/60 text-sm">DMG Pays You</div>
              <div className="text-xl font-bold">{formatCurrency(job.total_contract_value)}</div>
            </div>
            <div>
              <div className="text-base-content/60 text-sm">Sub ({job.sub_name ?? 'Unassigned'})</div>
              <div className="text-xl font-bold">{formatCurrency(subPay)}</div>
            </div>
            <div>
              <div className="text-base-content/60 text-sm">Your Profit</div>
              <div className="text-xl font-bold text-success">{formatCurrency(profit)}</div>
            </div>
          </div>
          {totalVisits > 0 && (
            <>
              <div className="divider my-2 text-xs text-base-content/40">Per Visit ({billableVisits} routine visits)</div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-base-content/60 text-sm">Routine Visit Rate</div>
                  <div className="text-lg font-bold">{formatCurrency(routineVisitRate)}</div>
                </div>
                <div>
                  <div className="text-base-content/60 text-sm">Per Visit Sub Cost</div>
                  <div className="text-lg font-bold">{formatCurrency(perVisitSub)}</div>
                </div>
                <div>
                  <div className="text-base-content/60 text-sm">Per Visit Profit</div>
                  <div className="text-lg font-bold text-success">{formatCurrency(perVisitProfit)}</div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Services */}
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <h3 className="font-semibold flex items-center gap-2 mb-3"><Calendar size={16} className="opacity-60" /> Services</h3>
          {services.length === 0 ? (
            <p className="text-base-content/60 text-sm">No services added yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm w-full">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Value</th>
                    <th>Visits</th>
                    <th>Per Visit</th>
                    <th>Schedule</th>
                    <th>Deadline</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map(svc => {
                    const deadlineDate = svc.deadline ? new Date(svc.deadline) : null;
                    const isUpcoming = deadlineDate && deadlineDate >= now && deadlineDate <= soon;
                    const isPast = deadlineDate && deadlineDate < now;
                    return (
                      <tr key={svc.id}>
                        <td className="font-medium">{svc.service_type}</td>
                        <td>{formatCurrency(svc.total_value)}</td>
                        <td>{svc.total_visits ?? '—'}</td>
                        <td>{svc.per_visit_rate ? formatCurrency(svc.per_visit_rate) : '—'}</td>
                        <td className="text-sm">{svc.schedule_description ?? '—'}</td>
                        <td>
                          {svc.deadline ? (
                            <span className={`flex items-center gap-1 ${isPast ? 'text-error' : isUpcoming ? 'text-warning' : ''}`}>
                              {(isPast || isUpcoming) && <AlertTriangle size={14} />}
                              {formatDate(svc.deadline)}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Notes — Owner sees Internal + Shared */}
      <PropertyNotes jobId={jobId} viewMode="owner" />

      {/* Contacts — Owner only */}
      <PropertyContacts jobId={jobId} />
    </div>
  );
};
