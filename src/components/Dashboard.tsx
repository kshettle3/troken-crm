import React, { useState } from 'react';
import { Plus, DollarSign, Briefcase, TrendingUp, Users, GitBranch, Eye, LogOut, BarChart2 } from 'lucide-react';
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
  onPayments: () => void;
  onLogout?: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ jobs, allServices, onSelectJob, onAddJob, onSubOverview, onPipeline, onSubDashboard, onPayments, onLogout }) => {
  const [activeTab, setActiveTab] = useState<'jobs' | 'financials'>('jobs');

  const activeJobs = jobs.filter(j => j.status === 'active');
  const totalContractValue = activeJobs.reduce((sum, j) => sum + (j.total_contract_value ?? 0), 0);
  const totalSubPay = activeJobs.reduce((sum, j) => sum + calcJobSubCost(j.id, allServices), 0);
  const totalProfit = totalContractValue - totalSubPay;
  const profitMargin = totalContractValue > 0 ? Math.round((totalProfit / totalContractValue) * 100) : 0;

  // Group by client for financials breakdown
  const clientBreakdown = activeJobs.reduce<Record<string, { value: number; subCost: number; count: number }>>((acc, job) => {
    const client = job.client_name ?? 'Unknown';
    if (!acc[client]) acc[client] = { value: 0, subCost: 0, count: 0 };
    acc[client].value += job.total_contract_value ?? 0;
    acc[client].subCost += calcJobSubCost(job.id, allServices);
    acc[client].count += 1;
    return acc;
  }, {});

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">🌿 Troken LLC</h1>
          <p className="text-xs text-base-content/50">Job Manager</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="badge badge-lg badge-neutral">{activeJobs.length} Active Jobs</div>
          {onLogout && (
            <button className="btn btn-ghost btn-sm text-base-content/60" onClick={onLogout}>
              <LogOut size={14} /> Logout
            </button>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
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
        <button className="btn btn-info btn-sm btn-outline" onClick={onPayments}>
          💰 Payments
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="tabs tabs-boxed bg-base-200">
        <button
          className={`tab flex-1 ${activeTab === 'jobs' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('jobs')}
        >
          <Briefcase size={14} className="mr-1" /> Jobs
        </button>
        <button
          className={`tab flex-1 ${activeTab === 'financials' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('financials')}
        >
          <BarChart2 size={14} className="mr-1" /> Financials
        </button>
      </div>

      {/* Jobs Tab */}
      {activeTab === 'jobs' && (
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
                <tr><td colSpan={3} className="text-center text-base-content/60 py-8">No jobs yet — add your first contract!</td></tr>
              )}
              {jobs.map(job => (
                <tr key={job.id} className="cursor-pointer hover" onClick={() => onSelectJob(job.id)}>
                  <td>
                    <div className="font-medium">{job.property_name}</div>
                    <div className="text-xs text-base-content/60">{job.property_address}</div>
                  </td>
                  <td>{job.client_name}{job.store_number ? ` (#${job.store_number})` : ''}</td>
                  <td><span className={`badge badge-sm ${getStatusColor(job.status)}`}>{job.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Financials Tab */}
      {activeTab === 'financials' && (
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

          {/* By Client Breakdown */}
          <div>
            <h3 className="font-semibold text-sm text-base-content/60 uppercase tracking-wide mb-2">By Client</h3>
            <div className="space-y-2">
              {Object.entries(clientBreakdown)
                .sort(([_ka, a],[_kb, b]) => b.value - a.value)
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
