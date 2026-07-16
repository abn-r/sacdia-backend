import { mapOperationsDashboard } from './operations-dashboard.mapper';
import type {
  OperationsDashboardRawSnapshot,
  ResolvedOperationsDashboardScope,
} from './operations-dashboard.types';

const scope: ResolvedOperationsDashboardScope = {
  level: 'division',
  id: 1,
  name: 'División Interamericana',
  path: [{ level: 'division', id: 1, name: 'División Interamericana' }],
};

const emptyRaw = (): OperationsDashboardRawSnapshot => ({
  children: [
    { id: 10, name: 'Unión Norte' },
    { id: 20, name: 'Unión Sur' },
  ],
  administrative: [],
  operations: [],
  people: [],
  classes: [],
  monthlyReports: [],
  honors: [],
  activities: [],
  queues: [],
});

const map = (raw: OperationsDashboardRawSnapshot, honorsAvailable = true) =>
  mapOperationsDashboard({
    raw,
    scope,
    ecclesiasticalYear: {
      year_id: 7,
      start_date: new Date('2026-01-01T00:00:00.000Z'),
      end_date: new Date('2026-12-31T00:00:00.000Z'),
      active: honorsAvailable,
    },
    reportingMonth: { year: 2026, month: 6 },
    computedAt: new Date('2026-07-15T12:00:00.000Z'),
    honorsAvailable,
  });

describe('mapOperationsDashboard', () => {
  it('uses independently recalculated total rows instead of summing non-additive children', () => {
    const raw = emptyRaw();
    raw.administrative = [
      { bucket_id: null, total: 5, active: 4, inactive: 1 },
      { bucket_id: 10, total: 3, active: 3, inactive: 0 },
      { bucket_id: 20, total: 4, active: 2, inactive: 2 },
    ];
    raw.operations = [
      { bucket_id: null, operational_clubs: 4, operational_sections: 6 },
      { bucket_id: 10, operational_clubs: 3, operational_sections: 4 },
      { bucket_id: 20, operational_clubs: 3, operational_sections: 4 },
    ];
    raw.people = [
      {
        bucket_id: null,
        institutionally_active: 4,
        platform_active: 3,
        platform_inactive: 1,
      },
      {
        bucket_id: 10,
        institutionally_active: 3,
        platform_active: 3,
        platform_inactive: 0,
      },
      {
        bucket_id: 20,
        institutionally_active: 3,
        platform_active: 2,
        platform_inactive: 1,
      },
    ];
    raw.classes = [
      {
        bucket_id: null,
        class_id: null,
        class_name: null,
        club_type_id: null,
        club_type_name: null,
        display_order: null,
        enrollment_count: 4,
        distinct_people: 3,
      },
      {
        bucket_id: null,
        class_id: 8,
        class_name: 'Explorador',
        club_type_id: 2,
        club_type_name: 'Conquistadores',
        display_order: 2,
        enrollment_count: 4,
        distinct_people: 3,
      },
      {
        bucket_id: 10,
        class_id: null,
        class_name: null,
        club_type_id: null,
        club_type_name: null,
        display_order: null,
        enrollment_count: 3,
        distinct_people: 3,
      },
      {
        bucket_id: 20,
        class_id: null,
        class_name: null,
        club_type_id: null,
        club_type_name: null,
        display_order: null,
        enrollment_count: 3,
        distinct_people: 2,
      },
    ];

    const result = map(raw);

    expect(result.summary.administrative_clubs.total).toBe(5);
    expect(result.summary.operations.operational_clubs).toBe(4);
    expect(result.summary.people.institutionally_active).toBe(4);
    expect(result.summary.classes).toMatchObject({
      total_enrollments: 4,
      distinct_people: 3,
    });
    expect(
      result.children.map((child) => child.people.institutionally_active),
    ).toEqual([3, 3]);
  });

  it('keeps zero-valued children and returns null report coverage for a zero denominator', () => {
    const raw = emptyRaw();
    raw.administrative = [
      { bucket_id: null, total: 2, active: 1, inactive: 1 },
      { bucket_id: 10, total: 2, active: 1, inactive: 1 },
    ];
    raw.monthlyReports = [
      {
        bucket_id: null,
        expected_sections: 0,
        submitted_sections: 0,
        draft_sections: 0,
        generated_sections: 0,
        missing_sections: 0,
      },
    ];

    const result = map(raw);
    const zeroChild = result.children[1];

    expect(result.summary.monthly_reports.coverage_pct).toBeNull();
    expect(result.summary.monthly_reports).not.toHaveProperty('bucket_id');
    expect(zeroChild).toMatchObject({
      id: 20,
      name: 'Unión Sur',
      level: 'union',
      administrative_clubs: { total: 0, active: 0, inactive: 0 },
      operations: {
        operational_clubs: 0,
        non_operational_clubs: 0,
        operational_sections: 0,
        operational_rate_pct: null,
      },
      monthly_reports: { expected_sections: 0, coverage_pct: null },
      classes: { total_enrollments: 0, distinct_people: 0, by_class: [] },
      honors: {
        in_progress: 0,
        pending_review: 0,
        approved: 0,
        attribution: 'current_affiliation',
      },
      activities: { registered: 0 },
    });
  });

  it('returns a null operational rate in summary and children when no club universe exists', () => {
    const result = map(emptyRaw());

    expect(result.summary.operations.operational_rate_pct).toBeNull();
    expect(
      result.children.every(
        (child) => child.operations.operational_rate_pct === null,
      ),
    ).toBe(true);
  });

  it('exposes compact class and honors breakdowns for every child bucket', () => {
    const raw = emptyRaw();
    raw.classes = [
      {
        bucket_id: 10,
        class_id: null,
        class_name: null,
        club_type_id: null,
        club_type_name: null,
        display_order: null,
        enrollment_count: 4,
        distinct_people: 3,
      },
      {
        bucket_id: 10,
        class_id: 8,
        class_name: 'Explorador',
        club_type_id: 2,
        club_type_name: 'Conquistadores',
        display_order: 2,
        enrollment_count: 4,
        distinct_people: 3,
      },
    ];
    raw.honors = [
      {
        bucket_id: 10,
        in_progress: 5,
        pending_review: 2,
        approved: 7,
      },
    ];

    const [child, zeroChild] = map(raw).children;

    expect(child.classes).toEqual({
      total_enrollments: 4,
      distinct_people: 3,
      by_class: [expect.objectContaining({ class_id: 8, enrollment_count: 4 })],
    });
    expect(child.honors).toEqual({
      in_progress: 5,
      pending_review: 2,
      approved: 7,
      attribution: 'current_affiliation',
    });
    expect(zeroChild.classes).toEqual({
      total_enrollments: 0,
      distinct_people: 0,
      by_class: [],
    });
    expect(zeroChild.honors).toEqual({
      in_progress: 0,
      pending_review: 0,
      approved: 0,
      attribution: 'current_affiliation',
    });
  });

  it('sorts class breakdowns and marks current-affiliation attribution explicitly', () => {
    const raw = emptyRaw();
    raw.classes = [
      {
        bucket_id: null,
        class_id: 2,
        class_name: 'Segundo',
        club_type_id: 2,
        club_type_name: 'Conquistadores',
        display_order: 2,
        enrollment_count: 2,
        distinct_people: 2,
      },
      {
        bucket_id: null,
        class_id: 1,
        class_name: 'Primero',
        club_type_id: 2,
        club_type_name: 'Conquistadores',
        display_order: 1,
        enrollment_count: 3,
        distinct_people: 3,
      },
    ];
    raw.honors = [
      {
        bucket_id: null,
        in_progress: 5,
        pending_review: 2,
        approved: 7,
      },
    ];

    const result = map(raw);

    expect(
      result.summary.classes.by_class.map((item) => item.class_id),
    ).toEqual([1, 2]);
    expect(result.summary.honors).toEqual({
      in_progress: 5,
      pending_review: 2,
      approved: 7,
      attribution: 'current_affiliation',
    });
    expect(result.data_quality).toContainEqual(
      expect.objectContaining({
        metric: 'classes',
        status: 'current_affiliation',
      }),
    );
  });

  it('returns unavailable rather than fabricated zeroes for historical honors', () => {
    const result = map(emptyRaw(), false);

    expect(result.summary.honors).toEqual({
      in_progress: null,
      pending_review: null,
      approved: null,
      attribution: 'unavailable',
    });
    expect(result.data_quality).toContainEqual(
      expect.objectContaining({
        metric: 'operations',
        note: expect.stringMatching(/cerrad|operaron/i),
      }),
    );
    expect(result.summary.queues.honors_review_pending).toBeNull();
    expect(
      result.children.every(
        (child) =>
          child.honors.attribution === 'unavailable' &&
          child.queues.honors_review_pending === null,
      ),
    ).toBe(true);
    expect(result.data_quality).toContainEqual(
      expect.objectContaining({ metric: 'honors', status: 'unavailable' }),
    );
  });
});
