import React, { useEffect, useState } from 'react';
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react';
import { Job, Sub, Service } from '../types';
import { db } from '../db'

interface JobFormProps {
  editJobId: number | null;
  subs: Sub[];
  onSave: () => void;
  onCancel: () => void;
}

interface ServiceForm {
  id?: number;
  service_type: string;
  total_value: string;
  total_visits: string;
  schedule_description: string;
  deadline: string;
  notes: string;
}

const emptyService = (): ServiceForm => ({
  service_type: '', total_value: '', total_visits: '', schedule_description: '', deadline: '', notes: ''
});

export const JobForm: React.FC<JobFormProps> = ({ editJobId, subs, onSave, onCancel }) => {
  const [propertyName, setPropertyName] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [clientName, setClientName] = useState('');
  const [storeNumber, setStoreNumber] = useState('');
  const [agreementNumber, setAgreementNumber] = useState('');
  const [contractStart, setContractStart] = useState('');
  const [contractEnd, setContractEnd] = useState('');
  const [totalContractValue, setTotalContractValue] = useState('');
  const [subId, setSubId] = useState<string>('');
  const [subRatePct, setSubRatePct] = useState('80');
  const [status, setStatus] = useState('active');
  const [notes, setNotes] = useState('');
  const [services, setServices] = useState<ServiceForm[]>([emptyService()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editJobId) loadExisting();
  }, [editJobId]);

  async function loadExisting() {
    try {
      const rows = await db.query(`SELECT * FROM jobs WHERE id = ${editJobId}`);
      if (rows.length > 0) {
        const j = rows[0] as unknown as Job;
        setPropertyName(j.property_name);
        setPropertyAddress(j.property_address ?? '');
        setClientName(j.client_name ?? '');
        setStoreNumber(j.store_number ?? '');
        setAgreementNumber(j.agreement_number ?? '');
        setContractStart(j.contract_start ?? '');
        setContractEnd(j.contract_end ?? '');
        setTotalContractValue(j.total_contract_value?.toString() ?? '');
        setSubId(j.sub_id?.toString() ?? '');
        setSubRatePct(j.sub_rate_pct?.toString() ?? '80');
        setStatus(j.status);
        setNotes(j.notes ?? '');
      }
      const svcRows = await db.query(`SELECT * FROM services WHERE job_id = ${editJobId}`);
      if (svcRows.length > 0) {
        setServices((svcRows as unknown as Service[]).map(s => ({
          id: s.id,
          service_type: s.service_type,
          total_value: s.total_value?.toString() ?? '',
          total_visits: s.total_visits?.toString() ?? '',
          schedule_description: s.schedule_description ?? '',
          deadline: s.deadline ?? '',
          notes: s.notes ?? ''
        })));
      }
    } catch (err) {
      console.error('Failed to load job for editing:', err);
    }
  }

  function addService() {
    setServices(prev => [...prev, emptyService()]);
  }

  function removeService(idx: number) {
    setServices(prev => prev.filter((_, i) => i !== idx));
  }

  function updateService(idx: number, field: keyof ServiceForm, value: string) {
    setServices(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  }

  function escSql(str: string): string {
    return str.replace(/'/g, "''");
  }

  async function handleSave() {
    if (!propertyName.trim()) return;
    setSaving(true);
    try {
      const valNum = totalContractValue ? parseFloat(totalContractValue) : null;
      const subIdNum = subId ? parseInt(subId) : null;
      const ratePctNum = subRatePct ? parseFloat(subRatePct) : null;

      let jobId = editJobId;
      if (editJobId) {
        await db.execute(`UPDATE jobs SET
          property_name='${escSql(propertyName)}',
          property_address='${escSql(propertyAddress)}',
          client_name='${escSql(clientName)}',
          store_number='${escSql(storeNumber)}',
          agreement_number='${escSql(agreementNumber)}',
          contract_start=${contractStart ? `'${escSql(contractStart)}'` : 'NULL'},
          contract_end=${contractEnd ? `'${escSql(contractEnd)}'` : 'NULL'},
          total_contract_value=${valNum ?? 'NULL'},
          sub_id=${subIdNum ?? 'NULL'},
          sub_rate_pct=${ratePctNum ?? 'NULL'},
          status='${escSql(status)}',
          notes='${escSql(notes)}'
          WHERE id=${editJobId}`);
        // Remove old services
        await db.execute(`DELETE FROM services WHERE job_id=${editJobId}`);
      } else {
        const newRows = await db.query(`INSERT INTO jobs (property_name, property_address, client_name, store_number, agreement_number, contract_start, contract_end, total_contract_value, sub_id, sub_rate_pct, status, notes) VALUES (
          '${escSql(propertyName)}',
          '${escSql(propertyAddress)}',
          '${escSql(clientName)}',
          '${escSql(storeNumber)}',
          '${escSql(agreementNumber)}',
          ${contractStart ? `'${escSql(contractStart)}'` : 'NULL'},
          ${contractEnd ? `'${escSql(contractEnd)}'` : 'NULL'},
          ${valNum ?? 'NULL'},
          ${subIdNum ?? 'NULL'},
          ${ratePctNum ?? 'NULL'},
          '${escSql(status)}',
          '${escSql(notes)}'
        ) RETURNING id`);
        jobId = (newRows[0] as any).id;
      }

      // Insert services
      for (const svc of services) {
        if (!svc.service_type.trim()) continue;
        const svcVal = svc.total_value ? parseFloat(svc.total_value) : null;
        const svcVisits = svc.total_visits ? parseInt(svc.total_visits) : null;
        await db.execute(`INSERT INTO services (job_id, service_type, total_value, total_visits, schedule_description, deadline, notes) VALUES (
          ${jobId},
          '${escSql(svc.service_type)}',
          ${svcVal ?? 'NULL'},
          ${svcVisits ?? 'NULL'},
          '${escSql(svc.schedule_description)}',
          ${svc.deadline ? `'${escSql(svc.deadline)}'` : 'NULL'},
          '${escSql(svc.notes)}'
        )`);
      }
      onSave();
    } catch (err) {
      console.error('Failed to save job:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <button className="btn btn-ghost btn-sm" onClick={onCancel}><ArrowLeft size={18} /></button>
        <h2 className="text-xl font-bold">{editJobId ? 'Edit Job' : 'Add New Job'}</h2>
      </div>

      {/* Property Info */}
      <div className="card bg-base-200">
        <div className="card-body p-4 space-y-3">
          <h3 className="font-semibold">Property Info</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="label text-sm">Property Name *</label>
              <input className="input input-bordered w-full" value={propertyName} onChange={e => setPropertyName(e.target.value)} placeholder="e.g. 7-Eleven #35574" />
            </div>
            <div>
              <label className="label text-sm">Address</label>
              <input className="input input-bordered w-full" value={propertyAddress} onChange={e => setPropertyAddress(e.target.value)} placeholder="4847 Charlotte Hwy..." />
            </div>
            <div>
              <label className="label text-sm">Client Name</label>
              <input className="input input-bordered w-full" value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. 7-Eleven, Inc" />
            </div>
            <div>
              <label className="label text-sm">Store / Location #</label>
              <input className="input input-bordered w-full" value={storeNumber} onChange={e => setStoreNumber(e.target.value)} placeholder="35574" />
            </div>
          </div>
        </div>
      </div>

      {/* Contract Details */}
      <div className="card bg-base-200">
        <div className="card-body p-4 space-y-3">
          <h3 className="font-semibold">Contract Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="label text-sm">Agreement #</label>
              <input className="input input-bordered w-full" value={agreementNumber} onChange={e => setAgreementNumber(e.target.value)} />
            </div>
            <div>
              <label className="label text-sm">Start Date</label>
              <input type="date" className="input input-bordered w-full" value={contractStart} onChange={e => setContractStart(e.target.value)} />
            </div>
            <div>
              <label className="label text-sm">End Date</label>
              <input type="date" className="input input-bordered w-full" value={contractEnd} onChange={e => setContractEnd(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="label text-sm">Total Contract Value ($)</label>
              <input type="number" step="0.01" className="input input-bordered w-full" value={totalContractValue} onChange={e => setTotalContractValue(e.target.value)} />
            </div>
            <div>
              <label className="label text-sm">Assign Sub</label>
              <select className="select select-bordered w-full" value={subId} onChange={e => setSubId(e.target.value)}>
                <option value="">Unassigned</option>
                {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-sm">Sub Rate (%)</label>
              <input type="number" step="1" className="input input-bordered w-full" value={subRatePct} onChange={e => setSubRatePct(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label text-sm">Status</label>
            <select className="select select-bordered w-full max-w-xs" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
      </div>

      {/* Services */}
      <div className="card bg-base-200">
        <div className="card-body p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Services</h3>
            <button className="btn btn-ghost btn-sm" onClick={addService}><Plus size={14} /> Add Service</button>
          </div>
          {services.map((svc, idx) => (
            <div key={idx} className="bg-base-300 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Service {idx + 1}</span>
                {services.length > 1 && (
                  <button className="btn btn-ghost btn-xs text-error" onClick={() => removeService(idx)}><Trash2 size={14} /></button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <input className="input input-bordered input-sm w-full" placeholder="Service type" value={svc.service_type} onChange={e => updateService(idx, 'service_type', e.target.value)} />
                <input type="number" step="0.01" className="input input-bordered input-sm w-full" placeholder="Value ($)" value={svc.total_value} onChange={e => updateService(idx, 'total_value', e.target.value)} />
                <input type="number" className="input input-bordered input-sm w-full" placeholder="# Visits" value={svc.total_visits} onChange={e => updateService(idx, 'total_visits', e.target.value)} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input className="input input-bordered input-sm w-full" placeholder="Schedule (e.g. Weekly Apr-Oct)" value={svc.schedule_description} onChange={e => updateService(idx, 'schedule_description', e.target.value)} />
                <input type="date" className="input input-bordered input-sm w-full" placeholder="Deadline" value={svc.deadline} onChange={e => updateService(idx, 'deadline', e.target.value)} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <h3 className="font-semibold mb-2">Notes</h3>
          <textarea className="textarea textarea-bordered w-full" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any additional notes..." />
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || !propertyName.trim()}>
          {saving ? <span className="loading loading-spinner loading-sm" /> : <Save size={16} />}
          {editJobId ? 'Update Job' : 'Save Job'}
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
};
