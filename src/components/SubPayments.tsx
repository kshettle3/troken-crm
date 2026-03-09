import React, { useState, useEffect } from 'react';
import { ArrowLeft, DollarSign, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { Sub, SubPayment } from '../types';
import { formatCurrency, formatDate } from '../utils/helpers';
import { db } from '../db';

interface MonthSubData {
  month: string; // YYYY-MM
  subId: number;
  subName: string;
  visitCount: number;
  totalPay: number;
  payment: SubPayment | null;
  visits: { property_name: string; visit_pay: number; scheduled_date: string }[];
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

interface SubPaymentsProps {
  subs: Sub[];
  onBack: () => void;
}

export const SubPayments: React.FC<SubPaymentsProps> = ({ subs, onBack }) => {
  const [monthlyData, setMonthlyData] = useState<MonthSubData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [markingPaid, setMarkingPaid] = useState<string | null>(null); // month being marked
  const [paymentMethod, setPaymentMethod] = useState<string>('check');
  const [paymentNotes, setPaymentNotes] = useState<string>('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      // Get all checked-in visits with sub info and calculated pay
      const visits: any[] = await db.query(
        `SELECT cv.id, cv.job_id, cv.scheduled_date, cv.checked_in_at,
               j.property_name, j.metro, j.sub_id,
               s.name as sub_name,
               COALESCE(
                 (SELECT SUM(CASE 
                   WHEN svc.sub_per_visit_rate IS NOT NULL THEN svc.sub_per_visit_rate
                   WHEN svc.per_visit_rate IS NOT NULL AND svc.per_visit_rate > 0 THEN 
                     ROUND(svc.per_visit_rate * COALESCE(svc.sub_rate_pct, 80) / 100)
                   ELSE 0
                 END) FROM services svc WHERE svc.job_id = cv.job_id AND svc.total_value > 0),
                 0
               ) as visit_pay
        FROM calendar_visits cv
        JOIN jobs j ON cv.job_id = j.id
        LEFT JOIN subs s ON j.sub_id = s.id
        WHERE cv.checked_in = 1 AND j.sub_id IS NOT NULL
        ORDER BY cv.scheduled_date DESC`
      );

      // Get all payment records
      const payments: any[] = await db.query(`SELECT * FROM sub_payments`);
      const paymentMap = new Map<string, SubPayment>();
      payments.forEach(p => paymentMap.set(`${p.sub_id}-${p.period_month}`, p));

      // Group by month + sub
      const groupMap = new Map<string, MonthSubData>();
      for (const v of visits) {
        const ym = (v.scheduled_date || '').substring(0, 7);
        if (!ym || !v.sub_id) continue;
        const key = `${v.sub_id}-${ym}`;
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            month: ym,
            subId: v.sub_id,
            subName: v.sub_name || 'Unknown',
            visitCount: 0,
            totalPay: 0,
            payment: paymentMap.get(key) ?? null,
            visits: [],
          });
        }
        const entry = groupMap.get(key)!;
        entry.visitCount += 1;
        entry.totalPay += Number(v.visit_pay) || 0;
        entry.visits.push({
          property_name: v.property_name,
          visit_pay: Number(v.visit_pay) || 0,
          scheduled_date: v.scheduled_date,
        });
      }

      const data = Array.from(groupMap.values()).sort((a, b) => b.month.localeCompare(a.month));
      setMonthlyData(data);
    } catch (err) {
      console.error('Failed to load payment data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function markAsPaid(md: MonthSubData) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const escapedNotes = paymentNotes.replace(/'/g, "''");

      if (md.payment) {
        // Update existing
        await db.execute(
          `UPDATE sub_payments SET status = 'paid', paid_date = '${today}', payment_method = '${paymentMethod}', notes = '${escapedNotes}' WHERE id = ${md.payment.id}`
        );
      } else {
        // Insert new
        await db.execute(
          `INSERT INTO sub_payments (sub_id, period_month, total_amount, visit_count, status, paid_date, payment_method, notes) VALUES (${md.subId}, '${md.month}', ${md.totalPay}, ${md.visitCount}, 'paid', '${today}', '${paymentMethod}', '${escapedNotes}')`
        );
      }

      setMarkingPaid(null);
      setPaymentNotes('');
      setPaymentMethod('check');
      await loadData();
    } catch (err) {
      console.error('Failed to mark as paid:', err);
    }
  }

  const totalPaid = monthlyData
    .filter(m => m.payment?.status === 'paid')
    .reduce((s, m) => s + m.totalPay, 0);
  const totalPending = monthlyData
    .filter(m => !m.payment || m.payment.status !== 'paid')
    .reduce((s, m) => s + m.totalPay, 0);

  return (
    <div className="p-4 space-y-4 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={18} /></button>
        <div>
          <h2 className="text-xl font-bold">💰 Sub Payments</h2>
          <p className="text-xs text-base-content/50">Manage contractor payments</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <span className="loading loading-spinner loading-md text-primary" />
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="card bg-success/10 border border-success/20">
              <div className="card-body p-3 text-center">
                <div className="text-xs text-success/80 flex items-center justify-center gap-1"><Check size={12}/> Total Paid</div>
                <div className="text-2xl font-bold text-success">{formatCurrency(totalPaid)}</div>
              </div>
            </div>
            <div className="card bg-warning/10 border border-warning/20">
              <div className="card-body p-3 text-center">
                <div className="text-xs text-warning flex items-center justify-center gap-1"><DollarSign size={12}/> Pending</div>
                <div className="text-2xl font-bold text-warning">{formatCurrency(totalPending)}</div>
              </div>
            </div>
          </div>

          {/* Monthly Payment List */}
          <div className="space-y-2">
            {monthlyData.length === 0 ? (
              <div className="card bg-base-200">
                <div className="card-body p-4 text-center">
                  <p className="text-sm text-base-content/60">No visit data found yet.</p>
                </div>
              </div>
            ) : (
              monthlyData.map(md => {
                const key = `${md.subId}-${md.month}`;
                const isExpanded = expandedMonth === key;
                const isPaid = md.payment?.status === 'paid';
                const isMarking = markingPaid === key;

                // Group visits by property for breakdown
                const byProperty = new Map<string, { name: string; visits: number; perVisit: number; total: number }>();
                if (isExpanded) {
                  for (const v of md.visits) {
                    if (!byProperty.has(v.property_name)) byProperty.set(v.property_name, { name: v.property_name, visits: 0, perVisit: v.visit_pay, total: 0 });
                    const entry = byProperty.get(v.property_name)!;
                    entry.visits += 1;
                    entry.total += v.visit_pay;
                  }
                }
                const propertyRows = isExpanded ? Array.from(byProperty.values()).sort((a, b) => b.total - a.total) : [];

                return (
                  <div key={key} className="card bg-base-200">
                    <div className="card-body p-3 space-y-2">
                      <div
                        className="flex justify-between items-center cursor-pointer"
                        onClick={() => setExpandedMonth(isExpanded ? null : key)}
                      >
                        <div>
                          <div className="font-bold text-sm">{formatMonthLabel(md.month)}</div>
                          <div className="text-xs text-base-content/60">👷 {md.subName} • {md.visitCount} visits</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right">
                            <div className="font-bold text-sm">{formatCurrency(md.totalPay)}</div>
                            {isPaid ? (
                              <span className="badge badge-success badge-xs gap-1">✅ Paid{md.payment?.paid_date ? ` ${formatDate(md.payment.paid_date)}` : ''}</span>
                            ) : (
                              <span className="badge badge-warning badge-xs gap-1">🟡 Pending</span>
                            )}
                          </div>
                          {isExpanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="pt-2 border-t border-base-300 space-y-3">
                          {/* Property breakdown */}
                          <div>
                            <h4 className="text-xs font-semibold text-base-content/60 uppercase mb-1">Property Breakdown</h4>
                            {propertyRows.map((row, i) => (
                              <div key={i} className="flex justify-between text-sm py-1 border-b border-base-300 last:border-0">
                                <div>
                                  <span className="font-medium">{row.name}</span>
                                  <span className="text-xs text-base-content/60 ml-1">({row.visits} × {formatCurrency(row.perVisit)})</span>
                                </div>
                                <span className="font-bold">{formatCurrency(row.total)}</span>
                              </div>
                            ))}
                          </div>

                          {/* Mark as paid */}
                          {!isPaid && (
                            <div>
                              {isMarking ? (
                                <div className="bg-base-300 rounded-lg p-3 space-y-2">
                                  <div>
                                    <label className="text-xs font-semibold text-base-content/60 uppercase">Payment Method</label>
                                    <select
                                      className="select select-bordered select-sm w-full mt-1"
                                      value={paymentMethod}
                                      onChange={e => setPaymentMethod(e.target.value)}
                                    >
                                      <option value="check">Check</option>
                                      <option value="transfer">Transfer</option>
                                      <option value="cash">Cash</option>
                                      <option value="other">Other</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-xs font-semibold text-base-content/60 uppercase">Notes (optional)</label>
                                    <input
                                      className="input input-bordered input-sm w-full mt-1"
                                      placeholder="Check #, reference, etc."
                                      value={paymentNotes}
                                      onChange={e => setPaymentNotes(e.target.value)}
                                    />
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      className="btn btn-success btn-sm flex-1"
                                      onClick={() => markAsPaid(md)}
                                    >
                                      ✅ Confirm Paid — {formatCurrency(md.totalPay)}
                                    </button>
                                    <button
                                      className="btn btn-ghost btn-sm"
                                      onClick={() => setMarkingPaid(null)}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  className="btn btn-outline btn-success btn-sm w-full"
                                  onClick={() => setMarkingPaid(key)}
                                >
                                  💵 Mark as Paid
                                </button>
                              )}
                            </div>
                          )}

                          {/* Show payment details if paid */}
                          {isPaid && md.payment && (
                            <div className="bg-success/10 rounded-lg p-2 text-xs text-success/80">
                              <span className="font-semibold">Paid</span>
                              {md.payment.paid_date && <span> on {formatDate(md.payment.paid_date)}</span>}
                              {md.payment.payment_method && <span> via {md.payment.payment_method}</span>}
                              {md.payment.notes && <span> — {md.payment.notes}</span>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
};
