export type PendingSeverity = 'urgent' | 'warning' | 'info';

export type MonthlyReportPendingStatus =
  'missing' | 'draft' | 'generated' | 'rejected';

export interface PendingMembershipRequestsItem {
  type: 'membership_requests';
  count: number;
  severity: PendingSeverity;
}

export interface PendingEvidenceFolderItem {
  type: 'evidence_folder';
  count: number;
  rejected_count: number;
  not_submitted_count: number;
  severity: PendingSeverity;
}

export interface PendingMonthlyReportItem {
  type: 'monthly_report';
  count: number;
  period_month: number;
  period_year: number;
  report_status: MonthlyReportPendingStatus;
  /** YYYY-MM-DD */
  due_date: string;
  /** Calendar days from today (America/Mexico_City) to due_date; negative when overdue. */
  days_left: number;
  severity: PendingSeverity;
}

export interface PendingInvestitureAuthorizationsItem {
  type: 'investiture_authorizations';
  count: number;
  severity: PendingSeverity;
}

export interface PendingUninsuredMembersItem {
  type: 'uninsured_members';
  /** Section members and staff without insurance this ecclesiastical year. */
  count: number;
  /** YYYY-MM-DD: the cycle's purchase_deadline. */
  due_date: string;
  /** Calendar days from today (America/Mexico_City) to due_date; negative once past. */
  days_left: number;
  /** warning until the deadline (inclusive), urgent after. */
  severity: PendingSeverity;
}

export interface PendingFreeInsuranceItem {
  type: 'free_insurance';
  /** Active coverages of the section whose holder left the club (reassignable). */
  count: number;
  severity: PendingSeverity;
}

export type DashboardPendingItem =
  | PendingMembershipRequestsItem
  | PendingEvidenceFolderItem
  | PendingMonthlyReportItem
  | PendingInvestitureAuthorizationsItem
  | PendingUninsuredMembersItem
  | PendingFreeInsuranceItem;

export interface DashboardPendingDto {
  section_id: number | null;
  generated_at: string;
  total: number;
  urgent: number;
  items: DashboardPendingItem[];
}
