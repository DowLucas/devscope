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
}

export interface OrgSettings {
  organization_id: string;
  inactive_threshold_days: number;
}
