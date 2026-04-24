export type RoleName = "admin" | "methodist" | "teacher";

export interface Role {
  id: number;
  name: RoleName;
}

export interface User {
  id: number;
  username: string;
  full_name: string;
  branch_id: string;
  roles: Role[];
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
}

export interface Trainee {
  id: number;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  status: string;
  phone: string | null;
  email: string | null;
  id_document: string | null;
}

export interface Group {
  id: number;
  code: string;
  name: string;
  capacity: number;
  status: string;
  start_date: string | null;
  end_date: string | null;
}

export interface ScheduleSlot {
  id: number;
  group_id: number;
  teacher_id: number;
  subject_id: number;
  room_id: number;
  starts_at: string;
  ends_at: string;
}

export interface Workload {
  teacher_id: number;
  teacher_name: string;
  total_hours: number;
  amount_uah: number;
}

export interface KPI {
  active_groups: number;
  active_trainees: number;
  facility_load_pct: number;
  training_plan_progress_pct: number;
  forecast_graduation: number;
  forecast_employment: number;
}

export interface Job {
  id: number;
  status: "queued" | "running" | "succeeded" | "failed";
  message: string | null;
  result_payload: Record<string, unknown> | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Draft {
  id: number;
  document_id: number;
  draft_type: string;
  status: "pending" | "approved" | "rejected";
  confidence: number;
  extracted_text: string;
  structured_payload: Record<string, unknown> | null;
}

export interface MailMessage {
  id: number;
  sender: string;
  subject: string;
  received_at: string;
  snippet: string | null;
  status: string;
}

export interface Order {
  id: number;
  order_number: string;
  order_type: "enrollment" | "expulsion" | "internal";
  order_date: string;
  status: string;
  payload_json: Record<string, unknown> | null;
  created_by: number | null;
  created_at: string;
}

export interface Performance {
  id: number;
  branch_id: string;
  trainee_id: number;
  group_id: number;
  progress_pct: number;
  attendance_pct: number;
  employment_flag: boolean;
  created_at: string;
  updated_at: string;
}
