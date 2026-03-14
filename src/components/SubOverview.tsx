import React from 'react';
import { ArrowLeft, MapPin, DollarSign, Calendar, AlertTriangle, Clock } from 'lucide-react';
import { Job, Sub, Service } from '../types';
import { formatCurrency, formatDate } from '../utils/helpers';

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

interface UpcomingService {
  propertyName: string;
  propertyAddress: string | null;
  serviceType: string;
  deadline: string;
  daysUntil: number;
  scheduleDescription: string | null;
  jobId: number;
}

function getUpcomingServices(jobs: Job[], allServices: Service[], daysAhead: number): UpcomingService[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + daysAhead);

  const upcoming: UpcomingService[] = [];

  for (const job of jobs) {
    const jobSvcs = allServices.filter(s => s.job_id === job.id);
    for (const svc of jobSvcs) {
      if (!svc.deadline) continue;
      const dl = new Date(svc.deadline + 'T00:00:00');
      if (dl >= now && dl <= cutoff) {
        const diffTime = dl.getTime() - now.getTime();
        const daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        upcoming.push({
          propertyName: job.property_name,
          propertyAddress: job.property_address,
          serviceType: svc.service_type,
          deadline: svc.deadline,
          daysUntil,
          scheduleDescription: svc.schedule_description,
          jobId: job.id,
        });
      }
    }
  }

  upcoming.sort((a, b) => a.daysUntil - b.daysUntil);
  return upcoming;
}

interface SubOverviewProps {
  subs: Sub[];
  jobs: Job[];
  allServices: Service[];
  onBack: () => void;
  onSelectJob: (id: number) => void;
  isCrewMode?: boolean;
}

export const SubOverview: React.FC<SubOverviewProps> = ({ subs, jobs, allServices, onBack, onSelectJob, isCrewMode }) => {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={18} /></button>
        <h2 className="text-xl font-bold">Sub Overview</h2>
      </div>

      {subs.map(sub => {
        const subJobs = jobs.filter(j => j.sub_id === sub.id && j.status === 'active');
        const totalOwed = subJobs.reduce((sum, j) => sum + calcJobSubCost(j.id, allServices), 0);
        const upcoming = getUpcomingServices(subJobs, allServices, 90);

        return (
          <div key={sub.id} className="space-y-4">
            <div className="card bg-base-200">
              <div className="card-body p-4 space-y-3">
                <h3 className="text-lg font-bold">{sub.name}</h3>

                {/* Summary stats */}
                <div className={`grid gap-3 ${isCrewMode ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  <div className="bg-base-300 rounded-lg p-3 text-center">
                    <div className="text-base-content/60 text-sm flex items-center justify-center gap-1"><MapPin size={14} className="opacity-60" /> Properties</div>
                    <div className="text-2xl font-bold">{subJobs.length}</div>
                  </div>
                  {!isCrewMode && (
                  <div className="bg-base-300 rounded-lg p-3 text-center">
                    <div className="text-base-content/60 text-sm flex items-center justify-center gap-1"><DollarSign size={14} className="opacity-60" /> Total Owed</div>
                    <div className="text-2xl font-bold">{formatCurrency(totalOwed)}</div>
                  </div>
                  )}
                </div>
              </div>
            </div>

            {/* Upcoming Services - Next 90 Days */}
            {upcoming.length > 0 && (
              <div className="card bg-base-200">
                <div className="card-body p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Clock size={18} className="text-warning" />
                    <h4 className="font-bold">Upcoming — Next 90 Days</h4>
                    <span className="badge badge-warning badge-sm">{upcoming.length}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="table table-sm w-full">
                      <thead>
                        <tr>
                          <th>Due</th>
                          <th>Property</th>
                          <th>Service</th>
                        </tr>
                      </thead>
                      <tbody>
                        {upcoming.map((item, i) => (
                          <tr
                            key={`${item.jobId}-${item.serviceType}-${i}`}
                            className="cursor-pointer hover"
                            onClick={() => onSelectJob(item.jobId)}
                          >
                            <td className="whitespace-nowrap">
                              <div className={`flex items-center gap-1 ${item.daysUntil <= 14 ? 'text-error font-semibold' : item.daysUntil <= 30 ? 'text-warning' : ''}`}>
                                {item.daysUntil <= 14 && <AlertTriangle size={12} />}
                                {formatDate(item.deadline)}
                              </div>
                              <div className="text-xs text-base-content/50">
                                {item.daysUntil === 0 ? 'Today' : item.daysUntil === 1 ? 'Tomorrow' : `${item.daysUntil} days`}
                              </div>
                            </td>
                            <td>
                              <div className="font-medium">{item.propertyName}</div>
                            </td>
                            <td>
                              <div className="font-medium">{item.serviceType}</div>
                              {item.scheduleDescription && (
                                <div className="text-xs text-base-content/60">{item.scheduleDescription}</div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Full Property List */}
            <div className="card bg-base-200">
              <div className="card-body p-4 space-y-3">
                <h4 className="font-bold">All Properties</h4>
                {subJobs.length === 0 ? (
                  <p className="text-base-content/60 text-sm">No active properties assigned.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table table-sm w-full">
                      <thead>
                        <tr>
                          <th>Property</th>
                          {!isCrewMode && <th>Pay</th>}
                          <th>Services & Schedule</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subJobs.map(job => {
                          const jobServices = allServices.filter(s => s.job_id === job.id);
                          const pay = calcJobSubCost(job.id, allServices);
                          const routineSvcs = jobServices.filter(s => (s.total_value ?? 0) > 0 && s.service_type.toLowerCase().includes('routine'));
                          const perVisitPay = routineSvcs.length > 0 ? (routineSvcs[0].sub_per_visit_rate ?? 0) : 0;
                          return (
                            <tr key={job.id} className="cursor-pointer hover" onClick={() => onSelectJob(job.id)}>
                              <td>
                                <div className="font-medium">{job.property_name}</div>
                                <div className="text-xs text-base-content/60">{job.property_address}</div>
                              </td>
                              {!isCrewMode && (
                              <td>
                                <div>{formatCurrency(pay)}</div>
                              </td>
                              )}
                              <td>
                                {jobServices.length === 0 ? (
                                  <span className="text-base-content/60 text-xs">No services</span>
                                ) : (
                                  <div className="space-y-1">
                                    {jobServices.map(svc => (
                                      <div key={svc.id} className="text-xs">
                                        <span className="font-medium">{svc.service_type}</span>
                                        {svc.schedule_description && <span className="text-base-content/60"> — {svc.schedule_description}</span>}
                                        {svc.deadline && (
                                          <span className="text-warning ml-1 inline-flex items-center gap-1">
                                            <Calendar size={10} /> {formatDate(svc.deadline)}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
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
          </div>
        );
      })}
    </div>
  );
};
