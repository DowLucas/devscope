export type OrgRole = "owner" | "admin" | "member";

export interface OrgMemberStatus {
  developer_id: string;
  developer_name: string;
  developer_email: string;
  auth_user_id: string | null;
  has_dashboard_account: boolean;
  onboarding_complete: boolean;
  has_active_api_key: boolean;
  last_activity: string | null;
  is_inactive: boolean;
  total_sessions: number;
  total_events: number;
  role: OrgRole;
  linked_email_count?: number;
}

export interface OrgSettings {
  organization_id: string;
  inactive_threshold_days: number;
  retention_days: number;
  anonymize_on_expire: boolean;
}

// --- Ethics Audit ---

export type EthicsEventType =
  | "sensitive_fields_stripped"
  | "ai_individual_reference_blocked"
  | "privacy_mode_activated"
  | "data_request_processed"
  | "retention_purge_executed";

export interface EthicsAuditEntry {
  id: string;
  organization_id: string | null;
  event_type: EthicsEventType;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface EthicsAuditSummary {
  event_type: EthicsEventType;
  count: number;
  last_occurred: string | null;
}

// --- Consent Dashboard ---

export interface ConsentOverview {
  total_developers: number;
  sharing_details: number;
  privacy_mode_count: number;
  data_categories: DataCategory[];
}

export interface DataCategory {
  name: string;
  description: string;
  collected: boolean;
  opt_in_required: boolean;
}

export interface DataRequest {
  id: string;
  developer_id: string;
  developer_name?: string;
  organization_id: string;
  request_type: "export" | "deletion";
  status: "pending" | "processing" | "completed" | "rejected";
  requested_at: string;
  completed_at: string | null;
  handled_by: string | null;
  notes: string | null;
}
