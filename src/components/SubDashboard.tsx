import React, { useState, useEffect } from 'react';
import { ArrowLeft, MapPin, DollarSign, Calendar, AlertTriangle, Clock, ChevronDown, ChevronUp, MessageSquare, Send, FileText, ClipboardList, TrendingDown, CheckCircle } from 'lucide-react';
import { SubCalendar } from './SubCalendar';
import { Job, Sub, Service, Note, PipelineJob, QuoteLineItem } from '../types';
import { formatCurrency, formatDate } from '../utils/helpers';
import { db } from '../db'

// Calculate what TC gets paid for a service
function calcSubServicePay(svc: Service): number {
  const visits = svc.total_visits ?? 0;
  if (visits > 0) {
    if (svc.sub_per_visit_rate != null) return svc.sub_per_visit_rate * visits;
    if (svc.per_visit_rate != null && svc.per_visit_rate > 0) {
      const pct = svc.sub_rate_pct != null ? svc.sub_rate_pct / 100 : 0.80;
      return Math.round(pct * svc.per_visit_rate) * visits;
    }
  }
  if (visits === 0 && (svc.total_value ?? 0) > 0) {
    if (svc.sub_per_visit_rate != null && svc.per_visit_rate != null && svc.per_visit_rate > 0) {
      return Math.round((svc.total_value ?? 0) * (svc.sub_per_visit_rate / svc.per_visit_rate));
    }
    const pct = svc.sub_rate_pct != null ? svc.sub_rate_pct / 100 : 0.80;
    return Math.round(pct * (svc.total_value ?? 0));
  }
  return 0;
}

function getSubPerVisitRate(svc: Service): number | null {
  if (svc.sub_per_visit_rate != null) return svc.sub_per_visit_rate;
  if (svc.per_visit_rate != null && svc.per_visit_rate > 0) {
    const pct = svc.sub_rate_pct != null ? svc.sub_rate_pct / 100 : 0.80;
    return Math.round(pct * svc.per_visit_rate);
  }
  return null;
}

function calcJobSubCost(jobId: number, services: Service[]): number {
  return services.filter(s => s.job_id === jobId).reduce((sum, s) => sum + calcSubServicePay(s), 0);
}

function cleanScheduleForSub(desc: string | null): string {
  if (!desc) return '';
  return desc.replace(/\s*-\s*\$[\d,.]+\/per visit/gi, '').trim();
}

interface SiteInstruction {
  id: number;
  client_name: string;
  category: string;
  instructions: string[];
  sort_order: number;
}

interface UpcomingService {
  propertyName: string;
  serviceType: string;
  deadline: string;
  daysUntil: number;
  scheduleDescription: string | null;
  jobId: number;
}

function getUpcomingServices(jobs: Job[], allServices: Service[], daysAhead: number): UpcomingService[] {
  const now = new Date(); now.setHours(0,0,0,0);
  const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() + daysAhead);
  const upcoming: UpcomingService[] = [];
  for (const job of jobs) {
    for (const svc of allServices.filter(s => s.job_id === job.id)) {
      if (!svc.deadline) continue;
      const dl = new Date(svc.deadline + 'T00:00:00');
      if (dl >= now && dl <= cutoff) {
        const daysUntil = Math.ceil((dl.getTime() - now.getTime()) / (1000*60*60*24));
        upcoming.push({ propertyName: job.property_name, serviceType: svc.service_type, deadline: svc.deadline, daysUntil, scheduleDescription: svc.schedule_description, jobId: job.id });
      }
    }
  }
  upcoming.sort((a,b) => a.daysUntil - b.daysUntil);
  return upcoming;
}

// ─── Pay Tab Component ───────────────────────────────────────────────────────

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
  amount: number;
  payment_date: string;
  notes: string | null;
}

interface ContractInvoice {
  id: number;
  job_id: number | null;
  crm_property_name: string | null;
  customer: string;
  dmg_invoice_number: string | null;
  dmg_billing_number: string | null;
  invoice_date: string | null;
  dmg_expected_payment_date: string | null;
  dmg_amount: number;
  tc_amount: number;
  invoice_status: 'pending_invoice' | 'pending_payment' | 'paid';
  tc_payment_due_date: string | null;
  tc_payment_date: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  jan_landscape: 'January Landscape',
  feb_landscape: 'February Landscape',
  snow: 'Snow Work',
};

const CATEGORY_ORDER = ['jan_landscape', 'feb_landscape', 'snow'];

function getStatusInfo(status: string) {
  switch (status) {
    case 'pending_invoice':
      return { emoji: '✅', label: 'Pending Invoice', color: 'text-info', bg: 'bg-info/10 border-info/30', desc: 'Work complete — waiting on DMG to invoice Troken. Timer starts when invoiced.' };
    case 'pending_payment':
      return { emoji: '📄', label: 'Pending Payment', color: 'text-warning', bg: 'bg-warning/10 border-warning/30', desc: 'DMG has invoiced Troken. You will be paid within 7 days of Troken receiving payment.' };
    case 'paid':
      return { emoji: '💸', label: 'Paid', color: 'text-success', bg: 'bg-success/10 border-success/30', desc: 'Payment sent.' };
    default:
      return { emoji: '❓', label: status, color: '', bg: 'bg-base-200', desc: '' };
  }
}

interface PayTabProps {
  subId: number;
  subJobs: Job[];
  allServices: Service[];
  totalPay: number;
  isPortalMode?: boolean;
}

const PayTab: React.FC<PayTabProps> = ({ subId }) => {
  const [legacy, setLegacy] = useState<LegacyCategory[]>([]);
  const [oneOffJobs, setOneOffJobs] = useState<OneOffJob[]>([]);
  const [legacyPayments, setLegacyPayments] = useState<LegacyPaymentRecord[]>([]);
  const [contractInvoices, setContractInvoices] = useState<ContractInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedOneOff, setExpandedOneOff] = useState<number | null>(null);
  const [expandedLegacy, setExpandedLegacy] = useState(false);
  const [expandedContract, setExpandedContract] = useState<number | null>(null);

  useEffect(() => {
    loadData();
  }, [subId]);

  async function loadData() {
    setLoading(true);
    try {
      const [legacyRows, oneOffRows, paymentRows, contractRows] = await Promise.all([
        db.query(`SELECT * FROM legacy_balance WHERE sub_id = ${subId} ORDER BY CASE category WHEN 'jan_landscape' THEN 1 WHEN 'feb_landscape' THEN 2 WHEN 'snow' THEN 3 END`),
        db.query(`SELECT * FROM one_off_jobs WHERE sub_id = ${subId} ORDER BY created_at ASC`),
        db.query(`SELECT * FROM legacy_payments WHERE sub_id = ${subId} ORDER BY payment_date DESC`),
        db.query(`SELECT * FROM contract_invoices WHERE sub_id = ${subId} AND review_status = 'approved' ORDER BY invoice_date DESC`),
      ]);
      setLegacy(legacyRows as LegacyCategory[]);
      setOneOffJobs(oneOffRows as OneOffJob[]);
      setLegacyPayments(paymentRows as LegacyPaymentRecord[]);
      setContractInvoices(contractRows as ContractInvoice[]);
    } catch (err) {
      console.error('Failed to load pay data:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <span className="loading loading-spinner loading-md text-primary" />
      </div>
    );
  }

  // Calculate totals
  const legacyRemaining = legacy.reduce((s, c) => s + (c.original_amount - c.paid_amount), 0);
  const oneOffPending = oneOffJobs.filter(j => j.invoice_status !== 'paid').reduce((s, j) => s + j.tc_amount, 0);
  const contractPending = contractInvoices.filter(i => i.invoice_status !== 'paid').reduce((s, i) => s + i.tc_amount, 0);
  const totalOwed = legacyRemaining + oneOffPending + contractPending;

  // Sort categories in FIFO order
  const sortedLegacy = [...legacy].sort((a, b) =>
    CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
  );

  // Find the "active" FIFO category (first one not fully paid)
  const activeCategory = sortedLegacy.find(c => c.original_amount - c.paid_amount > 0);

  return (
    <div className="space-y-4">

      {/* ── Running Total Owed ── */}
      <div className="card bg-base-300 border border-base-content/10">
        <div className="card-body p-4">
          <div className="text-xs text-base-content/60 uppercase tracking-wide font-semibold mb-1">Total Owed to You</div>
          <div className="text-4xl font-bold">{formatCurrency(Math.round(totalOwed))}</div>
          <div className="text-xs text-base-content/50 mt-1">
            {formatCurrency(Math.round(legacyRemaining))} prior work · {formatCurrency(Math.round(oneOffPending))} one-off · {formatCurrency(Math.round(contractPending))} March contract
          </div>
        </div>
      </div>

      {/* ── Prior Work (Legacy Balance) ── */}
      <div className="card bg-base-200">
        <div
          className="card-body p-3 cursor-pointer"
          onClick={() => setExpandedLegacy(!expandedLegacy)}
        >
          <div className="flex justify-between items-center">
            <div>
              <div className="font-bold text-sm flex items-center gap-2">
                <TrendingDown size={14} className="text-warning" />
                Prior Work Balance
              </div>
              <div className="text-xs text-base-content/60 mt-0.5">Jan, Feb & Snow — paid down in order</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-right">
                <div className="font-bold text-sm">{formatCurrency(Math.round(legacyRemaining))}</div>
                <div className="text-xs text-base-content/50">remaining</div>
              </div>
              {expandedLegacy ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
            </div>
          </div>

          {expandedLegacy && (
            <div className="pt-3 border-t border-base-300 space-y-3 mt-2">
              {sortedLegacy.map(cat => {
                const remaining = cat.original_amount - cat.paid_amount;
                const pct = cat.original_amount > 0 ? (cat.paid_amount / cat.original_amount) * 100 : 0;
                const isActive = cat.category === activeCategory?.category;
                const isCleared = remaining <= 0;

                return (
                  <div key={cat.id} className={`rounded-lg p-3 ${isCleared ? 'bg-success/10 border border-success/20' : isActive ? 'bg-primary/10 border border-primary/20' : 'bg-base-300'}`}>
                    <div className="flex justify-between items-start mb-1.5">
                      <div>
                        <div className="text-sm font-semibold flex items-center gap-1">
                          {isCleared && <CheckCircle size={12} className="text-success"/>}
                          {CATEGORY_LABELS[cat.category]}
                          {isActive && !isCleared && <span className="badge badge-xs badge-primary ml-1">Paying Now</span>}
                        </div>
                        <div className="text-xs text-base-content/50">
                          {formatCurrency(cat.paid_amount)} paid of {formatCurrency(cat.original_amount)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-bold text-sm ${isCleared ? 'text-success' : ''}`}>
                          {isCleared ? '✅ Cleared' : formatCurrency(Math.round(remaining))}
                        </div>
                        {!isCleared && <div className="text-xs text-base-content/50">left</div>}
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="w-full bg-base-content/10 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${isCleared ? 'bg-success' : 'bg-primary'}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    {!isCleared && (
                      <div className="text-xs text-base-content/40 mt-1">{Math.round(pct)}% paid</div>
                    )}
                  </div>
                );
              })}

              {/* Payment history */}
              {legacyPayments.length > 0 && (
                <div className="pt-2 border-t border-base-300">
                  <div className="text-xs text-base-content/50 uppercase font-semibold mb-2">Payment History</div>
                  <div className="space-y-1">
                    {legacyPayments.map(p => (
                      <div key={p.id} className="flex justify-between text-xs py-1 border-b border-base-300/50 last:border-0">
                        <span className="text-base-content/70">{formatDate(p.payment_date)}{p.notes ? ` — ${p.notes}` : ''}</span>
                        <span className="font-semibold text-success">+{formatCurrency(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── One-Off Jobs ── */}
      <div>
        <h3 className="font-semibold text-sm text-base-content/60 uppercase tracking-wide mb-2">One-Off Jobs</h3>
        <div className="space-y-2">
          {oneOffJobs.length === 0 ? (
            <div className="card bg-base-200">
              <div className="card-body p-4 text-center">
                <p className="text-sm text-base-content/60">No one-off jobs yet.</p>
              </div>
            </div>
          ) : (
            oneOffJobs.map(job => {
              const { emoji, label, color, bg, desc } = getStatusInfo(job.invoice_status);
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
                        </div>
                        {isExpanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="pt-2 border-t border-base-content/10 space-y-2">
                        {/* Status explanation */}
                        <div className={`text-xs ${color} rounded p-2 bg-base-content/5`}>
                          {desc}
                        </div>

                        {/* Details grid */}
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {job.dmg_invoice_number && (
                            <div>
                              <div className="text-base-content/50 uppercase font-semibold">Invoice #</div>
                              <div className="font-medium">{job.dmg_invoice_number}</div>
                            </div>
                          )}

                          {job.tc_payment_due_date && (
                            <div>
                              <div className="text-base-content/50 uppercase font-semibold">Your Pay Date</div>
                              <div className="font-medium text-success">{formatDate(job.tc_payment_due_date)}</div>
                            </div>
                          )}
                          {job.tc_payment_date && (
                            <div>
                              <div className="text-base-content/50 uppercase font-semibold">Paid On</div>
                              <div className="font-medium text-success">{formatDate(job.tc_payment_date)}</div>
                            </div>
                          )}
                        </div>

                        {/* No invoice yet note */}
                        {job.invoice_status === 'pending_invoice' && !job.dmg_expected_payment_date && (
                          <div className="text-xs text-base-content/50 italic">
                            Not yet invoiced by DMG — your 7-day payment clock starts once Troken receives payment.
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
      </div>

      {/* ── March Contract Work ── */}
      <div>
        <div className="flex justify-between items-baseline mb-2">
          <h3 className="font-semibold text-sm text-base-content/60 uppercase tracking-wide">March Contract Work</h3>
          {contractInvoices.length > 0 && (
            <span className="text-xs text-base-content/50">{contractInvoices.length} invoices · {formatCurrency(Math.round(contractPending))} pending</span>
          )}
        </div>
        <div className="space-y-2">
          {contractInvoices.length === 0 ? (
            <div className="card bg-base-200 border border-dashed border-base-content/20">
              <div className="card-body p-4 text-center">
                <div className="text-sm text-base-content/50">No March invoices yet. As DMG invoices completed visits they'll appear here.</div>
              </div>
            </div>
          ) : (
            contractInvoices.map(inv => {
              const { emoji, label, color, bg } = getStatusInfo(inv.invoice_status);
              const isExpanded = expandedContract === inv.id;
              return (
                <div key={inv.id} className={`card border ${bg}`}>
                  <div className="card-body p-3 space-y-1">
                    <div
                      className="flex justify-between items-start cursor-pointer"
                      onClick={() => setExpandedContract(isExpanded ? null : inv.id)}
                    >
                      <div className="flex-1 min-w-0 pr-2">
                        <div className="font-semibold text-sm truncate">{inv.crm_property_name ?? inv.customer}</div>
                        <div className={`text-xs ${color} font-medium mt-0.5`}>{emoji} {label}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right">
                          <div className="font-bold text-sm">{formatCurrency(Math.round(inv.tc_amount))}</div>
                        </div>
                        {isExpanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="pt-2 border-t border-base-content/10 space-y-2">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {inv.dmg_invoice_number && (
                            <div>
                              <div className="text-base-content/50 uppercase font-semibold">Invoice #</div>
                              <div className="font-medium">{inv.dmg_invoice_number}</div>
                            </div>
                          )}
                          {inv.invoice_date && (
                            <div>
                              <div className="text-base-content/50 uppercase font-semibold">Invoice Date</div>
                              <div className="font-medium">{formatDate(inv.invoice_date)}</div>
                            </div>
                          )}
                          {inv.tc_payment_due_date && (
                            <div>
                              <div className="text-base-content/50 uppercase font-semibold">Your Pay Date</div>
                              <div className="font-medium text-success">{formatDate(inv.tc_payment_due_date)}</div>
                            </div>
                          )}
                          {inv.tc_payment_date && (
                            <div>
                              <div className="text-base-content/50 uppercase font-semibold">Paid On</div>
                              <div className="font-medium text-success">{formatDate(inv.tc_payment_date)}</div>
                            </div>
                          )}
                        </div>
                        {inv.dmg_billing_number && (
                          <div className="text-xs text-base-content/40">Billing ref: {inv.dmg_billing_number}</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

    </div>
  );
};

// ─── SubDashboard Component ──────────────────────────────────────────────────

interface WeekVisit {
  job_id: number;
  property_name: string;
  metro: string | null;
  client_name: string | null;
  scheduled_date: string;
  completed: boolean;
  completed_at: string | null;
}

interface RecentCompletion {
  job_id: number;
  property_name: string;
  metro: string | null;
  completed_at: string | null;
}

interface HomeAlerts {
  overdue: number;
  lowesDeadline: boolean;
  seasonalDue: number;
}

// ─── Aiken Tab (TC view) ─────────────────────────────────────────────
const AikenTab: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [aikenProperties, setAikenProperties] = useState<any[]>([]);
  const [totalDeductions, setTotalDeductions] = useState(0);
  const [loadingAiken, setLoadingAiken] = useState(true);

  useEffect(() => {
    (async () => {
      setLoadingAiken(true);
      try {
        // Get Aiken properties
        const jobRows = await db.query(
          `SELECT j.id as job_id, j.property_name, j.property_address FROM jobs j WHERE j.sub_id = 3 AND j.metro = 'Aiken' ORDER BY j.property_name`
        );

        const firstOfMonth = (() => {
          const d = new Date();
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
        })();

        const props: any[] = [];
        for (const j of jobRows as any[]) {
          // Last invoice for this property
          const lastInv = await db.query(
            `SELECT visit_date, status FROM aiken_invoices WHERE job_id = ${j.job_id} ORDER BY visit_date DESC LIMIT 1`
          );
          // Visit count this month
          const visitCount = await db.query(
            `SELECT COUNT(*) as cnt FROM aiken_invoices WHERE job_id = ${j.job_id} AND visit_date >= '${firstOfMonth}'`
          );
          props.push({
            ...j,
            last_visit_date: lastInv.length > 0 ? (lastInv[0] as any).visit_date : null,
            last_visit_status: lastInv.length > 0 ? (lastInv[0] as any).status : null,
            visits_this_month: visitCount.length > 0 ? Number((visitCount[0] as any).cnt) : 0,
          });
        }
        setAikenProperties(props);

        // Total deductions (paid only)
        const dedRows = await db.query(
          `SELECT COALESCE(SUM(amount), 0) as total FROM aiken_invoices WHERE status = 'paid'`
        );
        setTotalDeductions(dedRows.length > 0 ? Number((dedRows[0] as any).total) : 0);
      } catch (err) {
        console.error('Failed to load Aiken data:', err);
      } finally {
        setLoadingAiken(false);
      }
    })();
  }, []);

  if (loadingAiken) {
    return (
      <div className="flex justify-center py-12">
        <span className="loading loading-spinner loading-md text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-base-content/60 hover:text-base-content">← Home</button>
      <div>
        <h2 className="text-lg font-bold">Aiken Properties</h2>
        <p className="text-xs text-base-content/50">2 properties in Aiken, SC</p>
      </div>

      {aikenProperties.map((prop: any) => (
        <div key={prop.job_id} className="bg-base-200 rounded-xl p-4 space-y-2">
          <div className="font-bold text-sm">{prop.property_name}</div>
          <div className="text-xs text-base-content/50">{prop.property_address}</div>
          <div className="flex justify-between items-center">
            <div className="text-xs text-base-content/40">
              {prop.last_visit_date
                ? <>Last visit: {formatDate(prop.last_visit_date)} — <span className={
                    prop.last_visit_status === 'paid' ? 'text-success' :
                    prop.last_visit_status === 'approved' ? 'text-info' : 'text-warning'
                  }>{prop.last_visit_status}</span></>
                : 'No visits yet'}
            </div>
            <div className="text-xs text-base-content/40">
              {prop.visits_this_month} visit{prop.visits_this_month !== 1 ? 's' : ''} this month
            </div>
          </div>
        </div>
      ))}

      {/* Deduction Total */}
      <div className="bg-error/10 border border-error/20 rounded-xl p-4 text-center">
        <div className="text-xs text-base-content/50 mb-1">Total Deductions</div>
        <div className="text-2xl font-bold text-error">{formatCurrency(totalDeductions)}</div>
        <div className="text-xs text-base-content/40 mt-1">Deducted from your balance when paid</div>
      </div>
    </div>
  );
};

interface SubDashboardProps {
  subs: Sub[];
  jobs: Job[];
  allServices: Service[];
  onBack: () => void;
  isPortalMode?: boolean;
  isCrewMode?: boolean;
  loggedInSubName?: string;
}

export const SubDashboard: React.FC<SubDashboardProps> = ({ subs, jobs, allServices, onBack, isPortalMode, isCrewMode, loggedInSubName }) => {
  const sub = subs[0];
  if (!sub) return <div className="p-4">No sub assigned.</div>;

  const [activeTab, setActiveTab] = useState<'home'|'properties'|'calendar'|'quotes'|'reqs'|'standards'|'pay'|'aiken'>('home');
  const [weekVisits, setWeekVisits] = useState<WeekVisit[]>([]);
  const [recentCompletions, setRecentCompletions] = useState<RecentCompletion[]>([]);
  const [alerts, setAlerts] = useState<HomeAlerts>({ overdue: 0, lowesDeadline: false, seasonalDue: 0 });
  const [siteInstructions, setSiteInstructions] = useState<SiteInstruction[]>([]);
  const [expandedInstructionClient, setExpandedInstructionClient] = useState<string|null>(null);
  const [expandedJob, setExpandedJob] = useState<number|null>(null);
  const [notes, setNotes] = useState<Record<number, Note[]>>({});
  const [newNote, setNewNote] = useState<Record<number, string>>({});
  const [pipelineJobs, setPipelineJobs] = useState<PipelineJob[]>([]);
  const [expandedQuote, setExpandedQuote] = useState<number|null>(null);
  const [quoteLineItems, setQuoteLineItems] = useState<QuoteLineItem[]>([]);
  const [submitting, setSubmitting] = useState<Record<number, boolean>>({});
  const [quoteAmounts, setQuoteAmounts] = useState<Record<number, string>>({});
  const [quoteNoteInputs, setQuoteNoteInputs] = useState<Record<number, string>>({});
  const [lineItemInputs, setLineItemInputs] = useState<Record<number, Record<string, {amount: string; desc: string}>>>({});
  const [submitError, setSubmitError] = useState<Record<number, string>>({});

  const subJobs = jobs.filter(j => j.sub_id === sub.id && j.status === 'active');
  const totalPay = subJobs.reduce((sum, j) => sum + calcJobSubCost(j.id, allServices), 0);
  const upcoming = getUpcomingServices(subJobs, allServices, 90);

  useEffect(() => {
    db.query(
      `SELECT p.*, s.name as sub_name FROM pipeline_jobs p LEFT JOIN subs s ON p.sub_id = s.id WHERE p.sub_id = ${sub.id} AND p.stage = 'quote' ORDER BY p.deadline ASC`
    ).then((rows: any) => setPipelineJobs(rows));
  }, [sub.id]);

  useEffect(() => {
    db.query(`SELECT * FROM site_instructions ORDER BY client_name ASC, sort_order ASC, category ASC`)
      .then((rows: any) => setSiteInstructions(rows.map((r: any) => ({
        ...r,
        instructions: Array.isArray(r.instructions) ? r.instructions : JSON.parse(r.instructions || '[]')
      }))));
  }, []);

  useEffect(() => {
    loadHomeData();
  }, [sub.id]);

  async function loadHomeData() {
    const now = new Date();
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const mondayStr = monday.toISOString().split('T')[0];
    const sundayStr = sunday.toISOString().split('T')[0];
    const todayStr = now.toISOString().split('T')[0];

    try {
      const crewFilter = isCrewMode ? ` AND cv.assigned_to_crew = true` : '';
      const [visits, completions, overdueRows, lowesRows] = await Promise.all([
        db.query(
          `SELECT cv.job_id, cv.scheduled_date, cv.completed, cv.completed_at, j.property_name, j.metro, j.client_name ` +
          `FROM calendar_visits cv JOIN jobs j ON cv.job_id = j.id ` +
          `WHERE cv.scheduled_date >= '${mondayStr}' AND cv.scheduled_date <= '${sundayStr}' ` +
          `AND j.sub_id = ${sub.id}${crewFilter} ORDER BY j.metro, cv.scheduled_date`
        ),
        db.query(
          `SELECT cv.job_id, cv.completed_at, j.property_name, j.metro ` +
          `FROM calendar_visits cv JOIN jobs j ON cv.job_id = j.id ` +
          `WHERE cv.completed = true AND j.sub_id = ${sub.id}${crewFilter} ORDER BY cv.completed_at DESC LIMIT 5`
        ),
        db.query(
          `SELECT COUNT(*) as cnt FROM calendar_visits cv JOIN jobs j ON cv.job_id = j.id ` +
          `WHERE cv.scheduled_date < '${todayStr}' AND cv.completed = false AND j.sub_id = ${sub.id}`
        ),
        day >= 3 ? db.query(
          `SELECT COUNT(*) as cnt FROM calendar_visits cv JOIN jobs j ON cv.job_id = j.id ` +
          `WHERE cv.scheduled_date >= '${mondayStr}' AND cv.scheduled_date <= '${sundayStr}' ` +
          `AND cv.completed = false AND j.sub_id = ${sub.id} AND j.client_name ILIKE '%lowe%'`
        ) : Promise.resolve([{ cnt: '0' }]),
      ]);

      setWeekVisits(visits as WeekVisit[]);
      setRecentCompletions(completions as RecentCompletion[]);
      setAlerts({
        overdue: parseInt((overdueRows as any)[0]?.cnt ?? '0'),
        lowesDeadline: day >= 3 && parseInt((lowesRows as any)[0]?.cnt ?? '0') > 0,
        seasonalDue: 0,
      });
    } catch (err) {
      console.error('Failed to load home data:', err);
    }
  }

  async function loadNotes(jobId: number) {
    const rows: any = await db.query(
      `SELECT * FROM notes WHERE job_id = ${jobId} AND note_type IN ('shared','contractor') ORDER BY created_at DESC`
    );
    setNotes(prev => ({...prev, [jobId]: rows}));
  }

  async function addNote(jobId: number) {
    const content = newNote[jobId]?.trim();
    if (!content) return;
    await db.execute(
      `INSERT INTO notes (job_id, note_type, content) VALUES (${jobId}, 'contractor', '${content.replace(/'/g, "''")}')`
    );
    setNewNote(prev => ({...prev, [jobId]: ''}));
    loadNotes(jobId);
  }

  async function submitSimpleQuote(pj: PipelineJob) {
    const amtStr = quoteAmounts[pj.id] ?? '';
    const amt = parseFloat(amtStr.replace(/[^0-9.]/g, ''));
    if (isNaN(amt) || amt <= 0) {
      setSubmitError(prev => ({ ...prev, [pj.id]: 'Please enter a valid amount.' }));
      return;
    }
    setSubmitting(prev => ({ ...prev, [pj.id]: true }));
    setSubmitError(prev => ({ ...prev, [pj.id]: '' }));
    const notes = quoteNoteInputs[pj.id] ?? '';
    const now = new Date().toISOString();
    await db.execute(
      `UPDATE pipeline_jobs SET sub_quote_total = ${amt}, sub_quote_submitted_at = '${now}', sub_quote_notes = ${notes ? `'${notes.replace(/'/g, "''")}'` : 'NULL'}, updated_at = '${now}' WHERE id = ${pj.id}`
    );
    const webhookUrl = import.meta.env.VITE_NOTIFY_WEBHOOK;
    if (webhookUrl) {
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_name: pj.property_name, amount: amt, quote_format: pj.quote_format, sub_name: sub.name }),
      }).catch(() => {/* silent */});
    }
    const rows: any = await db.query(
      `SELECT p.*, s.name as sub_name FROM pipeline_jobs p LEFT JOIN subs s ON p.sub_id = s.id WHERE p.sub_id = ${sub.id} AND p.stage = 'quote' ORDER BY p.deadline ASC`
    );
    setPipelineJobs(rows);
    setSubmitting(prev => ({ ...prev, [pj.id]: false }));
  }

  async function submitBreakdownQuote(pj: PipelineJob) {
    const categories = ['time', 'material', 'equipment', 'trip_charge', 'miscellaneous'];
    const inputs = lineItemInputs[pj.id] ?? {};
    const items = categories.map(cat => ({
      cat,
      amt: parseFloat((inputs[cat]?.amount ?? '').replace(/[^0-9.]/g, '')) || 0,
      desc: inputs[cat]?.desc ?? '',
    })).filter(i => i.amt > 0);

    if (items.length === 0) {
      setSubmitError(prev => ({ ...prev, [pj.id]: 'Please enter at least one line item amount.' }));
      return;
    }
    setSubmitting(prev => ({ ...prev, [pj.id]: true }));
    setSubmitError(prev => ({ ...prev, [pj.id]: '' }));
    const total = items.reduce((s, i) => s + i.amt, 0);
    const now = new Date().toISOString();
    const notes = quoteNoteInputs[pj.id] ?? '';

    await db.execute(`DELETE FROM quote_line_items WHERE pipeline_job_id = ${pj.id}`);
    for (const item of items) {
      await db.execute(
        `INSERT INTO quote_line_items (pipeline_job_id, category, description, amount) VALUES (${pj.id}, '${item.cat}', '${item.desc.replace(/'/g, "''")}', ${item.amt})`
      );
    }
    await db.execute(
      `UPDATE pipeline_jobs SET sub_quote_total = ${total}, sub_quote_submitted_at = '${now}', sub_quote_notes = ${notes ? `'${notes.replace(/'/g, "''")}'` : 'NULL'}, updated_at = '${now}' WHERE id = ${pj.id}`
    );

    const webhookUrl = import.meta.env.VITE_NOTIFY_WEBHOOK;
    if (webhookUrl) {
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_name: pj.property_name, amount: total, quote_format: 'breakdown', sub_name: sub.name }),
      }).catch(() => {/* silent */});
    }

    const rows: any = await db.query(
      `SELECT p.*, s.name as sub_name FROM pipeline_jobs p LEFT JOIN subs s ON p.sub_id = s.id WHERE p.sub_id = ${sub.id} AND p.stage = 'quote' ORDER BY p.deadline ASC`
    );
    setPipelineJobs(rows);
    setSubmitting(prev => ({ ...prev, [pj.id]: false }));
  }

  async function loadQuoteDetails(pjId: number) {
    const rows: any = await db.query(`SELECT * FROM quote_line_items WHERE pipeline_job_id = ${pjId}`);
    setQuoteLineItems(rows);
  }

  function toggleJob(jobId: number) {
    if (expandedJob === jobId) { setExpandedJob(null); }
    else { setExpandedJob(jobId); loadNotes(jobId); }
  }

  function toggleQuote(pjId: number) {
    if (expandedQuote === pjId) { setExpandedQuote(null); }
    else { setExpandedQuote(pjId); loadQuoteDetails(pjId); }
  }

  return (
    <div className="p-4 space-y-4 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {!isPortalMode && <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={18} /></button>}
          <div>
            <h2 className="text-xl font-bold">👷 {isPortalMode ? loggedInSubName : sub.name}</h2>
            <p className="text-xs text-base-content/50">Contractor Dashboard</p>
          </div>
        </div>
        {isPortalMode && (
          <button className="btn btn-ghost btn-sm text-base-content/60" onClick={onBack}>
            Logout
          </button>
        )}
      </div>

      {/* Home Dashboard Tab */}
      {activeTab === 'home' && (() => {
        const now = new Date();
        const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
        const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        const rockHillVisits = weekVisits.filter(v => v.metro === 'Rock Hill');
        const spartanburgVisits = weekVisits.filter(v => v.metro === 'Spartanburg');
        const otherVisits = weekVisits.filter(v => v.metro !== 'Rock Hill' && v.metro !== 'Spartanburg');

        const navTiles = [
          { tab: 'properties' as const, icon: '📍', label: 'Sites', sub: `${subJobs.length} active` },
          { tab: 'calendar' as const, icon: '📅', label: 'Plan', sub: 'Schedule your week' },
          { tab: 'reqs' as const, icon: '⚠️', label: 'Reqs', sub: upcoming.length > 0 ? `${upcoming.length} due soon` : 'All clear' },
          { tab: 'standards' as const, icon: '📋', label: 'SOW', sub: 'Field standards' },
        ];

        return (
          <div className="space-y-5">
            {/* Greeting */}
            <div>
              <h2 className="text-2xl font-bold">{isCrewMode ? 'Hey Team 👋' : 'Hey TC 👋'}</h2>
              <p className="text-sm text-base-content/50">{dayName}, {dateStr}</p>
            </div>

            {/* Alert Strip — only shown if there's something to flag */}
            {(alerts.overdue > 0 || alerts.lowesDeadline || alerts.seasonalDue > 0) && (
              <div className="space-y-2">
                {alerts.overdue > 0 && (
                  <div className="flex items-center gap-2 bg-error/10 border border-error/30 rounded-lg px-3 py-2">
                    <AlertTriangle size={14} className="text-error shrink-0" />
                    <span className="text-sm font-medium text-error">{alerts.overdue} overdue visit{alerts.overdue > 1 ? 's' : ''} — check Plan</span>
                  </div>
                )}
                {alerts.lowesDeadline && (
                  <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2">
                    <AlertTriangle size={14} className="text-warning shrink-0" />
                    <span className="text-sm font-medium text-warning">Lowe's Friday deadline approaching — no Saturday makeup</span>
                  </div>
                )}
                {alerts.seasonalDue > 0 && (
                  <div className="flex items-center gap-2 bg-info/10 border border-info/30 rounded-lg px-3 py-2">
                    <Clock size={14} className="text-info shrink-0" />
                    <span className="text-sm font-medium text-info">{alerts.seasonalDue} seasonal service{alerts.seasonalDue > 1 ? 's' : ''} due within 14 days</span>
                  </div>
                )}
              </div>
            )}

            {/* Nav Tiles — 2x2 grid */}
            <div className="grid grid-cols-2 gap-3">
              {navTiles.map(tile => (
                <button
                  key={tile.tab}
                  className="bg-base-200 hover:bg-base-300 active:scale-95 rounded-xl p-4 text-left transition-all"
                  onClick={() => setActiveTab(tile.tab)}
                >
                  <div className="text-2xl mb-1.5">{tile.icon}</div>
                  <div className="font-bold text-sm">{tile.label}</div>
                  <div className="text-xs text-base-content/50 mt-0.5">{tile.sub}</div>
                </button>
              ))}
            </div>

            {/* Pay tile — full width (hidden for crew) */}
            {!isCrewMode && (
              <button
                className="w-full bg-base-200 hover:bg-base-300 active:scale-95 rounded-xl p-4 flex items-center gap-4 transition-all"
                onClick={() => setActiveTab('pay')}
              >
                <div className="text-3xl">💰</div>
                <div className="text-left">
                  <div className="font-bold text-sm">Pay</div>
                  <div className="text-xs text-base-content/50">View your earnings & payment status</div>
                </div>
                <div className="ml-auto text-base-content/30">›</div>
              </button>
            )}

            {/* Aiken tile — full width (hidden for crew) */}
            {!isCrewMode && (
              <button
                className="w-full bg-base-200 hover:bg-base-300 active:scale-95 rounded-xl p-4 flex items-center gap-4 transition-all"
                onClick={() => setActiveTab('aiken')}
              >
                <div className="text-3xl">🌍</div>
                <div className="text-left">
                  <div className="font-bold text-sm">Aiken</div>
                  <div className="text-xs text-base-content/50">Aiken properties & deductions</div>
                </div>
                <div className="ml-auto text-base-content/30">›</div>
              </button>
            )}

            {/* This Week's Route */}
            <div>
              <button
                className="w-full flex justify-between items-center mb-3"
                onClick={() => setActiveTab('calendar')}
              >
                <h3 className="font-bold text-sm">📍 This Week's Route</h3>
                <span className="text-xs text-primary font-medium">Open Plan →</span>
              </button>

              {weekVisits.length === 0 ? (
                <div className="bg-base-200 rounded-xl p-4 text-center text-sm text-base-content/50">
                  No visits scheduled this week yet. Open Plan to schedule.
                </div>
              ) : (
                <div className="space-y-2">
                  {rockHillVisits.length > 0 && (
                    <div className="bg-base-200 rounded-xl p-3">
                      <div className="text-xs font-semibold text-base-content/40 uppercase tracking-wide mb-2">Rock Hill</div>
                      <div className="space-y-2">
                        {rockHillVisits.map((v, i) => (
                          <div key={i} className="flex justify-between items-center">
                            <span className={`text-sm ${v.completed ? 'line-through text-base-content/40' : ''}`}>{v.property_name}</span>
                            <div className="flex items-center gap-2">
                              {v.completed && <span className="text-success text-xs font-medium">✓ Done</span>}
                              <span className="text-xs text-base-content/40">
                                {new Date(v.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {spartanburgVisits.length > 0 && (
                    <div className="bg-base-200 rounded-xl p-3">
                      <div className="text-xs font-semibold text-base-content/40 uppercase tracking-wide mb-2">Spartanburg</div>
                      <div className="space-y-2">
                        {spartanburgVisits.map((v, i) => (
                          <div key={i} className="flex justify-between items-center">
                            <span className={`text-sm ${v.completed ? 'line-through text-base-content/40' : ''}`}>{v.property_name}</span>
                            <div className="flex items-center gap-2">
                              {v.completed && <span className="text-success text-xs font-medium">✓ Done</span>}
                              <span className="text-xs text-base-content/40">
                                {new Date(v.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {otherVisits.length > 0 && (
                    <div className="bg-base-200 rounded-xl p-3">
                      <div className="text-xs font-semibold text-base-content/40 uppercase tracking-wide mb-2">Other</div>
                      <div className="space-y-2">
                        {otherVisits.map((v, i) => (
                          <div key={i} className="flex justify-between items-center">
                            <span className={`text-sm ${v.completed ? 'line-through text-base-content/40' : ''}`}>{v.property_name}</span>
                            <div className="flex items-center gap-2">
                              {v.completed && <span className="text-success text-xs font-medium">✓ Done</span>}
                              <span className="text-xs text-base-content/40">
                                {new Date(v.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Recent Check-ins */}
            {recentCompletions.length > 0 && (
              <div>
                <h3 className="font-bold text-sm mb-2">✅ Recent Check-ins</h3>
                <div className="bg-base-200 rounded-xl overflow-hidden divide-y divide-base-300">
                  {recentCompletions.map((c, i) => (
                    <div key={i} className="flex justify-between items-center px-4 py-2.5">
                      <span className="text-sm">{c.property_name}</span>
                      <span className="text-xs text-base-content/40">
                        {c.completed_at ? new Date(c.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Properties Tab */}
      {activeTab === 'properties' && (
        <div className="space-y-2">
        <button onClick={() => setActiveTab('home')} className="flex items-center gap-1 text-sm text-base-content/60 hover:text-base-content mb-3">
          ← Home
        </button>
          {subJobs.map(job => {
            const jobServices = allServices.filter(s => s.job_id === job.id);
            const pay = calcJobSubCost(job.id, allServices);
            const isExpanded = expandedJob === job.id;
            const jobNotes = notes[job.id] || [];

            return (
              <div key={job.id} className="card bg-base-200">
                <div className="card-body p-3 space-y-2">
                  <div className="flex justify-between items-start cursor-pointer" onClick={() => toggleJob(job.id)}>
                    <div>
                      <h3 className="font-bold text-sm">{job.property_name}</h3>
                      <p className="text-xs text-base-content/60">{job.property_address}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">{formatCurrency(pay)}</span>
                      {isExpanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="space-y-3 pt-2 border-t border-base-300">
                      {/* Services */}
                      <div>
                        <h4 className="text-xs font-semibold text-base-content/60 uppercase mb-1">Services</h4>
                        {jobServices.map(svc => {
                          const subRate = getSubPerVisitRate(svc);
                          const svcPay = calcSubServicePay(svc);
                          const cleanDesc = cleanScheduleForSub(svc.schedule_description);

                          return (
                            <div key={svc.id} className="flex justify-between text-sm py-1 border-b border-base-300 last:border-0">
                              <div>
                                <span className="font-medium">{svc.service_type}</span>
                                {cleanDesc && <span className="text-xs text-base-content/60 ml-1">— {cleanDesc}</span>}
                                {subRate != null && (
                                  <span className="text-xs text-success ml-1">({formatCurrency(subRate)}/visit)</span>
                                )}
                              </div>
                              <div className="text-right">
                                {svcPay > 0 ? (
                                  <span>{formatCurrency(svcPay)}</span>
                                ) : (
                                  <span className="text-xs text-base-content/40">Included</span>
                                )}
                                {svc.deadline && (
                                  <div className="text-xs text-warning flex items-center gap-1 justify-end"><Calendar size={10}/> {formatDate(svc.deadline)}</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Notes */}
                      <div>
                        <h4 className="text-xs font-semibold text-base-content/60 uppercase mb-1 flex items-center gap-1">
                          <MessageSquare size={12}/> Notes
                        </h4>
                        {jobNotes.length === 0 && <p className="text-xs text-base-content/40">No notes yet.</p>}
                        {jobNotes.map(n => (
                          <div key={n.id} className={`text-sm p-2 rounded mb-1 ${n.note_type === 'shared' ? 'bg-info/10 border-l-2 border-info' : 'bg-base-300'}`}>
                            <div className="flex justify-between">
                              <span className="badge badge-xs">{n.note_type === 'shared' ? '🔗 Shared' : '👷 Mine'}</span>
                              <span className="text-xs text-base-content/40">{new Date(n.created_at).toLocaleDateString()}</span>
                            </div>
                            <p className="mt-1">{n.content}</p>
                          </div>
                        ))}
                        <div className="flex gap-2 mt-2">
                          <input
                            className="input input-sm input-bordered flex-1"
                            placeholder="Add a note..."
                            value={newNote[job.id] || ''}
                            onChange={e => setNewNote(prev => ({...prev, [job.id]: e.target.value}))}
                            onKeyDown={e => { if (e.key === 'Enter') addNote(job.id); }}
                          />
                          <button className="btn btn-sm btn-primary" onClick={() => addNote(job.id)}><Send size={14}/></button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Calendar Tab */}
      {activeTab === 'calendar' && (
        <div>
        <button onClick={() => setActiveTab('home')} className="flex items-center gap-1 text-sm text-base-content/60 hover:text-base-content mb-3">
          ← Home
        </button>
        <SubCalendar
          jobs={jobs}
          allServices={allServices}
          isPortalMode={isPortalMode}
          isCrewMode={isCrewMode}
        />
        </div>
      )}

      {/* Reqs Tab: Due Soon + Visit Schedules */}
      {activeTab === 'reqs' && (() => {
        const clientMap: Record<string, { jobs: typeof subJobs; services: Service[] }> = {};
        subJobs.forEach(j => {
          const cn = j.client_name || 'Unknown Client';
          if (!clientMap[cn]) clientMap[cn] = { jobs: [], services: [] };
          clientMap[cn].jobs.push(j);
          const jobSvcs = allServices.filter(s => s.job_id === j.id);
          clientMap[cn].services.push(...jobSvcs);
        });
        const clientNames = Object.keys(clientMap).sort();

        function cleanScheduleDesc(desc: string | null): string {
          if (!desc) return '';
          return desc.replace(/\s*-\s*\$[\d,.]+\/per visit/gi, '').replace(/\s*-\s*\$[\d,.]+\/month/gi, '').trim();
        }
        function isRoutineSvc(svc: Service): boolean {
          return svc.service_type.toLowerCase().includes('routine');
        }
        function isSeasonalSvc(svc: Service): boolean {
          return !isRoutineSvc(svc);
        }

        return (
          <div className="space-y-4">
          <button onClick={() => setActiveTab('home')} className="flex items-center gap-1 text-sm text-base-content/60 hover:text-base-content mb-3">← Home</button>
            {/* Due Soon */}
            <div>
              <h3 className="text-sm font-bold flex items-center gap-2 mb-2">
                <AlertTriangle size={14} className="text-warning" /> Due Soon
                {upcoming.length > 0 && <span className="badge badge-warning badge-sm">{upcoming.length}</span>}
              </h3>
              <div className="card bg-base-200">
                <div className="card-body p-3">
                  {upcoming.length === 0 ? (
                    <p className="text-sm text-base-content/60 text-center">No upcoming deadlines in the next 90 days. 🎉</p>
                  ) : (
                    <div className="space-y-2">
                      {upcoming.map((item, i) => (
                        <div key={i} className="flex items-center justify-between p-2 bg-base-300 rounded-lg">
                          <div>
                            <div className="font-medium text-sm">{item.propertyName}</div>
                            <div className="text-xs text-base-content/60">{item.serviceType}{item.scheduleDescription ? ` — ${cleanScheduleForSub(item.scheduleDescription)}` : ''}</div>
                          </div>
                          <div className="text-right">
                            <div className={`text-sm font-medium flex items-center gap-1 ${item.daysUntil <= 14 ? 'text-error' : item.daysUntil <= 30 ? 'text-warning' : ''}`}>
                              {item.daysUntil <= 14 && <AlertTriangle size={12}/>}
                              {formatDate(item.deadline)}
                            </div>
                            <div className="text-xs text-base-content/50">
                              {item.daysUntil === 0 ? 'Today' : item.daysUntil === 1 ? 'Tomorrow' : `${item.daysUntil} days`}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Visit Schedules by Client */}
            <div>
              <h3 className="text-sm font-bold mb-2">📋 Visit Schedules</h3>
              <div className="space-y-2">
                {clientNames.map(cn => {
                  const group = clientMap[cn];
                  const propCount = group.jobs.length;
                  return (
                    <div key={cn} className="collapse collapse-arrow bg-base-200 rounded-lg">
                      <input type="checkbox" />
                      <div className="collapse-title font-bold text-sm flex items-center gap-2 pr-8">
                        <span>{cn}</span>
                        <span className="badge badge-sm badge-ghost">{propCount} {propCount === 1 ? 'site' : 'sites'}</span>
                      </div>
                      <div className="collapse-content space-y-3">
                        {group.jobs
                          .sort((a, b) => (a.property_name || '').localeCompare(b.property_name || ''))
                          .map(j => {
                            const jobSvcs = allServices.filter(s => s.job_id === j.id);
                            const routineSvcs = jobSvcs.filter(isRoutineSvc);
                            const seasonalSvcs = jobSvcs.filter(isSeasonalSvc);
                            return (
                              <div key={j.id} className="bg-base-300 rounded-lg p-3 space-y-2">
                                <div>
                                  <h4 className="font-semibold text-sm">{j.property_name}</h4>
                                  <p className="text-xs text-base-content/60 flex items-center gap-1">
                                    <MapPin size={10}/> {j.property_address}
                                  </p>
                                  {j.metro && <span className="badge badge-xs badge-outline mt-1">{j.metro}</span>}
                                </div>
                                {routineSvcs.length > 0 && (
                                  <div>
                                    <h5 className="text-xs font-semibold text-primary uppercase mb-1">📋 Visit Schedule</h5>
                                    <div className="space-y-1">
                                      {routineSvcs.map((s, i) => (
                                        <div key={i} className="flex items-start justify-between bg-base-100/50 rounded px-2 py-1.5">
                                          <span className="text-xs">{cleanScheduleDesc(s.schedule_description) || s.service_type}</span>
                                          {s.total_visits != null && <span className="badge badge-xs badge-info ml-2">{s.total_visits} visits</span>}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {seasonalSvcs.length > 0 && (
                                  <div>
                                    <h5 className="text-xs font-semibold text-secondary uppercase mb-1">🌿 Seasonal & Additional</h5>
                                    <div className="space-y-1">
                                      {seasonalSvcs
                                        .sort((a, b) => {
                                          if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
                                          if (a.deadline) return -1;
                                          if (b.deadline) return 1;
                                          return a.service_type.localeCompare(b.service_type);
                                        })
                                        .map((s, i) => {
                                          const deadlineDate = s.deadline ? new Date(s.deadline + 'T00:00:00') : null;
                                          const now = new Date();
                                          const daysUntil = deadlineDate ? Math.ceil((deadlineDate.getTime() - now.getTime()) / 86400000) : null;
                                          const isPast = daysUntil !== null && daysUntil < 0;
                                          const isUrgent = daysUntil !== null && daysUntil >= 0 && daysUntil <= 30;
                                          const isSoon = daysUntil !== null && daysUntil > 30 && daysUntil <= 60;
                                          return (
                                            <div key={i} className="flex items-start justify-between bg-base-100/50 rounded px-2 py-1.5">
                                              <div className="flex-1">
                                                <div className="text-xs font-medium">{s.service_type}</div>
                                                {s.schedule_description && <div className="text-xs text-base-content/50">{cleanScheduleDesc(s.schedule_description)}</div>}
                                              </div>
                                              <div className="text-right ml-2 flex-shrink-0">
                                                {deadlineDate && (
                                                  <div className={`text-xs font-medium flex items-center gap-1 ${isPast ? 'text-error line-through' : isUrgent ? 'text-error' : isSoon ? 'text-warning' : 'text-base-content/60'}`}>
                                                    {isUrgent && !isPast && <AlertTriangle size={10}/>}
                                                    {deadlineDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                                  </div>
                                                )}
                                                {daysUntil !== null && !isPast && (
                                                  <div className="text-xs text-base-content/40">
                                                    {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil}d`}
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          );
                                        })}
                                    </div>
                                  </div>
                                )}
                                {cn.toLowerCase().includes('lowe') && (
                                  <div className="bg-error/10 border border-error/30 rounded px-2 py-1.5">
                                    <div className="text-xs font-semibold text-error flex items-center gap-1">
                                      <AlertTriangle size={10}/> HARD DEADLINE: Must be completed by Friday 11:59 PM — no Saturday makeup
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Quotes Tab */}
      {activeTab === 'quotes' && (
        <div className="space-y-2">
          {pipelineJobs.length === 0 ? (
            <div className="card bg-base-200">
              <div className="card-body p-4 text-center">
                <p className="text-sm text-base-content/60">No quotes waiting for your review. ✅</p>
              </div>
            </div>
          ) : (
            pipelineJobs.map(pj => {
              const isExpanded = expandedQuote === pj.id;
              return (
                <div key={pj.id} className="card bg-base-200">
                  <div className="card-body p-3 space-y-2">
                    <div className="flex justify-between items-start cursor-pointer" onClick={() => toggleQuote(pj.id)}>
                      <div>
                        <div className="flex items-center gap-2">
                          <FileText size={14} className="text-info"/>
                          <h3 className="font-bold text-sm">{pj.property_name}</h3>
                          <span className="badge badge-xs">{pj.work_type === 'one_time' ? 'One-Time' : 'Contract'}</span>
                        </div>
                        <p className="text-xs text-base-content/60">{pj.property_address}</p>
                        {pj.deadline && <p className="text-xs text-warning mt-1">📅 Deadline: {pj.deadline}</p>}
                      </div>
                      {isExpanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                    </div>

                    {isExpanded && (
                      <div className="pt-2 border-t border-base-300 space-y-2">
                        {pj.work_type === 'contract' && pj.scope_notes && (
                          <div>
                            <h4 className="text-xs font-semibold text-base-content/60 uppercase mb-1">Scope of Work</h4>
                            <p className="text-sm whitespace-pre-wrap bg-base-300 p-2 rounded">{pj.scope_notes}</p>
                          </div>
                        )}
                        {pj.notes && (
                          <div>
                            <h4 className="text-xs font-semibold text-base-content/60 uppercase mb-1">Notes from Troken</h4>
                            <p className="text-sm">{pj.notes}</p>
                          </div>
                        )}

                        {pj.sub_quote_submitted_at != null ? (
                          <div className="bg-success/10 border border-success/30 rounded p-3 space-y-1">
                            <div className="flex items-center gap-2 text-success font-semibold">
                              <span>✅ Quote Submitted</span>
                              <span className="text-xl font-bold">${Math.round(pj.sub_quote_total ?? 0).toLocaleString()}</span>
                            </div>
                            {pj.sub_quote_notes && <p className="text-xs text-base-content/60">Note: {pj.sub_quote_notes}</p>}
                            <p className="text-xs text-base-content/40">Submitted {new Date(pj.sub_quote_submitted_at!).toLocaleDateString()}</p>
                            <p className="text-xs text-base-content/50 italic">Troken LLC is reviewing your quote.</p>
                          </div>
                        ) : (
                          pj.quote_format === 'breakdown' ? (
                            <div className="space-y-3">
                              <h4 className="text-xs font-semibold text-base-content/60 uppercase">Quote Breakdown</h4>
                              {(['time', 'material', 'equipment', 'trip_charge', 'miscellaneous'] as const).map(cat => {
                                const labels: Record<string, string> = { time: 'Time (Labor)', material: 'Material', equipment: 'Equipment', trip_charge: 'Trip Charge', miscellaneous: 'Miscellaneous' };
                                const val = lineItemInputs[pj.id]?.[cat] ?? { amount: '', desc: '' };
                                return (
                                  <div key={cat} className="grid grid-cols-2 gap-2 items-center">
                                    <div>
                                      <label className="text-xs text-base-content/60">{labels[cat]}</label>
                                      <div className="flex items-center gap-1">
                                        <span className="text-xs text-base-content/60">$</span>
                                        <input
                                          type="number"
                                          placeholder="0"
                                          className="input input-bordered input-xs w-full"
                                          value={val.amount}
                                          onChange={e => setLineItemInputs(prev => ({
                                            ...prev,
                                            [pj.id]: { ...(prev[pj.id] ?? {}), [cat]: { ...val, amount: e.target.value } }
                                          }))}
                                        />
                                      </div>
                                    </div>
                                    <input
                                      type="text"
                                      placeholder="Description (optional)"
                                      className="input input-bordered input-xs w-full"
                                      value={val.desc}
                                      onChange={e => setLineItemInputs(prev => ({
                                        ...prev,
                                        [pj.id]: { ...(prev[pj.id] ?? {}), [cat]: { ...val, desc: e.target.value } }
                                      }))}
                                    />
                                  </div>
                                );
                              })}
                              {(() => {
                                const inputs = lineItemInputs[pj.id] ?? {};
                                const total = ['time','material','equipment','trip_charge','miscellaneous']
                                  .reduce((s, cat) => s + (parseFloat(inputs[cat]?.amount ?? '') || 0), 0);
                                return total > 0 ? (
                                  <div className="text-right font-bold text-sm">Total: ${Math.round(total).toLocaleString()}</div>
                                ) : null;
                              })()}
                              <div>
                                <label className="text-xs font-semibold text-base-content/60 uppercase">Notes (optional)</label>
                                <textarea
                                  className="textarea textarea-bordered textarea-sm w-full mt-1"
                                  rows={2}
                                  placeholder="Any notes for Troken..."
                                  value={quoteNoteInputs[pj.id] ?? ''}
                                  onChange={e => setQuoteNoteInputs(prev => ({ ...prev, [pj.id]: e.target.value }))}
                                />
                              </div>
                              {submitError[pj.id] && <p className="text-error text-xs">{submitError[pj.id]}</p>}
                              <button
                                className="btn btn-primary btn-sm w-full"
                                disabled={submitting[pj.id]}
                                onClick={() => submitBreakdownQuote(pj)}
                              >
                                {submitting[pj.id] ? <span className="loading loading-spinner loading-xs"/> : 'Submit Quote →'}
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div>
                                <label className="text-xs font-semibold text-base-content/60 uppercase">Your Price</label>
                                <div className="flex items-center gap-1 mt-1">
                                  <span className="text-base-content/60 font-bold">$</span>
                                  <input
                                    type="number"
                                    placeholder="0"
                                    className="input input-bordered input-sm w-full"
                                    value={quoteAmounts[pj.id] ?? ''}
                                    onChange={e => setQuoteAmounts(prev => ({ ...prev, [pj.id]: e.target.value }))}
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="text-xs font-semibold text-base-content/60 uppercase">Notes (optional)</label>
                                <textarea
                                  className="textarea textarea-bordered textarea-sm w-full mt-1"
                                  rows={2}
                                  placeholder="Any notes for Troken..."
                                  value={quoteNoteInputs[pj.id] ?? ''}
                                  onChange={e => setQuoteNoteInputs(prev => ({ ...prev, [pj.id]: e.target.value }))}
                                />
                              </div>
                              {submitError[pj.id] && <p className="text-error text-xs">{submitError[pj.id]}</p>}
                              <button
                                className="btn btn-primary btn-sm w-full"
                                disabled={submitting[pj.id]}
                                onClick={() => submitSimpleQuote(pj)}
                              >
                                {submitting[pj.id] ? <span className="loading loading-spinner loading-xs"/> : 'Submit Quote →'}
                              </button>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Requirements Tab */}
      {/* Standards Tab: Field SOW specs per client */}
      {activeTab === 'standards' && (() => {
        // Group site_instructions by client
        const clientMap: Record<string, SiteInstruction[]> = {};
        siteInstructions.forEach(si => {
          if (!clientMap[si.client_name]) clientMap[si.client_name] = [];
          clientMap[si.client_name].push(si);
        });
        const clientNames = Object.keys(clientMap).sort();

        return (
          <div className="space-y-3">
          <button onClick={() => setActiveTab('home')} className="flex items-center gap-1 text-sm text-base-content/60 hover:text-base-content mb-3">← Home</button>
            <div className="text-xs text-base-content/60 px-1">
              Field standards and scope of work per client — grass heights, trimming specs, what's in/out of scope.
            </div>
            {clientNames.length === 0 ? (
              <div className="card bg-base-200">
                <div className="card-body p-4 text-center">
                  <p className="text-sm text-base-content/60">No site standards on file yet.</p>
                </div>
              </div>
            ) : clientNames.map(cn => {
              const categories = clientMap[cn];
              const isOpen = expandedInstructionClient === cn;
              return (
                <div key={cn} className="bg-base-200 rounded-lg overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 font-bold text-sm text-left"
                    onClick={() => setExpandedInstructionClient(isOpen ? null : cn)}
                  >
                    <span>{cn}</span>
                    <span className="flex items-center gap-2">
                      <span className="badge badge-ghost badge-sm">{categories.length} {categories.length === 1 ? 'section' : 'sections'}</span>
                      {isOpen ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-3 space-y-3">
                      {categories.map(cat => (
                        <div key={cat.id} className="bg-base-300 rounded-lg p-3">
                          <h5 className="text-xs font-bold uppercase text-primary mb-2">{cat.category}</h5>
                          <ul className="space-y-1.5">
                            {cat.instructions.map((instr, idx) => (
                              <li key={idx} className="flex items-start gap-2 text-xs text-base-content/80">
                                <span className="text-primary mt-0.5 shrink-0">•</span>
                                <span>{instr}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Pay Tab */}
      {activeTab === 'pay' && (
        <div>
          <button onClick={() => setActiveTab('home')} className="flex items-center gap-1 text-sm text-base-content/60 hover:text-base-content mb-3">← Home</button>
          <PayTab subId={sub.id} subJobs={subJobs} allServices={allServices} totalPay={totalPay} isPortalMode={isPortalMode} />
        </div>
      )}

      {/* Aiken Tab */}
      {activeTab === 'aiken' && <AikenTab onBack={() => setActiveTab('home')} />}
    </div>
  );
};
