import { Service } from '../types';

// Month name to number mapping
const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

// Parse month range like "Apr-Oct" or "Mar, Nov-Dec" into array of month numbers
function parseMonths(monthStr: string): number[] {
  const months: number[] = [];
  const parts = monthStr.split(',').map(s => s.trim().toLowerCase());
  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-').map(s => s.trim());
      const start = MONTH_MAP[startStr.substring(0, 3)];
      const end = MONTH_MAP[endStr.substring(0, 3)];
      if (start && end) {
        if (start <= end) {
          for (let m = start; m <= end; m++) months.push(m);
        } else {
          // Wrap around: Nov-Feb = 11,12,1,2
          for (let m = start; m <= 12; m++) months.push(m);
          for (let m = 1; m <= end; m++) months.push(m);
        }
      }
    } else {
      const m = MONTH_MAP[part.substring(0, 3)];
      if (m) months.push(m);
    }
  }
  return months;
}

export type FrequencyType = 'weekly' | 'bi_weekly' | '3x_month' | '4x_month' | 'monthly' | 'as_needed' | 'none';

// Parse a schedule description to extract frequency and applicable months
function parseSchedule(desc: string): { frequency: FrequencyType; months: number[] } | null {
  if (!desc) return null;
  const lower = desc.toLowerCase();
  
  // Extract month range from parentheses
  const monthMatch = desc.match(/\(([^)]+)\)/);
  const months = monthMatch ? parseMonths(monthMatch[1]) : [];
  
  let frequency: FrequencyType = 'none';
  
  if (lower.includes('per week') || lower.includes('1 time per week') || lower.includes('1 times per week')) {
    frequency = 'weekly';
  } else if (lower.includes('every two weeks') || lower.includes('every 2 weeks') || lower.includes('bi-weekly') || lower.includes('biweekly')) {
    frequency = 'bi_weekly';
  } else if (lower.includes('3 times per month') || lower.includes('3 time per month')) {
    frequency = '3x_month';
  } else if (lower.includes('4 times per month') || lower.includes('4 time per month')) {
    frequency = '4x_month';
  } else if (lower.includes('per month') || lower.includes('1 times per month') || lower.includes('1 time per month')) {
    frequency = 'monthly';
  } else if (lower.includes('as needed')) {
    frequency = 'as_needed';
  }
  
  return { frequency, months };
}

// Get the current active frequency for a job based on its routine services and the given month
export function getActiveFrequency(services: Service[], month: number): FrequencyType {
  // Filter to routine services only
  const routineServices = services.filter(s => 
    s.service_type.toLowerCase().includes('routine') || 
    s.service_type.toLowerCase().includes('non-mow routine')
  );
  
  for (const svc of routineServices) {
    if (!svc.schedule_description) continue;
    const parsed = parseSchedule(svc.schedule_description);
    if (!parsed) continue;
    if (parsed.months.includes(month) && parsed.frequency !== 'none') {
      return parsed.frequency;
    }
  }
  return 'none';
}

// Get countdown days until next visit based on frequency
export function getCountdownDays(frequency: FrequencyType, currentMonth: number): number {
  switch (frequency) {
    case 'weekly': return 7;
    case '4x_month': return 7;
    case 'bi_weekly': return 14;
    case '3x_month': {
      // Roughly every 10 days - divide month days by 3
      const daysInMonth = new Date(2026, currentMonth, 0).getDate();
      return Math.floor(daysInMonth / 3);
    }
    case 'monthly': return 30;
    case 'as_needed': return 30;
    default: return 0;
  }
}

// Get frequency display label
export function getFrequencyLabel(freq: FrequencyType): string {
  switch (freq) {
    case 'weekly': return 'Weekly';
    case 'bi_weekly': return 'Bi-Weekly';
    case '3x_month': return '3x/Month';
    case '4x_month': return '4x/Month';
    case 'monthly': return 'Monthly';
    case 'as_needed': return 'As Needed';
    default: return '';
  }
}

// Get the DMG week start (Sunday) for a given date
export function getDMGWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - day);
  return d;
}

// Get Monday-Saturday date range for a DMG week (TC works Mon-Sat)
export function getWeekDays(weekStart: Date): Date[] {
  const days: Date[] = [];
  for (let i = 1; i <= 6; i++) { // Mon(1) through Sat(6)
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

// Format date as YYYY-MM-DD
export function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

// Format date for display
export function formatDayLabel(d: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

// Check if a property is Lowe's (Friday deadline)
export function isLowes(clientName: string | null): boolean {
  return clientName?.toLowerCase().includes("lowe") ?? false;
}
