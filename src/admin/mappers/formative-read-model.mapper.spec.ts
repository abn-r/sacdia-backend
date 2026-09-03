import { buildFormativeReadModel } from './formative-read-model.mapper';
import type { OperationalEnrollmentSource } from './formative-read-model.mapper';

const buildEnrollment = (
  enrollmentId: number,
  overrides: Partial<OperationalEnrollmentSource> = {},
): OperationalEnrollmentSource => ({
  enrollment_id: enrollmentId,
  ecclesiastical_year_id: 2026,
  class_id: enrollmentId,
  enrollment_date: new Date('2026-01-05T10:00:00.000Z'),
  investiture_status: 'IN_PROGRESS',
  submitted_for_validation: false,
  submitted_at: null,
  validated_by: null,
  validated_at: null,
  rejection_reason: null,
  investiture_date: null,
  advanced_status: false,
  locked_for_validation: false,
  cross_type_enrollment: false,
  active: true,
  classes: { name: `Class ${enrollmentId}` },
  ...overrides,
});

describe('buildFormativeReadModel', () => {
  it('does not treat invested GM + cross-type class as a conflict', () => {
    const regular = buildEnrollment(9001, {
      class_id: 13,
      classes: { name: 'Guía Mayor' },
      investiture_status: 'INVESTIDO',
    });
    const crossType = buildEnrollment(9002, {
      class_id: 1,
      classes: { name: 'Abejitas Laboriosas' },
      cross_type_enrollment: true,
    });

    const result = buildFormativeReadModel({
      activeEcclesiasticalYearId: 2026,
      enrollments: [regular, crossType],
      trajectoryClasses: [],
    });

    expect(result.conflictEnrollmentIds).toEqual([]);
    expect(result.current_operational_enrollment).toMatchObject({
      enrollment_id: 9001,
      cross_type_enrollment: false,
    });
    expect(result.current_cross_type_enrollment).toMatchObject({
      enrollment_id: 9002,
      cross_type_enrollment: true,
    });
  });

  it('still flags two regular active enrollments as a conflict', () => {
    const result = buildFormativeReadModel({
      activeEcclesiasticalYearId: 2026,
      enrollments: [buildEnrollment(9001), buildEnrollment(9002)],
      trajectoryClasses: [],
    });

    expect(result.current_operational_enrollment).toBeNull();
    expect(result.current_cross_type_enrollment).toBeNull();
    expect(result.conflictEnrollmentIds).toEqual([9001, 9002]);
  });
});
