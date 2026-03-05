import React, { useState, useEffect } from 'react';
import { PipelineJob, QuoteLineItem } from '../types';
import { db } from '../db'

interface Props {
  jobId: number;
  onBack: () => void;
  onEdit: (id: number) => void;
}

const stageLabel: Record<string, string> = { quote: 'Quote', bid: 'Bid', active: 'Active' };
const stageBadge: Record<string, string> = { quote: 'badge-warning', bid: 'badge-info', active: 'badge-success' };
const stageOrder: string[] = ['quote', 'bid', 'active'];
const categoryLabel: Record<string, string> = {
  time: 'Time (Labor)',
  material: 'Material',
  equipment: 'Equipment',
  trip_charge: 'Trip Charge',
  miscellaneous: 'Miscellaneous',
};

export const PipelineDetail: React.FC<Props> = ({ jobId, onBack, onEdit }) => {
  const [job, setJob] = useState<PipelineJob | null>(null);
  const [lineItems, setLineItems] = useState<QuoteLineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [ourBidInput, setOurBidInput] = useState<string>('');
  const [savingBid, setSavingBid] = useState(false);
  const [editingBid, setEditingBid] = useState(false);

  useEffect(() => {
    loadData();
  }, [jobId]);

  async function loadData() {
    const rows = await db.query(
      `SELECT p.*, s.name as sub_name FROM pipeline_jobs p LEFT JOIN subs s ON p.sub_id = s.id WHERE p.id = ${jobId}`
    ) as unknown as PipelineJob[];
    if (rows.length) setJob(rows[0]);

    const items = await db.query(
      `SELECT * FROM quote_line_items WHERE pipeline_job_id = ${jobId}`
    ) as unknown as QuoteLineItem[];
    setLineItems(items);
    setLoading(false);
  }

  async function moveStage(direction: 'forward' | 'back') {
    if (!job) return;
    const idx = stageOrder.indexOf(job.stage);
    const newIdx = direction === 'forward' ? idx + 1 : idx - 1;
    if (newIdx < 0 || newIdx >= stageOrder.length) return;
    const newStage = stageOrder[newIdx];
    await db.execute(
      `UPDATE pipeline_jobs SET stage = '${newStage}', updated_at = datetime('now') WHERE id = ${jobId}`
    );
    setJob({ ...job, stage: newStage as PipelineJob['stage'] });
  }

  async function saveOurBid() {
    const amt = parseFloat(ourBidInput.replace(/[^0-9.]/g, ''));
    if (isNaN(amt) || amt <= 0) return;
    setSavingBid(true);
    const now = new Date().toISOString();
    await db.execute(
      `UPDATE pipeline_jobs SET our_bid_total = ${amt}, updated_at = '${now}' WHERE id = ${jobId}`
    );
    await loadData();
    setSavingBid(false);
    setEditingBid(false);
    setOurBidInput('');
  }

  async function handleDelete() {
    await db.execute(`DELETE FROM quote_line_items WHERE pipeline_job_id = ${jobId}`);
    await db.execute(`DELETE FROM pipeline_jobs WHERE id = ${jobId}`);
    onBack();
  }

  if (loading || !job) return <div className="flex justify-center p-12"><span className="loading loading-spinner loading-lg text-primary" /></div>;

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
          <h1 className="text-2xl font-bold">{job.property_name}</h1>
          <span className={`badge ${stageBadge[job.stage]}`}>{stageLabel[job.stage]}</span>
          <span className="badge badge-ghost">{job.work_type === 'contract' ? 'Contract' : 'One-Time'}</span>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-outline btn-sm" onClick={() => onEdit(jobId)}>Edit</button>
          {!confirmDelete ? (
            <button className="btn btn-error btn-outline btn-sm" onClick={() => setConfirmDelete(true)}>Delete</button>
          ) : (
            <div className="flex gap-1">
              <button className="btn btn-error btn-sm" onClick={handleDelete}>Confirm</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          )}
        </div>
      </div>

      {/* Stage progression */}
      <div className="flex items-center gap-2 mb-6">
        <ul className="steps steps-horizontal w-full">
          {stageOrder.map(s => (
            <li key={s} className={`step ${stageOrder.indexOf(s) <= stageOrder.indexOf(job.stage) ? 'step-primary' : ''}`}>
              {stageLabel[s]}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex justify-center gap-2 mb-6">
        {stageOrder.indexOf(job.stage) > 0 && (
          <button className="btn btn-outline btn-sm" onClick={() => moveStage('back')}>
            ← Move to {stageLabel[stageOrder[stageOrder.indexOf(job.stage) - 1]]}
          </button>
        )}
        {stageOrder.indexOf(job.stage) < stageOrder.length - 1 && (
          <button className="btn btn-primary btn-sm" onClick={() => moveStage('forward')}>
            Move to {stageLabel[stageOrder[stageOrder.indexOf(job.stage) + 1]]} →
          </button>
        )}
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="card bg-base-100 shadow">
          <div className="card-body p-4">
            <h3 className="font-semibold text-sm text-base-content/60 uppercase">Details</h3>
            {job.property_address && <p className="text-sm">📍 {job.property_address}</p>}
            {job.client_name && <p className="text-sm">🏢 {job.client_name}</p>}
            {job.sub_name && <p className="text-sm">👷 Assigned: {job.sub_name}</p>}
            {job.deadline && <p className="text-sm">📅 Deadline: {job.deadline}</p>}
            {job.billing_to && <p className="text-sm">💰 Billing: {job.billing_to.charAt(0).toUpperCase() + job.billing_to.slice(1)}</p>}
            {job.work_type === 'one_time' && <p className="text-sm">📋 Quote: {job.quote_format === 'lump_sum' ? 'Lump Sum' : 'Full Breakdown'}</p>}
          </div>
        </div>
        <div className="card bg-base-100 shadow">
          <div className="card-body p-4 space-y-3">
            <h3 className="font-semibold text-sm text-base-content/60 uppercase">Financials</h3>

            {/* TC's submitted quote */}
            {job.sub_quote_total != null ? (
              <div className={`rounded p-3 space-y-1 ${job.sub_quote_submitted_at ? 'bg-info/10 border border-info/30' : 'bg-base-200'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-base-content/60 uppercase">
                    {job.sub_quote_submitted_at ? '✅ TC Submitted' : 'TC Quote'}
                  </span>
                  <span className="font-bold text-lg">${Math.round(job.sub_quote_total).toLocaleString()}</span>
                </div>
                {job.sub_quote_notes && (
                  <p className="text-xs text-base-content/60">"{job.sub_quote_notes}"</p>
                )}
                {job.sub_quote_submitted_at && (
                  <p className="text-xs text-base-content/40">
                    {new Date(job.sub_quote_submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </p>
                )}
              </div>
            ) : (
              <div className="bg-warning/10 border border-warning/30 rounded p-2">
                <p className="text-xs text-warning font-medium">⏳ Waiting on TC's quote</p>
              </div>
            )}

            {/* Your bid to DMG */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-base-content/60 uppercase">Your Bid to DMG</span>
                {job.our_bid_total != null && !editingBid && (
                  <button className="btn btn-ghost btn-xs" onClick={() => { setEditingBid(true); setOurBidInput(String(Math.round(job.our_bid_total!))); }}>Edit</button>
                )}
              </div>
              {(job.our_bid_total == null || editingBid) ? (
                <div className="flex gap-2 items-center">
                  <div className="flex items-center gap-1 flex-1">
                    <span className="text-base-content/60 font-bold">$</span>
                    <input
                      type="number"
                      placeholder="Enter your bid"
                      className="input input-bordered input-sm flex-1"
                      value={ourBidInput || (editingBid && job.our_bid_total != null ? String(Math.round(job.our_bid_total)) : '')}
                      onChange={e => setOurBidInput(e.target.value)}
                    />
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={saveOurBid} disabled={savingBid}>
                    {savingBid ? <span className="loading loading-spinner loading-xs"/> : 'Save'}
                  </button>
                  {editingBid && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingBid(false)}>Cancel</button>
                  )}
                </div>
              ) : (
                <p className="font-bold text-lg">${Math.round(job.our_bid_total).toLocaleString()}</p>
              )}
            </div>

            {/* Profit */}
            {job.our_bid_total != null && job.sub_quote_total != null && (() => {
              const profitAmt = Math.round(job.our_bid_total - job.sub_quote_total);
              const margin = job.our_bid_total > 0 ? Math.round((profitAmt / job.our_bid_total) * 100) : 0;
              return (
                <div className={`rounded p-2 ${profitAmt >= 0 ? 'bg-success/10' : 'bg-error/10'}`}>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-base-content/60 uppercase">Profit</span>
                    <div className="text-right">
                      <span className={`font-bold ${profitAmt >= 0 ? 'text-success' : 'text-error'}`}>
                        ${profitAmt.toLocaleString()}
                      </span>
                      <span className="text-xs text-base-content/60 ml-1">({margin}%)</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Scope for contracts */}
      {job.work_type === 'contract' && job.scope_notes && (
        <div className="card bg-base-100 shadow mb-6">
          <div className="card-body p-4">
            <h3 className="font-semibold text-sm text-base-content/60 uppercase">Scope of Work</h3>
            <p className="whitespace-pre-wrap text-sm">{job.scope_notes}</p>
          </div>
        </div>
      )}

      {/* Line items for one-time */}
      {job.work_type === 'one_time' && lineItems.length > 0 && (
        <div className="card bg-base-100 shadow mb-6">
          <div className="card-body p-4">
            <h3 className="font-semibold text-sm text-base-content/60 uppercase">Quote Breakdown</h3>
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Description</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map(li => (
                  <tr key={li.id}>
                    <td className="font-medium">{categoryLabel[li.category] || li.category}</td>
                    <td>{li.description || '—'}</td>
                    <td className="text-right">${Math.round(li.amount).toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td colSpan={2}>Total</td>
                  <td className="text-right">${Math.round(lineItems.reduce((s, li) => s + li.amount, 0)).toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Notes */}
      {job.notes && (
        <div className="card bg-base-100 shadow">
          <div className="card-body p-4">
            <h3 className="font-semibold text-sm text-base-content/60 uppercase">Notes</h3>
            <p className="whitespace-pre-wrap text-sm">{job.notes}</p>
          </div>
        </div>
      )}
    </div>
  );
};
