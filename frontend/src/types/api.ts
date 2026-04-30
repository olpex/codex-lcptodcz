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
  branch_id: string;
  source_row_number: number | null;
  first_name: string;
  last_name: string;
  employment_center: string | null;
  birth_date: string | null;
  contract_number: string | null;
  certificate_number: string | null;
  certificate_issue_date: string | null;
  postal_index: string | null;
  address: string | null;
  passport_series: string | null;
  passport_number: string | null;
  passport_issued_by: string | null;
  passport_issued_date: string | null;
  tax_id: string | null;
  group_code: string | null;
  status: string;
  is_deleted: boolean;
  deleted_at: string | null;
  phone: string | null;
  email: string | null;
  id_document: string | null;
  created_at: string;
  updated_at: string;
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

export interface GroupAuditLog {
  id: number;
  actor_user_id: number | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface GroupTeacherHours {
  teacher_id: number;
  teacher_name: string;
  hours: number;
}

export interface ActiveGroupBetweenDates {
  group_id: number;
  code: string;
  name: string;
  training_start_date: string | null;
  training_end_date: string | null;
  period_start_date: string;
  period_end_date: string;
  total_hours: number;
  teachers: GroupTeacherHours[];
}

export interface Teacher {
  id: number;
  first_name: string;
  last_name: string;
  is_active: boolean;
}

export interface ScheduleSlot {
  id: number;
  group_id: number;
  teacher_id: number;
  subject_id: number;
  room_id: number;
  starts_at: string;
  ends_at: string;
  pair_number?: number | null;
  academic_hours?: number;
  group_code?: string | null;
  group_name?: string | null;
  group_start_date?: string | null;
  group_end_date?: string | null;
  teacher_name?: string | null;
  subject_name?: string | null;
  room_name?: string | null;
}

export interface Workload {
  teacher_id: number;
  row_number: number;
  teacher_name: string;
  total_hours: number;
  annual_load_hours: number;
  remaining_hours: number;
}

export interface TeacherMergeResult {
  target_teacher_id: number;
  teacher_name: string;
  merged_teacher_ids: number[];
  reassigned_slots: number;
  annual_load_hours: number;
}

export interface KPI {
  active_groups: number;
  active_trainees: number;
  facility_load_pct: number;
  training_plan_progress_pct: number;
  forecast_graduation: number;
  forecast_employment: number;
}

export interface AttentionItem {
  key: string;
  title: string;
  count: number;
  severity: "error" | "warning" | "info" | string;
  description: string;
  action_href: string;
}

export interface AttentionSummary {
  generated_at: string;
  total_count: number;
  items: AttentionItem[];
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

export interface JobListItem {
  job_type: "import" | "export";
  job: Job;
  import_source?: string | null;
  report_type?: string | null;
  export_format?: string | null;
  output_document_id?: number | null;
  document_id?: number | null;
  document_file_name?: string | null;
  output_file_name?: string | null;
}

export interface ImportPreviewGroup {
  code: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  lessons: number;
  teachers: number;
  subjects: number;
  total_hours: number;
  already_exists: boolean;
  existing_lessons: number;
}

export interface ImportDuplicatePreview {
  row_number: number | null;
  incoming_name: string;
  contract_number: string | null;
  group_code: string | null;
  existing_id: number;
  existing_name: string;
  match_reason: string | null;
}

export interface ImportPreview {
  filename: string;
  file_type: string;
  import_kind: string;
  rows: number;
  sheet_name: string | null;
  headers: string[];
  default_group_code: string | null;
  default_group_name: string | null;
  new_count: number;
  duplicate_count: number;
  invalid_count: number;
  groups: ImportPreviewGroup[];
  duplicate_preview: ImportDuplicatePreview[];
  preview: Record<string, string>[];
  warnings: string[];
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
