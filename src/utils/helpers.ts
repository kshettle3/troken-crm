export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(value));
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'active': return 'badge-success';
    case 'pending': return 'badge-warning';
    case 'completed': return 'badge-info';
    case 'cancelled': return 'badge-error';
    default: return 'badge-ghost';
  }
}

export function calcSubPay(contractValue: number | null, subRatePct: number | null, defaultPct: number = 80): number {
  const val = contractValue ?? 0;
  const pct = subRatePct ?? defaultPct;
  return val * (pct / 100);
}

export function calcMyProfit(contractValue: number | null, subRatePct: number | null, defaultPct: number = 80): number {
  const val = contractValue ?? 0;
  return val - calcSubPay(val, subRatePct, defaultPct);
}
