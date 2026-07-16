export type OperationsDashboardScopeLevel =
  | 'all'
  | 'division'
  | 'union'
  | 'local_field';

export type OperationsDashboardChildLevel =
  | 'division'
  | 'union'
  | 'local_field'
  | 'club';

export type OperationsDashboardScopePathNode = {
  level: Exclude<OperationsDashboardScopeLevel, 'all'>;
  id: number;
  name: string;
};

export type ResolvedOperationsDashboardScope = {
  level: OperationsDashboardScopeLevel;
  id: number | null;
  name: string;
  path: OperationsDashboardScopePathNode[];
};

export type OperationsDashboardScopeFilters = {
  divisionId?: number;
  unionId?: number;
  localFieldId?: number;
};

export type EcclesiasticalYearRecord = {
  year_id: number;
  start_date: Date;
  end_date: Date;
  active: boolean;
};

export type ReportingMonth = { year: number; month: number };

export type DashboardBucketRow = { bucket_id: number | null };

export type AdministrativeMetricRow = DashboardBucketRow & {
  total: number;
  active: number;
  inactive: number;
};

export type OperationsMetricRow = DashboardBucketRow & {
  operational_clubs: number;
  operational_sections: number;
};

export type PeopleMetricRow = DashboardBucketRow & {
  institutionally_active: number;
  platform_active: number;
  platform_inactive: number;
};

export type ClassMetricRow = DashboardBucketRow & {
  class_id: number | null;
  class_name: string | null;
  club_type_id: number | null;
  club_type_name: string | null;
  display_order: number | null;
  enrollment_count: number;
  distinct_people: number;
};

export type MonthlyReportsMetricRow = DashboardBucketRow & {
  expected_sections: number;
  submitted_sections: number;
  draft_sections: number;
  generated_sections: number;
  missing_sections: number;
};

export type HonorsMetricRow = DashboardBucketRow & {
  in_progress: number;
  pending_review: number;
  approved: number;
};

export type ActivitiesMetricRow = DashboardBucketRow & {
  registered: number;
  joint_registered: number;
  distinct_participating_sections: number;
};

export type QueuesMetricRow = DashboardBucketRow & {
  role_assignments_pending: number;
  transfers_pending: number;
  class_validations_pending: number;
  honors_review_pending: number | null;
  annual_folders_pending_union: number;
};

export type DashboardChildNode = { id: number; name: string };

export type OperationsDashboardRawSnapshot = {
  children: DashboardChildNode[];
  administrative: AdministrativeMetricRow[];
  operations: OperationsMetricRow[];
  people: PeopleMetricRow[];
  classes: ClassMetricRow[];
  monthlyReports: MonthlyReportsMetricRow[];
  honors: HonorsMetricRow[];
  activities: ActivitiesMetricRow[];
  queues: QueuesMetricRow[];
};

export function getOperationsDashboardChildLevel(
  scopeLevel: OperationsDashboardScopeLevel,
): OperationsDashboardChildLevel {
  switch (scopeLevel) {
    case 'all':
      return 'division';
    case 'division':
      return 'union';
    case 'union':
      return 'local_field';
    case 'local_field':
      return 'club';
  }
}
