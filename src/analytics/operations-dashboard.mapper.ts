import type {
  ActivitiesMetricsDto,
  AdministrativeClubsMetricsDto,
  ClassesMetricsDto,
  HonorsMetricsDto,
  MonthlyReportsMetricsDto,
  OperationsDashboardChildDto,
  OperationsDashboardDataQualityDto,
  OperationsDashboardDto,
  OperationsMetricsDto,
  PeopleMetricsDto,
  QueuesMetricsDto,
} from './dto/operations-dashboard.dto';
import {
  getOperationsDashboardChildLevel,
  type EcclesiasticalYearRecord,
  type OperationsDashboardRawSnapshot,
  type ReportingMonth,
  type ResolvedOperationsDashboardScope,
} from './operations-dashboard.types';

type MapOperationsDashboardInput = {
  raw: OperationsDashboardRawSnapshot;
  scope: ResolvedOperationsDashboardScope;
  ecclesiasticalYear: EcclesiasticalYearRecord;
  reportingMonth: ReportingMonth | null;
  computedAt: Date;
  honorsAvailable: boolean;
};

const EMPTY_ADMINISTRATIVE: AdministrativeClubsMetricsDto = {
  total: 0,
  active: 0,
  inactive: 0,
};

const EMPTY_OPERATIONS_ROW = {
  operational_clubs: 0,
  operational_sections: 0,
};

const EMPTY_PEOPLE: PeopleMetricsDto = {
  institutionally_active: 0,
  platform_accounts: { active: 0, inactive: 0 },
};

const EMPTY_MONTHLY_REPORTS_ROW = {
  expected_sections: 0,
  submitted_sections: 0,
  draft_sections: 0,
  generated_sections: 0,
  missing_sections: 0,
};

const EMPTY_ACTIVITIES: ActivitiesMetricsDto = {
  registered: 0,
  joint_registered: 0,
  distinct_participating_sections: 0,
};

const EMPTY_QUEUES: QueuesMetricsDto = {
  role_assignments_pending: 0,
  transfers_pending: 0,
  class_validations_pending: 0,
  honors_review_pending: 0,
  annual_folders_pending_union: 0,
};

export function mapOperationsDashboard({
  raw,
  scope,
  ecclesiasticalYear,
  reportingMonth,
  computedAt,
  honorsAvailable,
}: MapOperationsDashboardInput): OperationsDashboardDto {
  const totalBucketId = null;
  const administrative = mapAdministrative(raw, totalBucketId);

  return {
    meta: {
      computed_at: computedAt.toISOString(),
      cached: false,
      cache_ttl_seconds: 60,
      definitions_version: '1',
      scope,
      period: {
        ecclesiastical_year: {
          id: ecclesiasticalYear.year_id,
          start_date: toDateOnly(ecclesiasticalYear.start_date),
          end_date: toDateOnly(ecclesiasticalYear.end_date),
          active: ecclesiasticalYear.active,
        },
        reporting_month: reportingMonth,
      },
    },
    summary: {
      administrative_clubs: administrative,
      operations: mapOperations(raw, totalBucketId, administrative.total),
      people: mapPeople(raw, totalBucketId),
      classes: mapClasses(raw, totalBucketId),
      monthly_reports: mapMonthlyReports(raw, totalBucketId),
      honors: mapHonors(raw, totalBucketId, honorsAvailable),
      activities: mapActivities(raw, totalBucketId),
      queues: mapQueues(raw, totalBucketId, honorsAvailable),
    },
    children: mapChildren(raw, scope, honorsAvailable),
    data_quality: buildDataQuality(
      ecclesiasticalYear.active,
      honorsAvailable,
      reportingMonth !== null,
    ),
  };
}

function mapChildren(
  raw: OperationsDashboardRawSnapshot,
  scope: ResolvedOperationsDashboardScope,
  honorsAvailable: boolean,
): OperationsDashboardChildDto[] {
  const childLevel = getOperationsDashboardChildLevel(scope.level);

  return raw.children.map((child) => {
    const administrative = mapAdministrative(raw, child.id);
    return {
      id: child.id,
      name: child.name,
      level: childLevel,
      administrative_clubs: administrative,
      operations: mapOperations(raw, child.id, administrative.total),
      people: mapPeople(raw, child.id),
      classes: mapClasses(raw, child.id),
      monthly_reports: mapMonthlyReports(raw, child.id),
      honors: mapHonors(raw, child.id, honorsAvailable),
      activities: mapActivities(raw, child.id),
      queues: mapQueues(raw, child.id, honorsAvailable),
    };
  });
}

function mapAdministrative(
  raw: OperationsDashboardRawSnapshot,
  bucketId: number | null,
): AdministrativeClubsMetricsDto {
  const row = raw.administrative.find(
    (candidate) => candidate.bucket_id === bucketId,
  );
  if (!row) return { ...EMPTY_ADMINISTRATIVE };
  return { total: row.total, active: row.active, inactive: row.inactive };
}

function mapOperations(
  raw: OperationsDashboardRawSnapshot,
  bucketId: number | null,
  administrativeClubs: number,
): OperationsMetricsDto {
  const row =
    raw.operations.find((candidate) => candidate.bucket_id === bucketId) ??
    EMPTY_OPERATIONS_ROW;

  return {
    operational_clubs: row.operational_clubs,
    non_operational_clubs: Math.max(
      administrativeClubs - row.operational_clubs,
      0,
    ),
    operational_sections: row.operational_sections,
    operational_rate_pct: percentage(
      row.operational_clubs,
      administrativeClubs,
      null,
    ),
  };
}

function mapPeople(
  raw: OperationsDashboardRawSnapshot,
  bucketId: number | null,
): PeopleMetricsDto {
  const row = raw.people.find((candidate) => candidate.bucket_id === bucketId);
  if (!row) {
    return {
      institutionally_active: EMPTY_PEOPLE.institutionally_active,
      platform_accounts: { ...EMPTY_PEOPLE.platform_accounts },
    };
  }

  return {
    institutionally_active: row.institutionally_active,
    platform_accounts: {
      active: row.platform_active,
      inactive: row.platform_inactive,
    },
  };
}

function mapClasses(
  raw: OperationsDashboardRawSnapshot,
  bucketId: number | null,
): ClassesMetricsDto {
  const total = raw.classes.find(
    (candidate) =>
      candidate.bucket_id === bucketId && candidate.class_id === null,
  );

  const byClass = raw.classes
    .filter(
      (candidate) =>
        candidate.bucket_id === bucketId && candidate.class_id !== null,
    )
    .map((row) => ({
      class_id: row.class_id as number,
      class_name: row.class_name ?? '',
      club_type_id: row.club_type_id as number,
      club_type_name: row.club_type_name ?? '',
      display_order: row.display_order ?? 0,
      enrollment_count: row.enrollment_count,
    }))
    .sort(
      (left, right) =>
        left.club_type_id - right.club_type_id ||
        left.display_order - right.display_order ||
        left.class_name.localeCompare(right.class_name) ||
        left.class_id - right.class_id,
    );

  return {
    total_enrollments: total?.enrollment_count ?? 0,
    distinct_people: total?.distinct_people ?? 0,
    by_class: byClass,
  };
}

function mapMonthlyReports(
  raw: OperationsDashboardRawSnapshot,
  bucketId: number | null,
): MonthlyReportsMetricsDto {
  const row =
    raw.monthlyReports.find((candidate) => candidate.bucket_id === bucketId) ??
    EMPTY_MONTHLY_REPORTS_ROW;

  return {
    expected_sections: row.expected_sections,
    submitted_sections: row.submitted_sections,
    draft_sections: row.draft_sections,
    generated_sections: row.generated_sections,
    missing_sections: row.missing_sections,
    coverage_pct: percentage(
      row.submitted_sections,
      row.expected_sections,
      null,
    ),
  };
}

function mapHonors(
  raw: OperationsDashboardRawSnapshot,
  bucketId: number | null,
  available: boolean,
): HonorsMetricsDto {
  if (!available) {
    return {
      in_progress: null,
      pending_review: null,
      approved: null,
      attribution: 'unavailable',
    };
  }

  const row = raw.honors.find((candidate) => candidate.bucket_id === bucketId);
  return {
    in_progress: row?.in_progress ?? 0,
    pending_review: row?.pending_review ?? 0,
    approved: row?.approved ?? 0,
    attribution: 'current_affiliation',
  };
}

function mapActivities(
  raw: OperationsDashboardRawSnapshot,
  bucketId: number | null,
): ActivitiesMetricsDto {
  const row = raw.activities.find(
    (candidate) => candidate.bucket_id === bucketId,
  );
  return row
    ? {
        registered: row.registered,
        joint_registered: row.joint_registered,
        distinct_participating_sections: row.distinct_participating_sections,
      }
    : { ...EMPTY_ACTIVITIES };
}

function mapQueues(
  raw: OperationsDashboardRawSnapshot,
  bucketId: number | null,
  honorsAvailable: boolean,
): QueuesMetricsDto {
  const row = raw.queues.find((candidate) => candidate.bucket_id === bucketId);
  return {
    role_assignments_pending:
      row?.role_assignments_pending ?? EMPTY_QUEUES.role_assignments_pending,
    transfers_pending: row?.transfers_pending ?? EMPTY_QUEUES.transfers_pending,
    class_validations_pending:
      row?.class_validations_pending ?? EMPTY_QUEUES.class_validations_pending,
    honors_review_pending: honorsAvailable
      ? (row?.honors_review_pending ?? EMPTY_QUEUES.honors_review_pending)
      : null,
    annual_folders_pending_union:
      row?.annual_folders_pending_union ??
      EMPTY_QUEUES.annual_folders_pending_union,
  };
}

function buildDataQuality(
  activeEcclesiasticalYear: boolean,
  honorsAvailable: boolean,
  reportingMonthAvailable: boolean,
): OperationsDashboardDataQualityDto[] {
  return [
    {
      metric: 'administrative_clubs',
      status: 'exact',
      note: 'Estado administrativo basado en clubs.active.',
    },
    {
      metric: 'operations',
      status: 'exact',
      note: activeEcclesiasticalYear
        ? 'Operación basada en matrícula anual activa; no usa flags administrativos.'
        : 'Año histórico: incluye secciones con matrícula activa o cerrada que operaron durante ese año; no usa flags administrativos.',
    },
    {
      metric: 'people',
      status: 'exact',
      note: 'Personas distintas con asignación institucional activa en el año.',
    },
    {
      metric: 'classes',
      status: 'current_affiliation',
      note: 'Territorio inferido desde afiliaciones institucionales actuales del mismo año; padres y filas hijas no son aditivos.',
    },
    {
      metric: 'monthly_reports',
      status: reportingMonthAvailable ? 'exact' : 'not_applicable',
      note: reportingMonthAvailable
        ? activeEcclesiasticalYear
          ? 'Cobertura calculada sobre secciones con matrícula anual activa.'
          : 'Cobertura histórica calculada sobre secciones que operaron en el año (matrícula activa o cerrada).'
        : 'El año eclesiástico todavía no tiene un mes cerrado; los conteos son 0 y la cobertura no aplica.',
    },
    {
      metric: 'honors',
      status: honorsAvailable ? 'current_affiliation' : 'unavailable',
      note: honorsAvailable
        ? 'Territorio inferido desde la afiliación institucional actual.'
        : 'users_honors no conserva año ni territorio histórico.',
    },
    {
      metric: 'activities',
      status: 'exact',
      note: activeEcclesiasticalYear
        ? 'Cuenta registros de secciones con matrícula activa, incluidas actividades conjuntas sin doble conteo; no implica ejecución.'
        : 'Cuenta registros de secciones que operaron en el año (matrícula activa o cerrada), incluidas actividades conjuntas; no implica ejecución.',
    },
    {
      metric: 'queues',
      status: 'current_affiliation',
      note: honorsAvailable
        ? 'Las colas de clases y especialidades se atribuyen por afiliación actual.'
        : 'Las colas se atribuyen por afiliación actual; honors_review_pending no aplica a años históricos y se devuelve null.',
    },
  ];
}

function percentage(
  numerator: number,
  denominator: number,
  emptyValue: number,
): number;
function percentage(
  numerator: number,
  denominator: number,
  emptyValue: null,
): number | null;
function percentage(
  numerator: number,
  denominator: number,
  emptyValue: number | null,
): number | null {
  if (denominator === 0) return emptyValue;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}
