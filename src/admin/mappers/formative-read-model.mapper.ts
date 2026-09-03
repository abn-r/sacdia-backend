export interface TrajectoryClassDto {
  enrollment_id: number;
  class_id: number;
  class_name: string | null;
  ecclesiastical_year_id: number;
  advanced: boolean | null;
  current_class: boolean;
  investiture_status: string | null;
  enrollment_date: Date;
}

export interface CurrentOperationalEnrollmentDto {
  enrollment_id: number;
  ecclesiastical_year_id: number;
  class_id: number;
  class_name: string | null;
  enrollment_date: Date;
  investiture_status: string;
  submitted_for_validation: boolean;
  submitted_at: Date | null;
  validated_by: string | null;
  validated_at: Date | null;
  rejection_reason: string | null;
  investiture_date: Date | null;
  advanced_status: boolean | null;
  locked_for_validation: boolean;
  cross_type_enrollment: boolean;
  active: boolean;
}

export interface TrajectoryClassSource {
  enrollment_id: number;
  class_id: number;
  ecclesiastical_year_id: number;
  advanced_status: boolean | null;
  active: boolean;
  enrollment_date: Date;
  investiture_status: string | null;
  investiture_date?: Date | null;
  classes?: { name?: string | null } | null;
}

export interface OperationalEnrollmentSource {
  enrollment_id: number;
  ecclesiastical_year_id: number;
  class_id: number;
  enrollment_date: Date;
  investiture_status: string;
  submitted_for_validation: boolean;
  submitted_at: Date | null;
  validated_by: string | null;
  validated_at: Date | null;
  rejection_reason: string | null;
  investiture_date: Date | null;
  advanced_status: boolean | null;
  locked_for_validation: boolean;
  cross_type_enrollment: boolean;
  active: boolean;
  classes: {
    name: string;
  } | null;
}

export interface FormativeReadModelInput {
  activeEcclesiasticalYearId: number | null;
  enrollments: OperationalEnrollmentSource[];
  trajectoryClasses: TrajectoryClassSource[];
}

export interface FormativeReadModel {
  current_operational_enrollment: CurrentOperationalEnrollmentDto | null;
  current_cross_type_enrollment: CurrentOperationalEnrollmentDto | null;
  trajectory_classes: TrajectoryClassDto[];
  classes: TrajectoryClassDto[];
  conflictEnrollmentIds: number[];
}

function mapTrajectoryClasses(
  trajectoryClasses: TrajectoryClassSource[],
  activeEcclesiasticalYearId: number | null,
): TrajectoryClassDto[] {
  return trajectoryClasses.map((item) => ({
    enrollment_id: item.enrollment_id,
    class_id: item.class_id,
    class_name: item.classes?.name ?? null,
    ecclesiastical_year_id: item.ecclesiastical_year_id,
    advanced: item.advanced_status ?? null,
    current_class:
      item.active &&
      activeEcclesiasticalYearId !== null &&
      item.ecclesiastical_year_id === activeEcclesiasticalYearId,
    investiture_status: item.investiture_status ?? null,
    enrollment_date: item.enrollment_date,
  }));
}

function toCurrentOperationalEnrollment(
  enrollment: OperationalEnrollmentSource,
): CurrentOperationalEnrollmentDto {
  return {
    enrollment_id: enrollment.enrollment_id,
    ecclesiastical_year_id: enrollment.ecclesiastical_year_id,
    class_id: enrollment.class_id,
    class_name: enrollment.classes?.name ?? null,
    enrollment_date: enrollment.enrollment_date,
    investiture_status: enrollment.investiture_status,
    submitted_for_validation: enrollment.submitted_for_validation,
    submitted_at: enrollment.submitted_at,
    validated_by: enrollment.validated_by,
    validated_at: enrollment.validated_at,
    rejection_reason: enrollment.rejection_reason,
    investiture_date: enrollment.investiture_date,
    advanced_status: enrollment.advanced_status,
    locked_for_validation: enrollment.locked_for_validation,
    cross_type_enrollment: enrollment.cross_type_enrollment,
    active: enrollment.active,
  };
}

function partitionOperationalEnrollments(
  enrollments: OperationalEnrollmentSource[],
): {
  regular: OperationalEnrollmentSource[];
  crossType: OperationalEnrollmentSource[];
} {
  const regular: OperationalEnrollmentSource[] = [];
  const crossType: OperationalEnrollmentSource[] = [];

  for (const enrollment of enrollments) {
    if (enrollment.cross_type_enrollment) {
      crossType.push(enrollment);
    } else {
      regular.push(enrollment);
    }
  }

  return { regular, crossType };
}

function hasOperationalConflict(
  regular: OperationalEnrollmentSource[],
  crossType: OperationalEnrollmentSource[],
): boolean {
  return regular.length > 1 || crossType.length > 1;
}

export function buildFormativeReadModel(
  input: FormativeReadModelInput,
): FormativeReadModel {
  const trajectory = mapTrajectoryClasses(
    input.trajectoryClasses,
    input.activeEcclesiasticalYearId,
  );
  const { regular, crossType } = partitionOperationalEnrollments(
    input.enrollments,
  );
  const conflict =
    input.activeEcclesiasticalYearId !== null &&
    hasOperationalConflict(regular, crossType);

  const regularEnrollment = regular.length === 1 ? regular[0] : null;
  const crossTypeEnrollment = crossType.length === 1 ? crossType[0] : null;

  return {
    current_operational_enrollment:
      input.activeEcclesiasticalYearId === null || conflict
        ? null
        : regularEnrollment
          ? toCurrentOperationalEnrollment(regularEnrollment)
          : crossTypeEnrollment
            ? toCurrentOperationalEnrollment(crossTypeEnrollment)
            : null,
    current_cross_type_enrollment:
      input.activeEcclesiasticalYearId === null ||
      conflict ||
      !crossTypeEnrollment
        ? null
        : toCurrentOperationalEnrollment(crossTypeEnrollment),
    trajectory_classes: trajectory,
    classes: trajectory,
    conflictEnrollmentIds: conflict
      ? input.enrollments.map((item) => item.enrollment_id)
      : [],
  };
}
