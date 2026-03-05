import React, { useState, useEffect } from 'react';
import { ArrowLeft, MapPin, DollarSign, Calendar, AlertTriangle, Clock, ChevronDown, ChevronUp, MessageSquare, Send, FileText } from 'lucide-react';
import { SubCalendar } from './SubCalendar';
import { Job, Sub, Service, Note, PipelineJob, QuoteLineItem } from '../types';
import { formatCurrency, formatDate } from '../utils/helpers';
import { db } from '../db'

// Calculate what TC gets paid for a service
function calcSubServicePay(svc: Service): number {
  const visits = svc.total_visits ?? 0;
  // If we have visits, use per-visit math
  if (visits > 0) {
    if (svc.sub_per_visit_rate != null) return svc.sub_per_visit_rate * visits;
    if (svc.per_visit_rate != null && svc.per_visit_rate > 0) {
      const pct = svc.sub_rate_pct != null ? svc.sub_rate_pct / 100 : 0.80;
      return Math.round(pct * svc.per_visit_rate) * visits;
    }
  }
  // Weekly contracts: no visit count but has per-visit rates — derive from total value
  if (visits === 0 && (svc.total_value ?? 0) > 0) {
    if (svc.sub_per_visit_rate != null && svc.per_visit_rate != null && svc.per_visit_rate > 0) {
      return Math.round((svc.total_value ?? 0) * (svc.sub_per_visit_rate / svc.per_visit_rate));
    }
    // Fallback: percentage of total value
    const pct = svc.sub_rate_pct != null ? svc.sub_rate_pct / 100 : 0.80;
    return Math.round(pct * (svc.total_value ?? 0));
  }
  // $0 service
  return 0;
}

// Get TC's per-visit rate for a service
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

// Strip owner's dollar amounts from schedule descriptions
// e.g., "1 time per week (Apr-Oct) - $175.00/per visit" → "1 time per week (Apr-Oct)"
function cleanScheduleForSub(desc: string | null): string {
  if (!desc) return '';
  return desc.replace(/\s*-\s*\$[\d,.]+\/per visit/gi, '').trim();
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

interface SubDashboardProps {
  subs: Sub[];
  jobs: Job[];
  allServices: Service[];
  onBack: () => void;
  isPortalMode?: boolean;
  loggedInSubName?: string;
}

export const SubDashboard: React.FC<SubDashboardProps> = ({ subs, jobs, allServices, onBack, isPortalMode, loggedInSubName }) => {
  const sub = subs[0];
  if (!sub) return <div className="p-4">No sub assigned.</div>;

  const [activeTab, setActiveTab] = useState<'properties'|'calendar'|'quotes'|'deadlines'>('properties');
  const [expandedJob, setExpandedJob] = useState<number|null>(null);
  const [notes, setNotes] = useState<Record<number, Note[]>>({});
  const [newNote, setNewNote] = useState<Record<number, string>>({});
  const [pipelineJobs, setPipelineJobs] = useState<PipelineJob[]>([]);
  const [expandedQuote, setExpandedQuote] = useState<number|null>(null);
  const [quoteLineItems, setQuoteLineItems] = useState<QuoteLineItem[]>([]);

  const subJobs = jobs.filter(j => j.sub_id === sub.id && j.status === 'active');
  const totalPay = subJobs.reduce((sum, j) => sum + calcJobSubCost(j.id, allServices), 0);
  const upcoming = getUpcomingServices(subJobs, allServices, 90);

  useEffect(() => {
    db.query(
      `SELECT p.*, s.name as sub_name FROM pipeline_jobs p LEFT JOIN subs s ON p.sub_id = s.id WHERE p.sub_id = ${sub.id} AND p.stage = 'quote' ORDER BY p.deadline ASC`
    ).then((rows: any) => setPipelineJobs(rows));
  }, [sub.id]);

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

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-base-200 rounded-lg p-3 text-center">
          <div className="text-base-content/60 text-xs flex items-center justify-center gap-1"><MapPin size={12}/> Sites</div>
          <div className="text-2xl font-bold">{subJobs.length}</div>
        </div>
        <div className="bg-base-200 rounded-lg p-3 text-center">
          <div className="text-base-content/60 text-xs flex items-center justify-center gap-1"><DollarSign size={12}/> Total Pay</div>
          <div className="text-2xl font-bold">{formatCurrency(totalPay)}</div>
        </div>
        <div className="bg-base-200 rounded-lg p-3 text-center">
          <div className="text-base-content/60 text-xs flex items-center justify-center gap-1"><Clock size={12}/> Due Soon</div>
          <div className="text-2xl font-bold text-warning">{upcoming.length}</div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="tabs tabs-boxed bg-base-200">
        <button className={`tab flex-1 ${activeTab === 'properties' ? 'tab-active' : ''}`} onClick={() => setActiveTab('properties')}>
          Sites
        </button>
        <button className={`tab flex-1 ${activeTab === 'calendar' ? 'tab-active' : ''}`} onClick={() => setActiveTab('calendar')}>
          📅 Plan
        </button>
        <button className={`tab flex-1 ${activeTab === 'deadlines' ? 'tab-active' : ''}`} onClick={() => setActiveTab('deadlines')}>
          Due {upcoming.length > 0 && <span className="badge badge-warning badge-xs ml-1">{upcoming.length}</span>}
        </button>
        <button className={`tab flex-1 ${activeTab === 'quotes' ? 'tab-active' : ''}`} onClick={() => setActiveTab('quotes')}>
          Quotes {pipelineJobs.length > 0 && <span className="badge badge-info badge-xs ml-1">{pipelineJobs.length}</span>}
        </button>
      </div>

      {/* Properties Tab */}
      {activeTab === 'properties' && (
        <div className="space-y-2">
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

                      {/* Notes - Shared + Contractor only */}
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
        <SubCalendar
          jobs={jobs}
          allServices={allServices}
          isPortalMode={isPortalMode}
        />
      )}

      {/* Deadlines Tab */}
      {activeTab === 'deadlines' && (
        <div className="card bg-base-200">
          <div className="card-body p-4">
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
      )}

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
                        {pj.work_type === 'one_time' && pj.quote_format === 'breakdown' && (
                          <div>
                            <h4 className="text-xs font-semibold text-base-content/60 uppercase mb-1">Quote Breakdown Needed</h4>
                            <div className="text-sm text-base-content/60">
                              Categories: Time, Material, Equipment, Trip Charge, Miscellaneous
                            </div>
                          </div>
                        )}
                        {pj.work_type === 'one_time' && pj.quote_format === 'lump_sum' && (
                          <div className="text-sm text-base-content/60">
                            <span className="font-medium">Lump Sum</span> quote requested
                          </div>
                        )}
                        {pj.notes && (
                          <div>
                            <h4 className="text-xs font-semibold text-base-content/60 uppercase mb-1">Notes</h4>
                            <p className="text-sm">{pj.notes}</p>
                          </div>
                        )}
                        <div className="bg-info/10 border border-info/30 rounded p-2 text-xs text-info">
                          📋 Review this scope and submit your quote to Troken LLC
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
