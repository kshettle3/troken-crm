export interface Sub {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  default_rate_pct: number;
  notes: string | null;
}

export interface Job {
  id: number;
  property_name: string;
  property_address: string | null;
  client_name: string | null;
  store_number: string | null;
  agreement_number: string | null;
  contract_start: string | null;
  contract_end: string | null;
  total_contract_value: number | null;
  sub_id: number | null;
  sub_rate_pct: number | null;
  metro: string | null;
  status: string;
  notes: string | null;
  contract_type: string | null;
  created_at: string | null;
  // joined fields
  sub_name?: string;
}

export interface Service {
  id: number;
  job_id: number;
  service_type: string;
  total_value: number | null;
  total_visits: number | null;
  per_visit_rate: number | null;
  sub_per_visit_rate: number | null;
  sub_rate_pct: number | null;
  schedule_description: string | null;
  deadline: string | null;
  notes: string | null;
}

export interface Note {
  id: number;
  job_id: number;
  note_type: 'internal' | 'shared' | 'contractor';
  content: string;
  created_at: string;
}

export interface Contact {
  id: number;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  job_id: number | null;
  created_at: string;
}

export interface PipelineJob {
  id: number;
  property_name: string;
  property_address: string | null;
  client_name: string | null;
  deadline: string | null;
  work_type: 'contract' | 'one_time';
  stage: 'quote' | 'bid' | 'active';
  sub_id: number | null;
  billing_to: string | null;
  quote_format: string;
  scope_notes: string | null;
  sub_quote_total: number | null;
  sub_quote_submitted_at: string | null;
  sub_quote_notes: string | null;
  our_bid_total: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // joined
  sub_name?: string;
}

export interface QuoteLineItem {
  id: number;
  pipeline_job_id: number;
  category: 'time' | 'material' | 'equipment' | 'trip_charge' | 'miscellaneous';
  description: string | null;
  amount: number;
}

export interface ServiceCompletion {
  id: number;
  service_id: number;
  job_id: number;
  visit_id: number | null;
  completed_at: string;
  created_at: string;
}

export interface CalendarVisit {
  id: number;
  job_id: number;
  scheduled_date: string;
  checked_in: number;
  checked_in_at: string | null;
  unlocked: number;
  week_start: string;
  created_at: string;
  // joined
  property_name?: string;
  metro?: string;
  client_name?: string;
}

export interface SubPayment {
  id: number;
  sub_id: number;
  period_month: string;
  total_amount: number;
  visit_count: number;
  status: 'pending' | 'paid';
  paid_date: string | null;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
}

export type View = 'role-select' | 'owner-login' | 'sub-login' | 'sub-portal' | 'dashboard' | 'job-detail' | 'add-job' | 'edit-job' | 'sub-overview' | 'sub-dashboard' | 'pipeline' | 'pipeline-detail' | 'pipeline-new' | 'pipeline-edit' | 'sub-payments';
