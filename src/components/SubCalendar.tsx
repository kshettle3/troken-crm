import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Check, MapPin, Clock, AlertTriangle, Unlock, X, Wrench } from 'lucide-react';
import { Job, Service, CalendarVisit, ServiceCompletion } from '../types';
import { db } from '../db'
import {
  getActiveFrequency, getCountdownDays, getFrequencyLabel,
  getDMGWeekStart, getWeekDays, toDateStr, formatDayLabel, isLowes,
  FrequencyType
} from '../utils/calendar-helpers';

interface SubCalendarProps {
  jobs: Job[];
  allServices: Service[];
  isPortalMode?: boolean;
}

interface CheckInModal {
  visitId: number;
  jobId: number;
  propertyName: string;
  additionalServices: Service[];
  selectedServiceIds: Set<number>;
}

interface PropertyInfo {
  jobId: number;
  name: string;
  metro: string;
  clientName: string;
  frequency: FrequencyType;
  isLowes: boolean;
  lastCheckIn: string | null;
  countdown: number | null; // days until next visit due, null if no check-in yet
}

export const SubCalendar: React.FC<SubCalendarProps> = ({ jobs, allServices, isPortalMode }) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentMonth = today.getMonth() + 1;

  // The 3 week starts (Sundays) for rolling view
  const baseWeekStart = getDMGWeekStart(today);
  const [weekOffset, setWeekOffset] = useState(0); // 0=current, 1=next, 2=week after
  const [visits, setVisits] = useState<CalendarVisit[]>([]);
  const [assigning, setAssigning] = useState<number | null>(null); // job_id being assigned
  const [loading, setLoading] = useState(true);
  const [checkInModal, setCheckInModal] = useState<CheckInModal | null>(null);
  const [completedServiceIds, setCompletedServiceIds] = useState<Set<number>>(new Set());
  // Owner can unlock an entire week so TC can schedule past days (e.g., mid-week start)
  const [unlockedWeekStarts, setUnlockedWeekStarts] = useState<Set<string>>(new Set([toDateStr(baseWeekStart)])); // current week unlocked by default for initial setup

  // Get the week start for current offset
  const activeWeekStart = new Date(baseWeekStart);
  activeWeekStart.setDate(activeWeekStart.getDate() + weekOffset * 7);
  const weekDays = getWeekDays(activeWeekStart);
  const weekStartStr = toDateStr(activeWeekStart);

  // Active sub jobs with frequency for current month
  const subJobs = jobs.filter(j => j.sub_id != null && j.status === 'active');

  // Build property info with frequencies
  const propertyInfos: PropertyInfo[] = subJobs.map(j => {
    const jobServices = allServices.filter(s => s.job_id === j.id);
    const freq = getActiveFrequency(jobServices, currentMonth);
    return {
      jobId: j.id,
      name: j.property_name,
      metro: j.metro || 'Unknown',
      clientName: j.client_name || '',
      frequency: freq,
      isLowes: isLowes(j.client_name),
      lastCheckIn: null,
      countdown: null
    };
  }).filter(p => p.frequency !== 'none'); // Only show properties active this month

  // Load visits for all 3 weeks
  const loadVisits = useCallback(async () => {
    try {
      const w0 = toDateStr(baseWeekStart);
      const w2end = new Date(baseWeekStart);
      w2end.setDate(w2end.getDate() + 21);
      const rows: any = await db.query(
        `SELECT cv.*, j.property_name, j.metro, j.client_name 
         FROM calendar_visits cv 
         JOIN jobs j ON j.id = cv.job_id 
         WHERE cv.scheduled_date >= '${w0}' AND cv.scheduled_date < '${toDateStr(w2end)}'
         ORDER BY cv.scheduled_date`
      );
      setVisits(rows);
    } catch (err) {
      console.error('Failed to load calendar visits:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load last check-ins for countdown calculation
  const [lastCheckIns, setLastCheckIns] = useState<Record<number, string>>({});

  const loadLastCheckIns = useCallback(async () => {
    try {
      const rows: any = await db.query(
        `SELECT job_id, MAX(checked_in_at) as last_check 
         FROM calendar_visits 
         WHERE checked_in = 1 
         GROUP BY job_id`
      );
      const map: Record<number, string> = {};
      for (const r of rows) {
        map[r.job_id] = r.last_check;
      }
      setLastCheckIns(map);
    } catch (err) {
      console.error('Failed to load check-ins:', err);
    }
  }, []);

  // Load completed service IDs
  const loadCompletions = useCallback(async () => {
    try {
      const rows: any = await db.query(
        `SELECT service_id FROM service_completions`
      );
      setCompletedServiceIds(new Set(rows.map((r: any) => r.service_id)));
    } catch (err) {
      console.error('Failed to load completions:', err);
    }
  }, []);

  useEffect(() => {
    loadVisits();
    loadLastCheckIns();
    loadCompletions();
  }, [loadVisits, loadLastCheckIns, loadCompletions]);

  // Get visits for a specific day
  function visitsForDay(dateStr: string): CalendarVisit[] {
    return visits.filter(v => v.scheduled_date === dateStr);
  }

  // Get scheduled job IDs for current week
  function scheduledJobIds(): Set<number> {
    const weekEnd = new Date(activeWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return new Set(
      visits
        .filter(v => v.scheduled_date >= weekStartStr && v.scheduled_date < toDateStr(weekEnd))
        .map(v => v.job_id)
    );
  }

  // Unscheduled properties for this week
  const scheduled = scheduledJobIds();
  const unscheduled = propertyInfos.filter(p => !scheduled.has(p.jobId));
  const unscheduledSpartanburg = unscheduled.filter(p => p.metro === 'Spartanburg');
  const unscheduledRockHill = unscheduled.filter(p => p.metro === 'Rock Hill');

  // Assign property to a day
  async function assignToDay(jobId: number, dateStr: string) {
    const optimistic: CalendarVisit = {
      id: Date.now(),
      job_id: jobId,
      scheduled_date: dateStr,
      checked_in: 0,
      checked_in_at: null,
      unlocked: 0,
      week_start: weekStartStr,
      created_at: new Date().toISOString(),
      property_name: propertyInfos.find(p => p.jobId === jobId)?.name,
      metro: propertyInfos.find(p => p.jobId === jobId)?.metro,
      client_name: propertyInfos.find(p => p.jobId === jobId)?.clientName
    };
    setVisits(prev => [...prev, optimistic]);
    setAssigning(null);
    try {
      await db.execute(
        `INSERT INTO calendar_visits (job_id, scheduled_date, week_start) VALUES (${jobId}, '${dateStr}', '${weekStartStr}')`
      );
      loadVisits();
    } catch (err) {
      console.error('Failed to assign visit:', err);
      setVisits(prev => prev.filter(v => v.id !== optimistic.id));
    }
  }

  // Start check-in: check for additional services first
  function startCheckIn(visitId: number, jobId: number) {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;

    // Get additional (non-routine) services for this property that haven't been completed
    const additionalSvcs = allServices.filter(s =>
      s.job_id === jobId &&
      !s.service_type.toLowerCase().includes('routine') &&
      !completedServiceIds.has(s.id)
    );

    if (additionalSvcs.length === 0) {
      // No additional services pending — straight one-tap check-in
      doCheckIn(visitId);
    } else {
      // Show the modal with additional services
      setCheckInModal({
        visitId,
        jobId,
        propertyName: job.property_name,
        additionalServices: additionalSvcs,
        selectedServiceIds: new Set()
      });
    }
  }

  // Toggle service selection in modal
  function toggleServiceInModal(serviceId: number) {
    if (!checkInModal) return;
    const newSet = new Set(checkInModal.selectedServiceIds);
    if (newSet.has(serviceId)) {
      newSet.delete(serviceId);
    } else {
      newSet.add(serviceId);
    }
    setCheckInModal({ ...checkInModal, selectedServiceIds: newSet });
  }

  // Confirm check-in from modal (with optional additional services)
  async function confirmCheckIn() {
    if (!checkInModal) return;
    const { visitId, jobId, selectedServiceIds } = checkInModal;
    setCheckInModal(null);

    await doCheckIn(visitId);

    // Record completions for selected additional services
    if (selectedServiceIds.size > 0) {
      const now = new Date().toISOString();
      for (const svcId of selectedServiceIds) {
        try {
          await db.execute(
            `INSERT INTO service_completions (service_id, job_id, visit_id, completed_at) VALUES (${svcId}, ${jobId}, ${visitId}, '${now}')`
          );
        } catch (err) {
          console.error('Failed to record service completion:', err);
        }
      }
      loadCompletions();
    }
  }

  // Actual check-in execution
  async function doCheckIn(visitId: number) {
    const now = new Date().toISOString();
    setVisits(prev => prev.map(v => v.id === visitId ? { ...v, checked_in: 1, checked_in_at: now } : v));
    try {
      await db.execute(
        `UPDATE calendar_visits SET checked_in = 1, checked_in_at = '${now}' WHERE id = ${visitId}`
      );
      loadLastCheckIns();
    } catch (err) {
      console.error('Failed to check in:', err);
      setVisits(prev => prev.map(v => v.id === visitId ? { ...v, checked_in: 0, checked_in_at: null } : v));
    }
  }

  // Owner unlock a past visit
  async function unlockVisit(visitId: number) {
    setVisits(prev => prev.map(v => v.id === visitId ? { ...v, checked_in: 0, checked_in_at: null, unlocked: 1 } : v));
    try {
      await db.execute(
        `UPDATE calendar_visits SET checked_in = 0, checked_in_at = NULL, unlocked = 1 WHERE id = ${visitId}`
      );
    } catch (err) {
      console.error('Failed to unlock visit:', err);
      loadVisits();
    }
  }

  // Remove a scheduled (unchecked) visit
  async function removeVisit(visitId: number) {
    setVisits(prev => prev.filter(v => v.id !== visitId));
    try {
      await db.execute(`DELETE FROM calendar_visits WHERE id = ${visitId}`);
    } catch (err) {
      console.error('Failed to remove visit:', err);
      loadVisits();
    }
  }

  // Calculate countdown for a property
  function getPropertyCountdown(jobId: number): { days: number; overdue: boolean } | null {
    const lastCheck = lastCheckIns[jobId];
    if (!lastCheck) return null;
    const info = propertyInfos.find(p => p.jobId === jobId);
    if (!info) return null;
    const countdownDays = getCountdownDays(info.frequency, currentMonth);
    if (countdownDays === 0) return null;
    const lastDate = new Date(lastCheck);
    const dueDate = new Date(lastDate);
    dueDate.setDate(dueDate.getDate() + countdownDays);
    const diff = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return { days: diff, overdue: diff < 0 };
  }

  // Check if a date is in the past (respects owner-unlocked weeks)
  function isPast(dateStr: string): boolean {
    if (unlockedWeekStarts.has(weekStartStr)) return false; // entire week unlocked
    return new Date(dateStr + 'T23:59:59') < today;
  }

  // Week labels for the 3-week selector
  const weekLabels = [0, 1, 2].map(offset => {
    const ws = new Date(baseWeekStart);
    ws.setDate(ws.getDate() + offset * 7);
    const mon = new Date(ws); mon.setDate(mon.getDate() + 1);
    const sat = new Date(ws); sat.setDate(sat.getDate() + 6);
    return `${mon.getMonth() + 1}/${mon.getDate()} - ${sat.getMonth() + 1}/${sat.getDate()}`;
  });

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Week Selector */}
      <div className="flex items-center justify-between bg-base-200 rounded-lg p-2">
        <button
          className="btn btn-ghost btn-sm"
          disabled={weekOffset === 0}
          onClick={() => setWeekOffset(w => w - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        <div className="flex gap-1">
          {weekLabels.map((label, i) => (
            <button
              key={i}
              className={`btn btn-xs ${weekOffset === i ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setWeekOffset(i)}
            >
              {i === 0 ? 'This Week' : i === 1 ? 'Next' : 'Week 3'}
            </button>
          ))}
        </div>
        <button
          className="btn btn-ghost btn-sm"
          disabled={weekOffset === 2}
          onClick={() => setWeekOffset(w => w + 1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Week date range */}
      <div className="text-center text-xs text-base-content/60">
        DMG Week: {weekLabels[weekOffset]}
      </div>

      {/* Unscheduled Pool */}
      {unscheduled.length > 0 && (
        <div className="bg-base-200 rounded-lg p-3 space-y-2">
          <h3 className="text-sm font-bold text-base-content/60 uppercase">
            Unscheduled ({unscheduled.length})
          </h3>

          {unscheduledSpartanburg.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-base-content/50 mb-1 flex items-center gap-1">
                <MapPin size={10} /> Spartanburg ({unscheduledSpartanburg.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {unscheduledSpartanburg.map(p => (
                  <PropertyTile
                    key={p.jobId}
                    property={p}
                    isSelected={assigning === p.jobId}
                    countdown={getPropertyCountdown(p.jobId)}
                    onTap={() => setAssigning(assigning === p.jobId ? null : p.jobId)}
                  />
                ))}
              </div>
            </div>
          )}

          {unscheduledRockHill.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-base-content/50 mb-1 flex items-center gap-1">
                <MapPin size={10} /> Rock Hill ({unscheduledRockHill.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {unscheduledRockHill.map(p => (
                  <PropertyTile
                    key={p.jobId}
                    property={p}
                    isSelected={assigning === p.jobId}
                    countdown={getPropertyCountdown(p.jobId)}
                    onTap={() => setAssigning(assigning === p.jobId ? null : p.jobId)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Day Assign Bar - shows when a property is selected */}
      {assigning !== null && (
        <div className="bg-primary/10 border border-primary/30 rounded-lg p-2 sticky top-0 z-10">
          <p className="text-xs text-center mb-2">
            Assign <strong>{propertyInfos.find(p => p.jobId === assigning)?.name}</strong> to:
          </p>
          <div className="flex gap-1 flex-wrap justify-center">
            {weekDays.map(d => {
              const dateStr = toDateStr(d);
              const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
              const past = isPast(dateStr);
              return (
                <button
                  key={dateStr}
                  className={`btn btn-xs ${past ? 'btn-disabled' : 'btn-outline btn-primary'}`}
                  disabled={past}
                  onClick={() => assignToDay(assigning, dateStr)}
                >
                  {dayName} {d.getDate()}
                </button>
              );
            })}
            <button className="btn btn-xs btn-ghost" onClick={() => setAssigning(null)}>
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Daily Cards */}
      {weekDays.map(d => {
        const dateStr = toDateStr(d);
        const dayVisits = visitsForDay(dateStr);
        const isToday = dateStr === toDateStr(today);
        const past = isPast(dateStr);
        const isFriday = d.getDay() === 5;
        const isSaturday = d.getDay() === 6;
        const dayName = formatDayLabel(d);

        return (
          <div
            key={dateStr}
            className={`rounded-lg border ${isToday ? 'border-primary bg-primary/5' : 'border-base-300 bg-base-200'}`}
          >
            <div className="flex items-center justify-between p-2 border-b border-base-300">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${isToday ? 'text-primary' : ''}`}>
                  {dayName}
                </span>
                {isToday && <span className="badge badge-primary badge-xs">Today</span>}
                {isSaturday && <span className="badge badge-warning badge-xs">Weather Makeup</span>}
              </div>
              <span className="text-xs text-base-content/40">{dayVisits.length} sites</span>
            </div>

            {dayVisits.length === 0 ? (
              <div className="p-2 text-xs text-base-content/30 text-center">No visits scheduled</div>
            ) : (
              <div className="p-1 space-y-1">
                {dayVisits.map(v => {
                  const info = propertyInfos.find(p => p.jobId === v.job_id);
                  const countdown = getPropertyCountdown(v.job_id);
                  const visitPast = past && !isToday;
                  const isLocked = visitPast && v.checked_in === 1 && v.unlocked === 0;
                  const canCheckIn = !visitPast || v.unlocked === 1;
                  const lowesWarning = info?.isLowes && isFriday && v.checked_in === 0;

                  return (
                    <div
                      key={v.id}
                      className={`flex items-center justify-between p-2 rounded ${
                        v.checked_in ? 'bg-success/10' : lowesWarning ? 'bg-error/10' : 'bg-base-300'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className={`text-sm font-medium truncate ${v.checked_in ? 'line-through text-base-content/40' : ''}`}>
                            {v.property_name}
                          </span>
                          {info?.isLowes && (
                            <span className="badge badge-error badge-xs">Fri</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-base-content/50">
                          <span>{v.metro}</span>
                          {info && <span>• {getFrequencyLabel(info.frequency)}</span>}
                          {v.checked_in === 1 && countdown && (
                            <span className={`flex items-center gap-0.5 ${countdown.overdue ? 'text-error font-bold' : countdown.days <= 3 ? 'text-warning' : 'text-success'}`}>
                              <Clock size={10} />
                              {countdown.overdue
                                ? `${Math.abs(countdown.days)}d overdue`
                                : `Next in ${countdown.days}d`
                              }
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 ml-2">
                        {/* Check-in button */}
                        {v.checked_in === 0 && canCheckIn && (
                          <button
                            className="btn btn-circle btn-sm btn-success"
                            onClick={() => startCheckIn(v.id, v.job_id)}
                          >
                            <Check size={16} />
                          </button>
                        )}
                        {/* Checked in indicator */}
                        {v.checked_in === 1 && (
                          <span className="text-success">
                            <Check size={20} />
                          </span>
                        )}
                        {/* Owner unlock button for past locked visits */}
                        {!isPortalMode && isLocked && (
                          <button
                            className="btn btn-circle btn-xs btn-ghost"
                            title="Unlock this visit"
                            onClick={() => unlockVisit(v.id)}
                          >
                            <Unlock size={14} />
                          </button>
                        )}
                        {/* Remove button (only for unchecked, not past) */}
                        {v.checked_in === 0 && !visitPast && (
                          <button
                            className="btn btn-circle btn-xs btn-ghost text-base-content/30"
                            onClick={() => removeVisit(v.id)}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Lowe's Friday deadline warning */}
            {isFriday && dayVisits.some(v => {
              const info = propertyInfos.find(p => p.jobId === v.job_id);
              return info?.isLowes && v.checked_in === 0;
            }) && (
              <div className="p-2 bg-error/10 text-error text-xs flex items-center gap-1 rounded-b">
                <AlertTriangle size={12} /> Lowe's must be completed by Friday 11:59 PM
              </div>
            )}
          </div>
        );
      })}

      {/* Legend */}
      <div className="bg-base-200 rounded-lg p-3 space-y-1">
        <h4 className="text-xs font-bold text-base-content/60 uppercase">Legend</h4>
        <div className="flex flex-wrap gap-3 text-xs text-base-content/60">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success inline-block" /> Checked In</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-error inline-block" /> Overdue</span>
          <span className="flex items-center gap-1"><span className="badge badge-error badge-xs">Fri</span> Lowe's Deadline</span>
          <span className="flex items-center gap-1"><span className="badge badge-warning badge-xs">Weather</span> Saturday Makeup</span>
        </div>
      </div>

      {/* Additional Services Check-In Modal */}
      {checkInModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-base-100 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[85vh] flex flex-col">
            {/* Modal Header */}
            <div className="p-4 border-b border-base-300">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-lg">Complete Visit</h3>
                  <p className="text-sm text-base-content/60">{checkInModal.propertyName}</p>
                </div>
                <button
                  className="btn btn-ghost btn-sm btn-circle"
                  onClick={() => setCheckInModal(null)}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Additional Services List */}
            <div className="p-4 overflow-y-auto flex-1">
              <div className="flex items-center gap-2 mb-3">
                <Wrench size={16} className="text-warning" />
                <p className="text-sm font-semibold">Any additional services completed?</p>
              </div>
              <div className="space-y-2">
                {checkInModal.additionalServices.map(svc => {
                  const isSelected = checkInModal.selectedServiceIds.has(svc.id);
                  return (
                    <button
                      key={svc.id}
                      className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                        isSelected
                          ? 'border-success bg-success/10'
                          : 'border-base-300 bg-base-200'
                      }`}
                      onClick={() => toggleServiceInModal(svc.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">{svc.service_type}</div>
                          <div className="text-xs text-base-content/50 mt-0.5">
                            {svc.schedule_description?.replace(/\s*-\s*\$[\d,.]+\/per visit/i, '') || ''}
                          </div>
                          {svc.deadline && (
                            <div className="text-xs text-warning mt-0.5">
                              Due by {new Date(svc.deadline + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </div>
                          )}
                        </div>
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ml-2 ${
                          isSelected ? 'bg-success text-success-content' : 'border-2 border-base-300'
                        }`}>
                          {isSelected && <Check size={14} />}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-base-300 space-y-2">
              <button
                className="btn btn-success w-full"
                onClick={confirmCheckIn}
              >
                <Check size={18} />
                {checkInModal.selectedServiceIds.size > 0
                  ? `Complete Visit + ${checkInModal.selectedServiceIds.size} Service${checkInModal.selectedServiceIds.size > 1 ? 's' : ''}`
                  : 'Complete Visit Only'
                }
              </button>
              <button
                className="btn btn-ghost btn-sm w-full"
                onClick={() => setCheckInModal(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Property tile component for the unscheduled pool
interface PropertyTileProps {
  property: PropertyInfo;
  isSelected: boolean;
  countdown: { days: number; overdue: boolean } | null;
  onTap: () => void;
}

const PropertyTile: React.FC<PropertyTileProps> = ({ property, isSelected, countdown, onTap }) => {
  // Shorten name for mobile tiles
  const shortName = property.name.length > 20 
    ? property.name.replace(/Family Dollar \(DT\)/, 'FD').replace(/Ferguson Enterprises/, 'Ferguson').replace(/PNC Bank: Chandler Commons/, 'PNC Bank')
    : property.name;

  return (
    <button
      className={`btn btn-xs ${isSelected ? 'btn-primary' : 'btn-outline'} ${
        countdown?.overdue ? 'border-error text-error' : ''
      } ${property.isLowes ? 'border-warning' : ''}`}
      onClick={onTap}
    >
      <span className="truncate max-w-[120px]">{shortName}</span>
      <span className="text-[10px] opacity-60">{getFrequencyLabel(property.frequency)}</span>
      {countdown?.overdue && <AlertTriangle size={10} className="text-error" />}
      {property.isLowes && <span className="text-[10px] text-warning">Fri</span>}
    </button>
  );
};
