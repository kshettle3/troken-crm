import React, { useState, useEffect } from 'react';
import { PipelineJob, QuoteLineItem, Sub } from '../types';
import { db } from '../db'

interface Props {
  editId: number | null;
  onSave: () => void;
  onCancel: () => void;
}

const CATEGORIES = ['time', 'material', 'equipment', 'trip_charge', 'miscellaneous'] as const;
const categoryLabel: Record<string, string> = {
  time: 'Time (Labor)',
  material: 'Material',
  equipment: 'Equipment',
  trip_charge: 'Trip Charge',
  miscellaneous: 'Miscellaneous',
};

interface LineItem {
  category: string;
  description: string;
  amount: string;
}

export const PipelineForm: React.FC<Props> = ({ editId, onSave, onCancel }) => {
  const [workType, setWorkType] = useState<'contract' | 'one_time'>('one_time');
  const [propertyName, setPropertyName] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [clientName, setClientName] = useState('');
  const [deadline, setDeadline] = useState('');
  const [scopeNotes, setScopeNotes] = useState('');
  const [ourBid, setOurBid] = useState('');
  const [notes, setNotes] = useState('');
  const [subs, setSubs] = useState<Sub[]>([]);
  const [subId, setSubId] = useState<number | null>(null);
  const [billingTo, setBillingTo] = useState('');
  const [quoteFormat, setQuoteFormat] = useState<'breakdown' | 'lump_sum'>('breakdown');
  const [lumpSumAmount, setLumpSumAmount] = useState('');
  const [lineItems, setLineItems] = useState<LineItem[]>(
    CATEGORIES.map(c => ({ category: c, description: '', amount: '' }))
  );
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const subRows = await db.query('SELECT * FROM subs ORDER BY name');
      setSubs(subRows as unknown as Sub[]);

      if (editId) {
        const [job] = await db.query(`SELECT * FROM pipeline_jobs WHERE id = ${editId}`) as unknown as PipelineJob[];
        if (job) {
          setWorkType(job.work_type);
          setPropertyName(job.property_name);
          setPropertyAddress(job.property_address || '');
          setClientName(job.client_name || '');
          setDeadline(job.deadline || '');
          setScopeNotes(job.scope_notes || '');
          setOurBid(job.our_bid_total != null ? String(Math.round(job.our_bid_total)) : '');
          setNotes(job.notes || '');
          setSubId(job.sub_id);
          setBillingTo(job.billing_to || '');
          setQuoteFormat(job.quote_format === 'lump_sum' ? 'lump_sum' : 'breakdown');
          if (job.quote_format === 'lump_sum' && job.sub_quote_total != null) {
            setLumpSumAmount(String(Math.round(job.sub_quote_total)));
          }

          if (job.work_type === 'one_time') {
            const items = await db.query(
              `SELECT * FROM quote_line_items WHERE pipeline_job_id = ${editId}`
            ) as unknown as QuoteLineItem[];
            const merged = CATEGORIES.map(c => {
              const found = items.find(i => i.category === c);
              return {
                category: c,
                description: found?.description || '',
                amount: found ? String(Math.round(found.amount)) : '',
              };
            });
            setLineItems(merged);
          }
        }
      }
      setInitLoading(false);
    })();
  }, [editId]);

  const lineTotal = lineItems.reduce((sum, li) => sum + (parseFloat(li.amount) || 0), 0);

  async function handleSubmit() {
    if (!propertyName.trim()) return;
    setLoading(true);

    try {
      const subQuoteTotal = workType === 'one_time'
        ? (quoteFormat === 'lump_sum' ? (parseFloat(lumpSumAmount) || null) : lineTotal || null)
        : null;

      if (editId) {
        await db.execute(`
          UPDATE pipeline_jobs SET
            property_name = '${propertyName.replace(/'/g, "''")}',
            property_address = '${propertyAddress.replace(/'/g, "''")}',
            client_name = '${clientName.replace(/'/g, "''")}',
            deadline = '${deadline}',
            work_type = '${workType}',
            sub_id = ${subId || 'NULL'},
            billing_to = ${billingTo ? `'${billingTo}'` : 'NULL'},
            quote_format = '${quoteFormat}',
            scope_notes = '${scopeNotes.replace(/'/g, "''")}',
            sub_quote_total = ${subQuoteTotal != null ? Math.round(subQuoteTotal) : 'NULL'},
            our_bid_total = ${ourBid ? Math.round(parseFloat(ourBid)) : 'NULL'},
            notes = '${notes.replace(/'/g, "''")}',
            updated_at = datetime('now')
          WHERE id = ${editId}
        `);

        if (workType === 'one_time') {
          await db.execute(`DELETE FROM quote_line_items WHERE pipeline_job_id = ${editId}`);
          for (const li of lineItems) {
            if (li.amount || li.description) {
              await db.execute(`
                INSERT INTO quote_line_items (pipeline_job_id, category, description, amount)
                VALUES (${editId}, '${li.category}', '${(li.description || '').replace(/'/g, "''")}', ${parseFloat(li.amount) || 0})
              `);
            }
          }
        }
      } else {
        const newJobRows = await db.query(`
          INSERT INTO pipeline_jobs (property_name, property_address, client_name, deadline, work_type, sub_id, billing_to, quote_format, scope_notes, sub_quote_total, our_bid_total, notes)
          VALUES (
            '${propertyName.replace(/'/g, "''")}',
            '${propertyAddress.replace(/'/g, "''")}',
            '${clientName.replace(/'/g, "''")}',
            '${deadline}',
            '${workType}',
            ${subId || 'NULL'},
            ${billingTo ? `'${billingTo}'` : 'NULL'},
            '${quoteFormat}',
            '${scopeNotes.replace(/'/g, "''")}',
            ${subQuoteTotal != null ? Math.round(subQuoteTotal) : 'NULL'},
            ${ourBid ? Math.round(parseFloat(ourBid)) : 'NULL'},
            '${notes.replace(/'/g, "''")}'
          ) RETURNING id
        `);

        if (workType === 'one_time') {
          const newJob = newJobRows[0] as any;
          for (const li of lineItems) {
            if (li.amount || li.description) {
              await db.execute(`
                INSERT INTO quote_line_items (pipeline_job_id, category, description, amount)
                VALUES (${newJob.id}, '${li.category}', '${(li.description || '').replace(/'/g, "''")}', ${parseFloat(li.amount) || 0})
              `);
            }
          }
        }
      }
      onSave();
    } catch (err) {
      console.error('Failed to save pipeline job:', err);
    } finally {
      setLoading(false);
    }
  }

  if (initLoading) return <div className="flex justify-center p-12"><span className="loading loading-spinner loading-lg text-primary" /></div>;

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>← Cancel</button>
        <h1 className="text-2xl font-bold">{editId ? 'Edit Quote' : 'New Quote'}</h1>
      </div>

      <div className="card bg-base-100 shadow">
        <div className="card-body space-y-4">
          {/* Work Type Toggle — first thing */}
          <div className="form-control">
            <label className="label"><span className="label-text font-semibold">Type of Work</span></label>
            <div className="flex gap-2">
              <button
                className={`btn btn-sm flex-1 ${workType === 'one_time' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setWorkType('one_time')}
              >
                One-Time Job
              </button>
              <button
                className={`btn btn-sm flex-1 ${workType === 'contract' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setWorkType('contract')}
              >
                Contract
              </button>
            </div>
          </div>

          {/* Core fields */}
          <div className="form-control">
            <label className="label"><span className="label-text">Property Name *</span></label>
            <input className="input input-bordered" value={propertyName} onChange={e => setPropertyName(e.target.value)} placeholder="e.g., Lowe's #1234" />
          </div>

          <div className="form-control">
            <label className="label"><span className="label-text">Address</span></label>
            <input className="input input-bordered" value={propertyAddress} onChange={e => setPropertyAddress(e.target.value)} placeholder="Full address" />
          </div>

          <div className="form-control">
            <label className="label"><span className="label-text">Client</span></label>
            <input className="input input-bordered" value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g., DMG" />
          </div>

          <div className="form-control">
            <label className="label"><span className="label-text">Estimate Deadline</span></label>
            <input type="date" className="input input-bordered" value={deadline} onChange={e => setDeadline(e.target.value)} />
          </div>

          {/* Assign Sub */}
          <div className="form-control">
            <label className="label"><span className="label-text">Assign to Sub</span></label>
            <select className="select select-bordered" value={subId || ''} onChange={e => setSubId(e.target.value ? parseInt(e.target.value) : null)}>
              <option value="">— None —</option>
              {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* One-Time specific dropdowns */}
          {workType === 'one_time' && (
            <>
              <div className="form-control">
                <label className="label"><span className="label-text">Billing To</span></label>
                <select className="select select-bordered" value={billingTo} onChange={e => setBillingTo(e.target.value)}>
                  <option value="">— Select —</option>
                  <option value="property">Property</option>
                  <option value="client">Client</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="form-control">
                <label className="label"><span className="label-text">Sub Quote Format</span></label>
                <div className="flex gap-2">
                  <button
                    className={`btn btn-sm flex-1 ${quoteFormat === 'breakdown' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setQuoteFormat('breakdown')}
                  >
                    Full Breakdown
                  </button>
                  <button
                    className={`btn btn-sm flex-1 ${quoteFormat === 'lump_sum' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setQuoteFormat('lump_sum')}
                  >
                    Lump Sum
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Conditional sections */}
          {workType === 'contract' && (
            <div className="form-control">
              <label className="label"><span className="label-text">Scope of Work</span></label>
              <textarea
                className="textarea textarea-bordered h-32"
                value={scopeNotes}
                onChange={e => setScopeNotes(e.target.value)}
                placeholder="Describe the scope of work for the sub to review..."
              />
            </div>
          )}

          {workType === 'one_time' && quoteFormat === 'breakdown' && (
            <div className="space-y-3">
              <label className="label"><span className="label-text font-semibold">Sub Quote Breakdown</span></label>
              {lineItems.map((li, idx) => (
                <div key={li.category} className="flex gap-2 items-center">
                  <span className="w-32 text-sm font-medium">{categoryLabel[li.category]}</span>
                  <input
                    className="input input-bordered input-sm flex-1"
                    placeholder="Description"
                    value={li.description}
                    onChange={e => {
                      const updated = [...lineItems];
                      updated[idx] = { ...li, description: e.target.value };
                      setLineItems(updated);
                    }}
                  />
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-base-content/50">$</span>
                    <input
                      className="input input-bordered input-sm w-28 pl-5"
                      type="number"
                      placeholder="0"
                      value={li.amount}
                      onChange={e => {
                        const updated = [...lineItems];
                        updated[idx] = { ...li, amount: e.target.value };
                        setLineItems(updated);
                      }}
                    />
                  </div>
                </div>
              ))}
              <div className="flex justify-end pr-1 pt-1">
                <span className="font-bold text-lg">Total: ${Math.round(lineTotal).toLocaleString()}</span>
              </div>
            </div>
          )}

          {workType === 'one_time' && quoteFormat === 'lump_sum' && (
            <div className="form-control">
              <label className="label"><span className="label-text font-semibold">Sub Quote — Lump Sum</span></label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/50">$</span>
                <input
                  className="input input-bordered pl-7 w-full"
                  type="number"
                  placeholder="0"
                  value={lumpSumAmount}
                  onChange={e => setLumpSumAmount(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Your Bid */}
          <div className="form-control">
            <label className="label"><span className="label-text">Your Bid to Client</span></label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/50">$</span>
              <input
                className="input input-bordered pl-7 w-full"
                type="number"
                placeholder="0"
                value={ourBid}
                onChange={e => setOurBid(e.target.value)}
              />
            </div>
            {workType === 'one_time' && ourBid && (() => {
              const subTotal = quoteFormat === 'lump_sum' ? (parseFloat(lumpSumAmount) || 0) : lineTotal;
              if (subTotal <= 0) return null;
              const profit = parseFloat(ourBid) - subTotal;
              return (
                <label className="label">
                  <span className={`label-text-alt ${profit > 0 ? 'text-success' : 'text-error'}`}>
                    Profit: ${Math.round(profit).toLocaleString()}
                  </span>
                </label>
              );
            })()}
          </div>

          {/* Notes */}
          <div className="form-control">
            <label className="label"><span className="label-text">Notes</span></label>
            <textarea className="textarea textarea-bordered" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any additional notes..." />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            <button
              className={`btn btn-primary ${loading ? 'loading' : ''}`}
              onClick={handleSubmit}
              disabled={!propertyName.trim() || loading}
            >
              {editId ? 'Save Changes' : 'Create Quote'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
