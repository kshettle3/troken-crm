import React from 'react';
import { Plus, DollarSign, Briefcase, TrendingUp, Users, GitBranch, Eye, LogOut } from 'lucide-react';
import { Job, Service } from '../types';
import { formatCurrency, getStatusColor } from '../utils/helpers';

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
  onLogout?: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ jobs, allServices, onSelectJob, onAddJob, onSubOverview, onPipeline, onSubDashboard, onLogout }) => {
  const activeJobs = jobs.filter(j => j.status === 'active');
  const totalContractValue = activeJobs.reduce((sum, j) => sum + (j.total_contract_value ?? 0), 0);
  const totalSubPay = activeJobs.reduce((sum, j) => sum + calcJobSubCost(j.id, allServices), 0);
  const totalProfit = totalContractValue - totalSubPay;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">🌿 Troken LLC</h1>
          <p className="text-xs text-base-content/50">Job Manager</p>
        </div>
        {onLogout && (
          <button className="btn btn-ghost btn-sm text-base-content/60" onClick={onLogout}>
            <LogOut size={14} /> Logout
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card bg-base-200">
          <div className="card-body p-4">
            <div className="flex items-center gap-2 text-base-content/60 text-sm">
              <Briefcase size={16} className="opacity-60" /> Active Jobs
            </div>
            <div className="text-2xl font-bold">{activeJobs.length}</div>
          </div>
        </div>
        <div className="card bg-base-200">
          <div className="card-body p-4">
            <div className="flex items-center gap-2 text-base-content/60 text-sm">
              <DollarSign size={16} className="opacity-60" /> Contract Value
            </div>
            <div className="text-2xl font-bold">{formatCurrency(totalContractValue)}</div>
          </div>
        </div>
        <div className="card bg-base-200">
          <div className="card-body p-4">
            <div className="flex items-center gap-2 text-base-content/60 text-sm">
              <Users size={16} className="opacity-60" /> Sub Costs
            </div>
            <div className="text-2xl font-bold">{formatCurrency(totalSubPay)}</div>
          </div>
        </div>
        <div className="card bg-base-200">
          <div className="card-body p-4">
            <div className="flex items-center gap-2 text-base-content/60 text-sm">
              <TrendingUp size={16} className="opacity-60" /> Your Profit
            </div>
            <div className="text-2xl font-bold text-success">{formatCurrency(totalProfit)}</div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button className="btn btn-primary btn-sm" onClick={onAddJob}>
          <Plus size={16} /> Add Job
        </button>
        <button className="btn btn-secondary btn-sm btn-outline" onClick={onSubOverview}>
          <Users size={16} /> Sub Overview
        </button>
        <button className="btn btn-accent btn-sm btn-outline" onClick={onPipeline}>
          <GitBranch size={16} /> Pipeline
        </button>
        <button className="btn btn-warning btn-sm btn-outline" onClick={onSubDashboard}>
          <Eye size={16} /> View as Sub
        </button>
      </div>

      {/* Jobs table */}
      <div className="overflow-x-auto">
        <table className="table table-zebra w-full">
          <thead>
            <tr>
              <th>Property</th>
              <th>Client</th>
              <th>Contract Value</th>
              <th>Sub</th>
              <th>Your Profit</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr><td colSpan={6} className="text-center text-base-content/60 py-8">No jobs yet — add your first contract!</td></tr>
            )}
            {jobs.map(job => (
              <tr key={job.id} className="cursor-pointer hover" onClick={() => onSelectJob(job.id)}>
                <td>
                  <div className="font-medium">{job.property_name}</div>
                  <div className="text-xs text-base-content/60">{job.property_address}</div>
                </td>
                <td>{job.client_name}{job.store_number ? ` (#${job.store_number})` : ''}</td>
                <td>{formatCurrency(job.total_contract_value)}</td>
                <td>{job.sub_name ?? '—'}</td>
                <td className="text-success">{formatCurrency((job.total_contract_value ?? 0) - calcJobSubCost(job.id, allServices))}</td>
                <td><span className={`badge badge-sm ${getStatusColor(job.status)}`}>{job.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
