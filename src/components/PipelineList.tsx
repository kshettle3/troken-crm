import React, { useState, useEffect } from 'react';
import { PipelineJob, Sub } from '../types';
import { db } from '../db'

interface Props {
  onBack: () => void;
  onSelect: (id: number) => void;
  onNew: () => void;
}

const stageBadge: Record<string, string> = {
  quote: 'badge-warning',
  bid: 'badge-info',
  active: 'badge-success',
};
const stageLabel: Record<string, string> = {
  quote: 'Quote',
  bid: 'Bid',
  active: 'Active',
};
const typeLabel: Record<string, string> = {
  contract: 'Contract',
  one_time: 'One-Time',
};

export const PipelineList: React.FC<Props> = ({ onBack, onSelect, onNew }) => {
  const [items, setItems] = useState<PipelineJob[]>([]);
  const [filter, setFilter] = useState<'all' | 'quote' | 'bid' | 'active'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const rows = await db.query(
        `SELECT p.*, s.name as sub_name FROM pipeline_jobs p LEFT JOIN subs s ON p.sub_id = s.id ORDER BY p.created_at DESC`
      );
      setItems(rows as unknown as PipelineJob[]);
      setLoading(false);
    })();
  }, []);

  const filtered = filter === 'all' ? items : items.filter(i => i.stage === filter);

  const counts = {
    all: items.length,
    quote: items.filter(i => i.stage === 'quote').length,
    bid: items.filter(i => i.stage === 'bid').length,
    active: items.filter(i => i.stage === 'active').length,
  };

  if (loading) return <div className="flex justify-center p-12"><span className="loading loading-spinner loading-lg text-primary" /></div>;

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
          <h1 className="text-2xl font-bold">Job Pipeline</h1>
        </div>
        <button className="btn btn-primary btn-sm" onClick={onNew}>+ New Quote</button>
      </div>

      {/* Stage filter tabs */}
      <div className="tabs tabs-boxed mb-4 bg-base-200">
        {(['all', 'quote', 'bid', 'active'] as const).map(s => (
          <a
            key={s}
            className={`tab ${filter === s ? 'tab-active' : ''}`}
            onClick={() => setFilter(s)}
          >
            {s === 'all' ? 'All' : stageLabel[s]} ({counts[s]})
          </a>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-base-content/60">
          <p className="text-lg mb-2">No {filter === 'all' ? '' : stageLabel[filter].toLowerCase() + ' '}jobs yet</p>
          <p>Click "+ New Quote" to get started</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-zebra w-full">
            <thead>
              <tr>
                <th>Property</th>
                <th>Client</th>
                <th>Type</th>
                <th>Stage</th>
                <th>Deadline</th>
                <th>Sub Quote</th>
                <th>Our Bid</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <tr key={item.id} className="hover cursor-pointer" onClick={() => onSelect(item.id)}>
                  <td>
                    <div className="font-medium">{item.property_name}</div>
                    {item.property_address && <div className="text-xs text-base-content/60">{item.property_address}</div>}
                  </td>
                  <td>{item.client_name || '—'}</td>
                  <td><span className="badge badge-ghost badge-sm">{typeLabel[item.work_type]}</span></td>
                  <td><span className={`badge ${stageBadge[item.stage]} badge-sm`}>{stageLabel[item.stage]}</span></td>
                  <td>{item.deadline || '—'}</td>
                  <td>{item.sub_quote_total != null ? `$${Math.round(item.sub_quote_total).toLocaleString()}` : '—'}</td>
                  <td>{item.our_bid_total != null ? `$${Math.round(item.our_bid_total).toLocaleString()}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
