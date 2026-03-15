import React, { useState, useEffect } from 'react';
import { Plus, DollarSign, Briefcase, TrendingUp, Users, GitBranch, Eye, LogOut, BarChart2, AlertTriangle, ChevronRight } from 'lucide-react';
import { Job, Service } from '../types';
import { formatCurrency, getStatusColor } from '../utils/helpers';
import { db } from '../db';

function calcJobSubCost(jobId: number, services: Service[]): number {
  const jobSvcs = services.filter(s => s.job_id === jobId);
  return jobSvcs.reduce((sum, s) => {
    if (s.sub_per_visit_rate != null && s.total_visits != null) {
      return sum + s.sub_per_visit_rate * s.total_visits;
    }
    if (s.sub_per_visit_rate != null && s.per_visit_rate != null && s.per_visit_rate > 0 && s.total_value != null) {
      const visits = Math.round(s.total_value / s.per_visit_rate);
      return sum + s.sub_per_visit_rate * visits;
    }
    return sum;
  }, 0);
}

interface DashboardProps {
  jobs: Job[];
  allServices: Service[];
  onSelectJob: (id: number) => void;
  onAddJob: () => void;
  onSubOverview: () => void;
  onPipeline: () => void;
  onSubDashboard: () => void;
  onPayments: () => void;
  onLogout?: () => void;
  demoMode?: boolean;
}

export const Dashboard: React.FC<DashboardProps> = ({
  jobs,
  allServices,
  onSelectJob,
  onAddJob,
  onSubOverview,
  onPipeline,
  onSubDashboard,
  onPayments,
  onLogout,
  demoMode,
}) => {
  const defaultTab = demoMode ? 'jobs' : 'overview';
  const [activeTab, setActiveTab] = useState<'overview' | 'jobs' | 'financials'>(defaultTab as 'overview' | 'jobs' | 'financials');

  // Overview state
  const [snap, setSnap] = useState<any>(null);
  const [legacyRows, setLegacyRows] = useState<any[]>([]);
  const [oneOffJobs, setOneOffJobs] = useState<any[]>([]);
  const [contractInvs, setContractInvs] = useState<any[]>([]);
  const [pipelineJobs, setPipelineJobs] = useState<any[]>([]);
  const [dashLoading, setDashLoading] = useState(true);
  const [pendingReviewInvs, setPendingReviewInvs] = useState<any[]>([]);
  const [reviewQueueItems, setReviewQueueItems] = useState<any[]>([]);
  const [showReviewPanel, setShowReviewPanel] = useState(false);
  const [reviewActionLoading, setReviewActionLoading] = useState<number | null>(null);
  const [manualMatchSelections, setManualMatchSelections] = useState<Record<number, number>>({});
  const [jobServices, setJobServices] = useState<Record<number, {per_visit_rate: number, sub_per_visit_rate: number}>>({});

  useEffect(() => {
    if (demoMode) return;
    (async () => {
      try {
        const [snapRow] = await db.query(
          `SELECT * FROM dmg_invoice_snapshot ORDER BY snapshot_at DESC LIMIT 1`
        );
        setSnap(snapRow ?? null);

        const legacy = await db.query(
          `SELECT category, original_amount, paid_amount FROM legacy_balance WHERE sub_id = 1`
        );
        setLegacyRows(legacy);

        const oneOffs = await db.query(
          `SELECT job_name, tc_amount, invoice_status FROM one_off_jobs WHERE invoice_status != 'paid'`
        );
        setOneOffJobs(oneOffs);

        const cInvs = await db.query(
          `SELECT tc_amount, invoice_status FROM contract_invoices WHERE invoice_status != 'paid' AND review_status = 'approved'`
        );
        setContractInvs(cInvs);

        const pipeline = await db.query(
          `SELECT id, property_name, stage, sub_quote_total, deadline FROM pipeline_jobs ORDER BY created_at DESC`
        );
        setPipelineJobs(pipeline);

        const pendingRevInvs = await db.query(
          `SELECT id, crm_property_name, customer, dmg_invoice_number, invoice_date,
                  dmg_amount, tc_amount, dmg_expected_payment_date
           FROM contract_invoices
           WHERE review_status = 'pending_review'
           ORDER BY invoice_date DESC`
        );
        setPendingReviewInvs(pendingRevInvs);

        const rQueue = await db.query(
          `SELECT id, dmg_invoice_number, customer, dmg_amount, invoice_date, flag_reason, match_candidates
           FROM dmg_invoice_review_queue
           WHERE review_status = 'pending'
           ORDER BY created_at DESC`
        );
        setReviewQueueItems(rQueue);

        // Load contracted per-visit rates for accurate TC amount calculation
        const svcRows = await db.query(
          `SELECT job_id, per_visit_rate, sub_per_visit_rate
           FROM services
           WHERE service_type = 'Routine Landscaping Service'`
        );
        const svcMap: Record<number, {per_visit_rate: number, sub_per_visit_rate: number}> = {};
        for (const s of svcRows) {
          if (!svcMap[s.job_id]) svcMap[s.job_id] = { per_visit_rate: parseFloat(s.per_visit_rate), sub_per_visit_rate: parseFloat(s.sub_per_visit_rate) };
        }
        setJobServices(svcMap);
      } catch (e) {
        console.error('Dashboard data fetch error:', e);
      } finally {
        setDashLoading(false);
      }
    })();
  }, [demoMode]);

  // ── Financials calculations ──────────────────────────────────────────────
  const activeJobs = jobs.filter(j => j.status === 'active');
  const totalContractValue = activeJobs.reduce((sum, j) => sum + (j.total_contract_value ?? 0), 0);
  const totalSubPay = activeJobs.reduce((sum, j) => sum + calcJobSubCost(j.id, allServices), 0);
  const totalProfit = totalContractValue - totalSubPay;
  const profitMargin = totalContractValue > 0 ? Math.round((totalProfit / totalContractValue) * 100) : 0;

  const clientBreakdown = activeJobs.reduce<Record<string, { value: number; subCost: number; count: number }>>((acc, job) => {
    const client = job.client_name ?? 'Unknown';
    if (!acc[client]) acc[client] = { value: 0, subCost: 0, count: 0 };
    acc[client].value += job.total_contract_value ?? 0;
    acc[client].subCost += calcJobSubCost(job.id, allServices);
    acc[client].count += 1;
    return acc;
  }, {});

  // ── Overview calculations ────────────────────────────────────────────────
  const dmgPending = snap ? parseFloat(snap.pending_amount) : 0;
  const dmgInReview = snap ? parseFloat(snap.in_review_amount) : 0;
  const dmgPendingCount = snap ? snap.pending_count : 0;

  const legacyOwed = legacyRows.reduce((sum: number, r: any) => {
    return sum + (parseFloat(r.original_amount) - parseFloat(r.paid_amount || 0));
  }, 0);

  const oneOffOwed = oneOffJobs.reduce((sum: number, r: any) => sum + parseFloat(r.tc_amount || 0), 0);
  const contractOwed = contractInvs.reduce((sum: number, r: any) => sum + parseFloat(r.tc_amount || 0), 0);
  const totalTcOwed = legacyOwed + oneOffOwed + contractOwed;

  const quotesWaiting = pipelineJobs.filter((p: any) => p.stage === 'quote' && !p.sub_quote_total);

  const now = new Date();
  const in60 = new Date(now); in60.setDate(in60.getDate() + 60);
  const expiringContracts = jobs.filter(j => {
    if (!j.contract_end || j.status !== 'active') return false;
    const end = new Date(j.contract_end);
    return end >= now && end <= in60;
  });

  const in14 = new Date(now); in14.setDate(in14.getDate() + 14);
  const servicesDueSoon = allServices.filter(s => {
    if (!s.deadline) return false;
    const d = new Date(s.deadline + 'T00:00:00');
    return d >= now && d <= in14;
  });

  const totalReviewPending = pendingReviewInvs.length + reviewQueueItems.length;

  const handleApproveInvoice = async (invoiceId: number) => {
    setReviewActionLoading(invoiceId);
    try {
      await db.query(
        `UPDATE contract_invoices SET review_status = 'approved' WHERE id = ` + invoiceId
      );
      setPendingReviewInvs(prev => prev.filter(i => i.id !== invoiceId));
      // Refresh contractInvs count
      const cInvs = await db.query(
        `SELECT tc_amount, invoice_status FROM contract_invoices WHERE invoice_status != 'paid' AND review_status = 'approved'`
      );
      setContractInvs(cInvs);
    } finally {
      setReviewActionLoading(null);
    }
  };

  const handleRejectInvoice = async (invoiceId: number) => {
    setReviewActionLoading(invoiceId);
    try {
      await db.query(
        `UPDATE contract_invoices SET review_status = 'flagged' WHERE id = ` + invoiceId
      );
      setPendingReviewInvs(prev => prev.filter(i => i.id !== invoiceId));
    } finally {
      setReviewActionLoading(null);
    }
  };

  const handleIgnoreQueueItem = async (itemId: number) => {
    setReviewActionLoading(itemId);
    try {
      await db.query(
        `UPDATE dmg_invoice_review_queue SET review_status = 'ignored' WHERE id = ` + itemId
      );
      setReviewQueueItems(prev => prev.filter(i => i.id !== itemId));
    } finally {
      setReviewActionLoading(null);
    }
  };

  const handleAssignAndApprove = async (item: any) => {
    const jobId = manualMatchSelections[item.id];
    if (!jobId) return;
    const job = jobs.find((j: any) => j.id === jobId);
    if (!job) return;
    setReviewActionLoading(item.id);
    try {
      const svc = jobServices[job.id];
      const tcAmount = svc && svc.per_visit_rate > 0
        ? Math.round((parseFloat(item.dmg_amount) / svc.per_visit_rate) * svc.sub_per_visit_rate)
        : Math.round(parseFloat(item.dmg_amount) * ((job.sub_rate_pct ?? 80) / 100));
      // Insert approved contract invoice
      await db.query(
        `INSERT INTO contract_invoices
          (job_id, crm_property_name, customer, dmg_invoice_number, invoice_date,
           dmg_amount, tc_amount, invoice_status, review_status, sync_source)
         VALUES
          (${jobId}, '${job.property_name.replace(/'/g, "''")}', '${(item.customer || '').replace(/'/g, "''")}',
           '${(item.dmg_invoice_number || '').replace(/'/g, "''")}', '${item.invoice_date ? item.invoice_date.slice(0,10) : ''}',
           ${parseFloat(item.dmg_amount)}, ${tcAmount}, 'unpaid', 'approved', 'manual_match')`
      );
      // Mark queue item resolved
      await db.query(
        `UPDATE dmg_invoice_review_queue
         SET review_status = 'resolved', approved_job_id = ${jobId}, approved_tc_amount = ${tcAmount}, reviewed_at = NOW()
         WHERE id = ${item.id}`
      );
      setReviewQueueItems(prev => prev.filter(i => i.id !== item.id));
      // Refresh contractInvs total
      const cInvs = await db.query(
        `SELECT tc_amount, invoice_status FROM contract_invoices WHERE invoice_status != 'paid' AND review_status = 'approved'`
      );
      setContractInvs(cInvs);
    } finally {
      setReviewActionLoading(null);
    }
  };

  const landscapingJobs = jobs.filter(j => j.status === 'active' && j.contract_type === 'landscaping');
  const snowJobs = jobs.filter(j => j.status === 'active' && j.contract_type === 'snow');
  const landscapingValue = landscapingJobs.reduce((s, j) => s + (j.total_contract_value ?? 0), 0);
  const snowValue = snowJobs.reduce((s, j) => s + (j.total_contract_value ?? 0), 0);
  const portfolioTotal = landscapingValue + snowValue;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">🌿 Troken LLC</h1>
          <p className="text-xs text-base-content/50">
            {demoMode ? 'Job Manager — Demo' : 'Owner Dashboard'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="badge badge-lg badge-neutral">{activeJobs.length} Active</div>
          {onLogout && (
            <button className="btn btn-ghost btn-sm text-base-content/60" onClick={onLogout}>
              <LogOut size={14} /> {demoMode ? 'Exit Demo' : 'Logout'}
            </button>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="tabs tabs-boxed bg-base-200">
        {!demoMode && (
          <button
            className={`tab flex-1 ${activeTab === 'overview' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            📊 Overview
          </button>
        )}
        <button
          className={`tab flex-1 ${activeTab === 'jobs' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('jobs')}
        >
          <Briefcase size={14} className="mr-1" /> Jobs
        </button>
        {!demoMode && (
          <button
            className={`tab flex-1 ${activeTab === 'financials' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('financials')}
          >
            <BarChart2 size={14} className="mr-1" /> Financials
          </button>
        )}
      </div>

      {/* ── Overview Tab ─────────────────────────────────────────────────── */}
      {!demoMode && activeTab === 'overview' && (
        <div className="space-y-4">
          {dashLoading ? (
            <div className="flex justify-center py-10">
              <span className="loading loading-spinner loading-md"></span>
            </div>
          ) : (
            <>
              {/* 4 Money Cards */}
              <div className="grid grid-cols-2 gap-3">
                {/* Card 1: DMG Pending */}
                <div className="card bg-primary/10 border border-primary/20">
                  <div className="card-body p-3">
                    <div className="text-xs text-primary font-semibold uppercase">DMG Pending</div>
                    <div className="text-2xl font-bold text-primary">${Math.round(dmgPending).toLocaleString()}</div>
                    <div className="text-xs text-base-content/50">{dmgPendingCount} invoices</div>
                  </div>
                </div>
                {/* Card 2: Owed to TC */}
                <div className="card bg-error/10 border border-error/20">
                  <div className="card-body p-3">
                    <div className="text-xs text-error font-semibold uppercase">Owed to TC</div>
                    <div className="text-2xl font-bold text-error">${Math.round(totalTcOwed).toLocaleString()}</div>
                    <div className="text-xs text-base-content/50">total outstanding</div>
                  </div>
                </div>
                {/* Card 3: In Review */}
                <div className="card bg-warning/10 border border-warning/20">
                  <div className="card-body p-3">
                    <div className="text-xs text-warning font-semibold uppercase">In Review</div>
                    <div className="text-2xl font-bold text-warning">${Math.round(dmgInReview).toLocaleString()}</div>
                    <div className="text-xs text-base-content/50">at DMG</div>
                  </div>
                </div>
                {/* Card 4: Open Pipeline */}
                <div className="card bg-accent/10 border border-accent/20">
                  <div className="card-body p-3">
                    <div className="text-xs text-accent font-semibold uppercase">Pipeline</div>
                    <div className="text-2xl font-bold text-accent">{pipelineJobs.length}</div>
                    <div className="text-xs text-base-content/50">open jobs</div>
                  </div>
                </div>
              </div>

              {/* Alert Strip */}
              {(quotesWaiting.length > 0 || servicesDueSoon.length > 0 || expiringContracts.length > 0 || totalReviewPending > 0) && (
                <div className="card bg-base-200">
                  <div className="card-body p-3 space-y-2">
                    <h3 className="text-xs font-bold uppercase text-base-content/60 flex items-center gap-1">
                      <AlertTriangle size={12} className="text-warning" /> Action Needed
                    </h3>
                    {totalReviewPending > 0 && (
                      <button
                        className="w-full flex items-center justify-between p-2 bg-info/10 rounded-lg text-left"
                        onClick={() => setShowReviewPanel(v => !v)}
                      >
                        <span className="text-sm">📋 {totalReviewPending} invoice{totalReviewPending !== 1 ? 's' : ''} need your review before TC sees them</span>
                        <ChevronRight size={14} className={`text-base-content/40 transition-transform ${showReviewPanel ? 'rotate-90' : ''}`} />
                      </button>
                    )}
                    {quotesWaiting.length > 0 && (
                      <button
                        className="w-full flex items-center justify-between p-2 bg-warning/10 rounded-lg text-left"
                        onClick={onPipeline}
                      >
                        <span className="text-sm">⏳ {quotesWaiting.length} quote{quotesWaiting.length !== 1 ? 's' : ''} waiting on TC</span>
                        <ChevronRight size={14} className="text-base-content/40" />
                      </button>
                    )}
                    {servicesDueSoon.length > 0 && (
                      <div className="p-2 bg-error/10 rounded-lg">
                        <span className="text-sm">🔴 {servicesDueSoon.length} service{servicesDueSoon.length !== 1 ? 's' : ''} due within 14 days</span>
                      </div>
                    )}
                    {expiringContracts.length > 0 && (
                      <div className="p-2 bg-orange-100 dark:bg-orange-900/20 rounded-lg">
                        <span className="text-sm">📋 {expiringContracts.length} contract{expiringContracts.length !== 1 ? 's' : ''} expiring within 60 days</span>
                        <div className="mt-1 space-y-0.5">
                          {expiringContracts.slice(0, 3).map(j => (
                            <div key={j.id} className="text-xs text-base-content/60">{j.property_name} — {j.contract_end}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Invoice Review Panel */}
              {showReviewPanel && !demoMode && (
                <div className="card bg-base-200">
                  <div className="card-body p-3 space-y-3">
                    <h3 className="text-xs font-bold uppercase text-base-content/60">📋 Invoice Review Queue</h3>
                    <p className="text-xs text-base-content/50">Approve to push to TC's payment page. Reject to flag for manual review.</p>

                    {/* Confident matches pending approval */}
                    {pendingReviewInvs.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-success">✅ Matched — Ready to Approve</div>
                        {pendingReviewInvs.map((inv: any) => (
                          <div key={inv.id} className="bg-base-100 rounded-lg p-3 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">{inv.crm_property_name || inv.customer}</span>
                              <span className="font-bold text-success">${Math.round(parseFloat(inv.tc_amount))} to TC</span>
                            </div>
                            <div className="text-xs text-base-content/50">
                              {inv.dmg_invoice_number} · {inv.invoice_date ? inv.invoice_date.slice(0,10) : ''} · DMG ${Math.round(parseFloat(inv.dmg_amount))}
                            </div>
                            {inv.dmg_expected_payment_date && (
                              <div className="text-xs text-base-content/50">Expected: {inv.dmg_expected_payment_date.slice(0,10)}</div>
                            )}
                            <div className="flex gap-2 mt-2">
                              <button
                                className="btn btn-xs btn-success flex-1"
                                disabled={reviewActionLoading === inv.id}
                                onClick={() => handleApproveInvoice(inv.id)}
                              >
                                {reviewActionLoading === inv.id ? <span className="loading loading-spinner loading-xs" /> : '✓ Approve'}
                              </button>
                              <button
                                className="btn btn-xs btn-ghost flex-1"
                                disabled={reviewActionLoading === inv.id}
                                onClick={() => handleRejectInvoice(inv.id)}
                              >
                                ✗ Reject
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Flagged / ambiguous items */}
                    {reviewQueueItems.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-warning">⚠️ Needs Manual Match</div>
                        {reviewQueueItems.map((item: any) => {
                          const candidates: {job_id: number, property_name: string}[] =
                            item.match_candidates ? (Array.isArray(item.match_candidates) ? item.match_candidates : JSON.parse(item.match_candidates)) : [];
                          const selectedJobId = manualMatchSelections[item.id];
                          const selectedJob = selectedJobId ? jobs.find((j: any) => j.id === selectedJobId) : null;
                          const selectedSvc = selectedJob ? jobServices[selectedJob.id] : null;
                          const tcPreview = selectedJob && selectedSvc && selectedSvc.per_visit_rate > 0
                            ? Math.round((parseFloat(item.dmg_amount) / selectedSvc.per_visit_rate) * selectedSvc.sub_per_visit_rate)
                            : null;
                          return (
                            <div key={item.id} className="bg-base-100 rounded-lg p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">{item.customer}</span>
                                <span className="font-bold">${Math.round(parseFloat(item.dmg_amount))}</span>
                              </div>
                              <div className="text-xs text-base-content/50">
                                {item.dmg_invoice_number} · {item.invoice_date ? item.invoice_date.slice(0,10) : ''}
                              </div>
                              <div className="text-xs text-warning">
                                {item.flag_reason === 'ambiguous' ? '⚠️ Multiple properties could match — pick one below' : '❓ No matching contracted rate found'}
                              </div>
                              {/* Property selector */}
                              <select
                                className="select select-bordered select-xs w-full"
                                value={selectedJobId ?? ''}
                                onChange={e => setManualMatchSelections(prev => ({...prev, [item.id]: parseInt(e.target.value)}))}
                              >
                                <option value="">— Select property —</option>
                                {candidates.length > 0
                                  ? candidates.map((c: any) => (
                                      <option key={c.job_id} value={c.job_id}>{c.property_name}</option>
                                    ))
                                  : jobs.filter((j: any) => j.status === 'active').map((j: any) => (
                                      <option key={j.id} value={j.id}>{j.property_name}</option>
                                    ))
                                }
                              </select>
                              {tcPreview !== null && (
                                <div className="text-xs text-success">TC gets: ${tcPreview}</div>
                              )}
                              <div className="flex gap-2">
                                <button
                                  className="btn btn-xs btn-success flex-1"
                                  disabled={!selectedJobId || reviewActionLoading === item.id}
                                  onClick={() => handleAssignAndApprove(item)}
                                >
                                  {reviewActionLoading === item.id ? '...' : '✓ Assign & Approve'}
                                </button>
                                <button
                                  className="btn btn-xs btn-ghost"
                                  disabled={reviewActionLoading === item.id}
                                  onClick={() => handleIgnoreQueueItem(item.id)}
                                >
                                  Dismiss
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {pendingReviewInvs.length === 0 && reviewQueueItems.length === 0 && (
                      <div className="text-sm text-base-content/40 text-center py-4">All caught up 🎉</div>
                    )}
                  </div>
                </div>
              )}

              {/* Revenue by Category */}
              <div className="card bg-base-200">
                <div className="card-body p-3">
                  <h3 className="text-xs font-bold uppercase text-base-content/60 mb-3">📊 Annual Contract Value</h3>
                  <div className="space-y-3">
                    {/* Landscaping */}
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium">🌿 Contract Landscaping</span>
                        <span className="font-bold">${Math.round(landscapingValue).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-xs text-base-content/50 mb-1">
                        <span>{landscapingJobs.length} active sites</span>
                        <span>{portfolioTotal > 0 ? Math.round((landscapingValue / portfolioTotal) * 100) : 0}% of portfolio</span>
                      </div>
                      <progress className="progress progress-primary w-full h-2" value={landscapingValue} max={portfolioTotal}></progress>
                    </div>
                    {/* Snow */}
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium">❄️ Snow Contracts</span>
                        <span className="font-bold">${Math.round(snowValue).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-xs text-base-content/50 mb-1">
                        <span>{snowJobs.length} locations</span>
                        <span>{portfolioTotal > 0 ? Math.round((snowValue / portfolioTotal) * 100) : 0}% of portfolio</span>
                      </div>
                      <progress className="progress progress-info w-full h-2" value={snowValue} max={portfolioTotal}></progress>
                    </div>
                    {/* Total */}
                    <div className="pt-2 border-t border-base-300 flex justify-between text-sm font-bold">
                      <span>Total Portfolio</span>
                      <span>${Math.round(portfolioTotal).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* TC Payment Health */}
              <div className="card bg-base-200">
                <div className="card-body p-3">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold uppercase text-base-content/60">💸 TC Payment Health</h3>
                    <button className="btn btn-xs btn-ghost" onClick={onPayments}>View Details →</button>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Legacy (Jan/Feb/Snow)</span>
                      <span className="font-bold text-error">${Math.round(legacyOwed).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>One-Off Jobs</span>
                      <span className="font-bold">${Math.round(oneOffOwed).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Contract Invoices</span>
                      <span className="font-bold">${Math.round(contractOwed).toLocaleString()}</span>
                    </div>
                    <div className="pt-2 border-t border-base-300 flex justify-between font-bold">
                      <span>Total Owed to TC</span>
                      <span className="text-error">${Math.round(totalTcOwed).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="grid grid-cols-2 gap-2">
                <button className="btn btn-sm btn-outline" onClick={onSubDashboard}>
                  <Eye size={14} /> View as TC
                </button>
                <button className="btn btn-sm btn-primary btn-outline" onClick={onAddJob}>
                  <Plus size={14} /> Add Job
                </button>
                <button className="btn btn-sm btn-secondary btn-outline" onClick={onSubOverview}>
                  <Users size={14} /> Sub Overview
                </button>
                <button className="btn btn-sm btn-accent btn-outline" onClick={onPipeline}>
                  <GitBranch size={14} /> Pipeline
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Jobs Tab ─────────────────────────────────────────────────────── */}
      {(activeTab === 'jobs' || demoMode) && (
        <div className="overflow-x-auto">
          <table className="table table-zebra w-full">
            <thead>
              <tr>
                <th>Property</th>
                <th>Client</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-center text-base-content/60 py-8">
                    No jobs yet — add your first contract!
                  </td>
                </tr>
              )}
              {jobs.map(job => (
                <tr key={job.id} className="cursor-pointer hover" onClick={() => onSelectJob(job.id)}>
                  <td>
                    <div className="font-medium">{job.property_name}</div>
                    <div className="text-xs text-base-content/60">{job.property_address}</div>
                  </td>
                  <td>{job.client_name}{job.store_number ? ` (#${job.store_number})` : ''}</td>
                  <td>
                    <span className={`badge badge-sm ${getStatusColor(job.status)}`}>{job.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Financials Tab ───────────────────────────────────────────────── */}
      {!demoMode && activeTab === 'financials' && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="card bg-base-200">
              <div className="card-body p-4">
                <div className="flex items-center gap-2 text-base-content/60 text-sm">
                  <DollarSign size={16} className="opacity-60" /> Contract Value
                </div>
                <div className="text-2xl font-bold">{formatCurrency(totalContractValue)}</div>
                <div className="text-xs text-base-content/50">{activeJobs.length} active contracts</div>
              </div>
            </div>
            <div className="card bg-base-200">
              <div className="card-body p-4">
                <div className="flex items-center gap-2 text-base-content/60 text-sm">
                  <Users size={16} className="opacity-60" /> Sub Costs
                </div>
                <div className="text-2xl font-bold">{formatCurrency(totalSubPay)}</div>
                <div className="text-xs text-base-content/50">{100 - profitMargin}% of contract value</div>
              </div>
            </div>
            <div className="card bg-success/10 border border-success/20">
              <div className="card-body p-4">
                <div className="flex items-center gap-2 text-success/80 text-sm">
                  <TrendingUp size={16} /> Your Profit
                </div>
                <div className="text-2xl font-bold text-success">{formatCurrency(totalProfit)}</div>
                <div className="text-xs text-success/70">{profitMargin}% margin</div>
              </div>
            </div>
          </div>

          {/* Revenue by Contract Type */}
          <div className="card bg-base-200">
            <div className="card-body p-3">
              <h3 className="text-xs font-bold uppercase text-base-content/60 mb-3">📊 By Contract Type</h3>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">🌿 Contract Landscaping</span>
                    <span className="font-bold">{formatCurrency(landscapingValue)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-base-content/50 mb-1">
                    <span>{landscapingJobs.length} active sites</span>
                    <span>{portfolioTotal > 0 ? Math.round((landscapingValue / portfolioTotal) * 100) : 0}% of portfolio</span>
                  </div>
                  <progress className="progress progress-primary w-full h-2" value={landscapingValue} max={portfolioTotal}></progress>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">❄️ Snow Contracts</span>
                    <span className="font-bold">{formatCurrency(snowValue)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-base-content/50 mb-1">
                    <span>{snowJobs.length} locations</span>
                    <span>{portfolioTotal > 0 ? Math.round((snowValue / portfolioTotal) * 100) : 0}% of portfolio</span>
                  </div>
                  <progress className="progress progress-info w-full h-2" value={snowValue} max={portfolioTotal}></progress>
                </div>
                <div className="pt-2 border-t border-base-300 flex justify-between text-sm font-bold">
                  <span>Total Portfolio</span>
                  <span>{formatCurrency(portfolioTotal)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* By Client Breakdown */}
          <div>
            <h3 className="font-semibold text-sm text-base-content/60 uppercase tracking-wide mb-2">By Client</h3>
            <div className="space-y-2">
              {Object.entries(clientBreakdown)
                .sort(([_ka, a], [_kb, b]) => b.value - a.value)
                .map(([client, data]) => {
                  const profit = data.value - data.subCost;
                  const margin = data.value > 0 ? Math.round((profit / data.value) * 100) : 0;
                  return (
                    <div key={client} className="card bg-base-200">
                      <div className="card-body p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium">{client}</div>
                            <div className="text-xs text-base-content/50">{data.count} site{data.count !== 1 ? 's' : ''}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold">{formatCurrency(data.value)}</div>
                            <div className="text-xs text-success">+{formatCurrency(profit)} profit ({margin}%)</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
