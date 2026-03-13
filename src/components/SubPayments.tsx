import React, { useState, useEffect } from 'react';
import { ArrowLeft, DollarSign, Check, ChevronDown, ChevronUp, TrendingDown, Plus, CheckCircle, Edit3 } from 'lucide-react';
import { Sub } from '../types';
import { formatCurrency, formatDate } from '../utils/helpers';
import { db } from '../db';

interface LegacyCategory {
  id: number;
  category: 'jan_landscape' | 'feb_landscape' | 'snow';
  original_amount: number;
  paid_amount: number;
}

interface OneOffJob {
  id: number;
  job_name: string;
  description: string | null;
  dmg_invoice_number: string | null;
  dmg_invoice_amount: number | null;
  tc_amount: number;
  invoice_status: 'pending_invoice' | 'pending_payment' | 'paid';
  dmg_invoice_date: string | null;
  dmg_expected_payment_date: string | null;
  tc_payment_due_date: string | null;
  tc_payment_date: string | null;
  notes: string | null;
}

interface LegacyPaymentRecord {
  id: number;
  sub_id: number;
  amount: number;
  payment_date: string;
  notes: string | null;
  created_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  jan_landscape: 'January Landscape',
  feb_landscape: 'February Landscape',
  snow: 'Snow Work',
};

const QB_WEBHOOK = 'https://webhooks.tasklet.ai/v1/public/webhook?token=d4f5d163735228a09f398aa198baf769';

async function fireQBWebhook(payload: object) {
  try {
    await fetch(QB_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn('QB webhook failed (non-blocking):', err);
  }
}

const CATEGORY_ORDER = ['jan_landscape', 'feb_landscape', 'snow'];

function getStatusInfo(status: string) {
  switch (status) {
    case 'pending_invoice':
      return { emoji: '✅', label: 'Pending Invoice', color: 'text-info', bg: 'bg-info/10 border-info/30' };
    case 'pending_payment':
      return { emoji: '📄', label: 'Pending Payment', color: 'text-warning', bg: 'bg-warning/10 border-warning/30' };
    case 'paid':
      return { emoji: '💸', label: 'Paid', color: 'text-success', bg: 'bg-success/10 border-success/30' };
    default:
      return { emoji: '❓', label: status, color: '', bg: 'bg-base-200' };
  }
}

// Preview FIFO application of a payment amount
function previewFifo(legacy: LegacyCategory[], amount: number): { category: string; applied: number }[] {
  const sorted = [...legacy].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
  const result: { category: string; applied: number }[] = [];
  let remaining = amount;
  for (const cat of sorted) {
    if (remaining <= 0) break;
    const owed = cat.original_amount - cat.paid_amount;
    if (owed <= 0) continue;
    const apply = Math.min(owed, remaining);
    result.push({ category: cat.category, applied: apply });
    remaining -= apply;
  }
  return result;
}

interface SubPaymentsProps {
  subs: Sub[];
  onBack: () => void;
}

export const SubPayments: React.FC<SubPaymentsProps> = ({ subs, onBack }) => {
  const sub = subs[0];
  const [legacy, setLegacy] = useState<LegacyCategory[]>([]);
  const [oneOffJobs, setOneOffJobs] = useState<OneOffJob[]>([]);
  const [legacyPayments, setLegacyPayments] = useState<LegacyPaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Record Payment form
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentNotes, setPaymentNotes] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);

  // Edit legacy balances
  const [editingBalances, setEditingBalances] = useState(false);
  const [editAmounts, setEditAmounts] = useState<Record<string, string>>({});

  // One-off job actions
  const [updatingOneOff, setUpdatingOneOff] = useState<number | null>(null);
  const [expandedOneOff, setExpandedOneOff] = useState<number | null>(null);

  useEffect(() => {
    loadData();
  }, [sub?.id]);

  async function loadData() {
    if (!sub) return;
    setLoading(true);
    try {
      const [legacyRows, oneOffRows, paymentRows] = await Promise.all([
        db.query(`SELECT * FROM legacy_balance WHERE sub_id = ${sub.id} ORDER BY CASE category WHEN 'jan_landscape' THEN 1 WHEN 'feb_landscape' THEN 2 WHEN 'snow' THEN 3 END`),
        db.query(`SELECT * FROM one_off_jobs WHERE sub_id = ${sub.id} ORDER BY created_at ASC`),
        db.query(`SELECT * FROM legacy_payments WHERE sub_id = ${sub.id} ORDER BY payment_date DESC`),
      ]);
      setLegacy(legacyRows as LegacyCategory[]);
      setOneOffJobs(oneOffRows as OneOffJob[]);
      setLegacyPayments(paymentRows as LegacyPaymentRecord[]);
    } catch (err) {
      console.error('Failed to load payment data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function recordPayment() {
    const amount = parseFloat(paymentAmount.replace(/[^0-9.]/g, ''));
    if (isNaN(amount) || amount <= 0 || !sub) return;
    setSavingPayment(true);

    try {
      // 1. Record the payment
      await db.execute(
        `INSERT INTO legacy_payments (sub_id, amount, payment_date, notes) VALUES (${sub.id}, ${amount}, '${paymentDate}', ${paymentNotes ? `'${paymentNotes.replace(/'/g, "''")}'` : 'NULL'})`
      );

      // 2. Apply FIFO to legacy balance categories
      const sorted = [...legacy].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
      let remaining = amount;
      for (const cat of sorted) {
        if (remaining <= 0) break;
        const owed = cat.original_amount - cat.paid_amount;
        if (owed <= 0) continue;
        const apply = Math.min(owed, remaining);
        const newPaid = cat.paid_amount + apply;
        await db.execute(
          `UPDATE legacy_balance SET paid_amount = ${newPaid} WHERE id = ${cat.id}`
        );
        remaining -= apply;
      }

      // Fire QB webhook for expense tracking
      const fifoPreview = previewFifo(legacy, amount);
      await fireQBWebhook({
        event: 'tc_payment_recorded',
        sub: sub.name,
        amount,
        payment_date: paymentDate,
        notes: paymentNotes || null,
        categories_applied: fifoPreview.map(f => ({ category: CATEGORY_LABELS[f.category] || f.category, amount: f.applied })),
        recorded_at: new Date().toISOString(),
      });

      setShowPaymentForm(false);
      setPaymentAmount('');
      setPaymentNotes('');
      setPaymentDate(new Date().toISOString().split('T')[0]);
      await loadData();
    } catch (err) {
      console.error('Failed to record payment:', err);
    } finally {
      setSavingPayment(false);
    }
  }

  async function saveBalanceEdits() {
    for (const cat of legacy) {
      const raw = editAmounts[cat.category];
      if (raw === undefined) continue;
      const val = parseFloat(raw.replace(/[^0-9.]/g, ''));
      if (isNaN(val)) continue;
      await db.execute(`UPDATE legacy_balance SET original_amount = ${val} WHERE id = ${cat.id}`);
    }
    setEditingBalances(false);
    setEditAmounts({});
    await loadData();
  }

  async function updateOneOffStatus(job: OneOffJob, newStatus: 'pending_invoice' | 'pending_payment' | 'paid', payDate?: string) {
    setUpdatingOneOff(job.id);
    try {
      const resolvedDate = payDate || new Date().toISOString().split('T')[0];
      const tcPayDate = newStatus === 'paid' ? `'${resolvedDate}'` : 'NULL';
      await db.execute(
        `UPDATE one_off_jobs SET invoice_status = '${newStatus}', tc_payment_date = ${tcPayDate} WHERE id = ${job.id}`
      );

      // Fire QB webhook when one-off job is paid to TC
      if (newStatus === 'paid') {
        await fireQBWebhook({
          event: 'tc_payment_recorded',
          sub: sub.name,
          amount: job.tc_amount,
          payment_date: resolvedDate,
          job_name: job.job_name,
          dmg_invoice_number: job.dmg_invoice_number || null,
          notes: `One-off job payment: ${job.job_name}`,
          recorded_at: new Date().toISOString(),
        });
      }

      await loadData();
    } catch (err) {
      console.error('Failed to update one-off job:', err);
    } finally {
      setUpdatingOneOff(null);
    }
  }

  if (!sub) return <div className="p-4">No sub found.</div>;

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <span className="loading loading-spinner loading-md text-primary" />
      </div>
    );
  }

  const sortedLegacy = [...legacy].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
  const legacyRemaining = sortedLegacy.reduce((s, c) => s + (c.original_amount - c.paid_amount), 0);
  const legacyPaid = sortedLegacy.reduce((s, c) => s + c.paid_amount, 0);
  const oneOffPending = oneOffJobs.filter(j => j.invoice_status !== 'paid').reduce((s, j) => s + j.tc_amount, 0);
  const totalOwed = legacyRemaining + oneOffPending;

  // FIFO preview for current payment input
  const previewAmt = parseFloat(paymentAmount.replace(/[^0-9.]/g, '')) || 0;
  const fifoPreview = previewAmt > 0 ? previewFifo(sortedLegacy, previewAmt) : [];

  return (
    <div className="p-4 space-y-4 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={18} /></button>
        <div>
          <h2 className="text-xl font-bold">💰 TC Payments</h2>
          <p className="text-xs text-base-content/50">Manage payments to {sub.name}</p>
        </div>
      </div>

      {/* Running Total */}
      <div className="card bg-base-300 border border-base-content/10">
        <div className="card-body p-4">
          <div className="text-xs text-base-content/60 uppercase tracking-wide font-semibold mb-1">Total Owed to TC</div>
          <div className="text-4xl font-bold">{formatCurrency(Math.round(totalOwed))}</div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="bg-base-100/40 rounded-lg p-2 text-center">
              <div className="text-xs text-base-content/50">Prior Work Remaining</div>
              <div className="text-lg font-bold text-warning">{formatCurrency(Math.round(legacyRemaining))}</div>
            </div>
            <div className="bg-base-100/40 rounded-lg p-2 text-center">
              <div className="text-xs text-base-content/50">One-Off Jobs Pending</div>
              <div className="text-lg font-bold text-info">{formatCurrency(Math.round(oneOffPending))}</div>
            </div>
          </div>
          {legacyPaid > 0 && (
            <div className="text-xs text-success/70 mt-2 flex items-center gap-1">
              <Check size={12}/> {formatCurrency(Math.round(legacyPaid))} paid so far on prior work
            </div>
          )}
        </div>
      </div>

      {/* Record Payment Button */}
      {!showPaymentForm ? (
        <button
          className="btn btn-primary w-full"
          onClick={() => setShowPaymentForm(true)}
        >
          <Plus size={16}/> Record Payment to TC
        </button>
      ) : (
        <div className="card bg-base-200 border border-primary/30">
          <div className="card-body p-4 space-y-3">
            <h3 className="font-bold text-sm flex items-center gap-2"><DollarSign size={14}/> Record Payment</h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-base-content/60 uppercase">Amount</label>
                <div className="flex items-center gap-1 mt-1">
                  <span className="font-bold text-base-content/60">$</span>
                  <input
                    type="number"
                    className="input input-bordered input-sm w-full"
                    placeholder="0"
                    value={paymentAmount}
                    onChange={e => setPaymentAmount(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-base-content/60 uppercase">Date</label>
                <input
                  type="date"
                  className="input input-bordered input-sm w-full mt-1"
                  value={paymentDate}
                  onChange={e => setPaymentDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-base-content/60 uppercase">Notes (optional)</label>
              <input
                className="input input-bordered input-sm w-full mt-1"
                placeholder="e.g. Week 1 of Jan paydown"
                value={paymentNotes}
                onChange={e => setPaymentNotes(e.target.value)}
              />
            </div>

            {/* FIFO Preview */}
            {fifoPreview.length > 0 && (
              <div className="bg-base-300 rounded-lg p-3">
                <div className="text-xs font-semibold text-base-content/60 uppercase mb-2">Payment Will Apply To:</div>
                {fifoPreview.map((f, i) => (
                  <div key={i} className="flex justify-between text-sm py-1">
                    <span>{CATEGORY_LABELS[f.category]}</span>
                    <span className="text-success font-semibold">−{formatCurrency(f.applied)}</span>
                  </div>
                ))}
                {previewAmt > legacyRemaining && (
                  <div className="text-xs text-warning mt-1">
                    ⚠️ {formatCurrency(previewAmt - legacyRemaining)} exceeds remaining prior work balance
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                className="btn btn-primary btn-sm flex-1"
                disabled={savingPayment || !paymentAmount}
                onClick={recordPayment}
              >
                {savingPayment ? <span className="loading loading-spinner loading-xs"/> : `✅ Confirm — ${previewAmt > 0 ? formatCurrency(previewAmt) : '$0'}`}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowPaymentForm(false); setPaymentAmount(''); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prior Work (Legacy Balance) */}
      <div className="card bg-base-200">
        <div className="card-body p-4 space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-sm flex items-center gap-2"><TrendingDown size={14} className="text-warning"/> Prior Work Balance</h3>
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => {
                if (!editingBalances) {
                  const init: Record<string, string> = {};
                  legacy.forEach(c => { init[c.category] = String(c.original_amount); });
                  setEditAmounts(init);
                }
                setEditingBalances(!editingBalances);
              }}
            >
              <Edit3 size={12}/> {editingBalances ? 'Cancel' : 'Edit'}
            </button>
          </div>

          {sortedLegacy.map(cat => {
            const remaining = cat.original_amount - cat.paid_amount;
            const pct = cat.original_amount > 0 ? (cat.paid_amount / cat.original_amount) * 100 : 0;
            const isCleared = remaining <= 0;

            return (
              <div key={cat.id} className={`rounded-lg p-3 ${isCleared ? 'bg-success/10 border border-success/20' : 'bg-base-300'}`}>
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="text-sm font-semibold flex items-center gap-1">
                      {isCleared && <CheckCircle size={12} className="text-success"/>}
                      {CATEGORY_LABELS[cat.category]}
                    </div>
                    {editingBalances ? (
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-xs text-base-content/50">$</span>
                        <input
                          type="number"
                          className="input input-bordered input-xs w-28"
                          value={editAmounts[cat.category] ?? cat.original_amount}
                          onChange={e => setEditAmounts(prev => ({ ...prev, [cat.category]: e.target.value }))}
                        />
                        <span className="text-xs text-base-content/50">original</span>
                      </div>
                    ) : (
                      <div className="text-xs text-base-content/50">
                        {formatCurrency(cat.paid_amount)} paid of {formatCurrency(cat.original_amount)}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className={`font-bold text-sm ${isCleared ? 'text-success' : 'text-warning'}`}>
                      {isCleared ? '✅ Cleared' : formatCurrency(Math.round(remaining))}
                    </div>
                    {!isCleared && <div className="text-xs text-base-content/50">remaining</div>}
                  </div>
                </div>
                {!editingBalances && (
                  <>
                    <div className="w-full bg-base-content/10 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${isCleared ? 'bg-success' : 'bg-primary'}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <div className="text-xs text-base-content/40 mt-1">{Math.round(pct)}% paid</div>
                  </>
                )}
              </div>
            );
          })}

          {editingBalances && (
            <button className="btn btn-primary btn-sm w-full" onClick={saveBalanceEdits}>
              Save Updated Balances
            </button>
          )}

          {/* Payment History */}
          {legacyPayments.length > 0 && (
            <div className="pt-2 border-t border-base-300">
              <div className="text-xs text-base-content/50 uppercase font-semibold mb-2">Payment History</div>
              <div className="space-y-1">
                {legacyPayments.map(p => (
                  <div key={p.id} className="flex justify-between text-xs py-1.5 border-b border-base-300/50 last:border-0">
                    <div>
                      <span className="font-medium">{formatDate(p.payment_date)}</span>
                      {p.notes && <span className="text-base-content/50 ml-1">— {p.notes}</span>}
                    </div>
                    <span className="font-semibold text-success">{formatCurrency(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* One-Off Jobs */}
      <div>
        <h3 className="font-semibold text-sm text-base-content/60 uppercase tracking-wide mb-2">One-Off Jobs</h3>
        <div className="space-y-2">
          {oneOffJobs.map(job => {
            const { emoji, label, color, bg } = getStatusInfo(job.invoice_status);
            const isExpanded = expandedOneOff === job.id;

            return (
              <div key={job.id} className={`card border ${bg}`}>
                <div className="card-body p-3 space-y-2">
                  <div
                    className="flex justify-between items-start cursor-pointer"
                    onClick={() => setExpandedOneOff(isExpanded ? null : job.id)}
                  >
                    <div>
                      <div className="font-bold text-sm">{job.job_name}</div>
                      <div className={`text-xs ${color} font-medium mt-0.5`}>
                        {emoji} {label}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div className="font-bold text-sm">{formatCurrency(job.tc_amount)}</div>
                        <div className="text-xs text-base-content/50">TC's cut</div>
                      </div>
                      {isExpanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="pt-2 border-t border-base-content/10 space-y-3">
                      {/* Details */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {job.dmg_invoice_number && (
                          <div>
                            <div className="text-base-content/50 uppercase font-semibold">Invoice #</div>
                            <div className="font-medium">{job.dmg_invoice_number}</div>
                          </div>
                        )}
                        {job.dmg_invoice_amount && (
                          <div>
                            <div className="text-base-content/50 uppercase font-semibold">DMG Invoice</div>
                            <div className="font-medium">{formatCurrency(job.dmg_invoice_amount)}</div>
                          </div>
                        )}
                        {job.dmg_expected_payment_date && (
                          <div>
                            <div className="text-base-content/50 uppercase font-semibold">DMG Pays Me</div>
                            <div className="font-medium">{formatDate(job.dmg_expected_payment_date)}</div>
                          </div>
                        )}
                        {job.tc_payment_due_date && (
                          <div>
                            <div className="text-base-content/50 uppercase font-semibold">TC Due Date</div>
                            <div className="font-medium text-warning">{formatDate(job.tc_payment_due_date)}</div>
                          </div>
                        )}
                        {job.tc_payment_date && (
                          <div>
                            <div className="text-base-content/50 uppercase font-semibold">Paid On</div>
                            <div className="font-medium text-success">{formatDate(job.tc_payment_date)}</div>
                          </div>
                        )}
                        {job.notes && (
                          <div className="col-span-2">
                            <div className="text-base-content/50 uppercase font-semibold">Notes</div>
                            <div className="text-base-content/70">{job.notes}</div>
                          </div>
                        )}
                      </div>

                      {/* Stage Actions */}
                      {job.invoice_status !== 'paid' && (
                        <div className="space-y-1">
                          <div className="text-xs text-base-content/50 font-semibold uppercase">Move Stage</div>
                          <div className="flex gap-2 flex-wrap">
                            {job.invoice_status === 'pending_invoice' && (
                              <button
                                className="btn btn-warning btn-xs"
                                disabled={updatingOneOff === job.id}
                                onClick={() => updateOneOffStatus(job, 'pending_payment')}
                              >
                                📄 Mark DMG Invoiced → Pending Payment
                              </button>
                            )}
                            {(job.invoice_status === 'pending_invoice' || job.invoice_status === 'pending_payment') && (
                              <button
                                className="btn btn-success btn-xs"
                                disabled={updatingOneOff === job.id}
                                onClick={() => updateOneOffStatus(job, 'paid')}
                              >
                                💸 Mark TC Paid
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
};
