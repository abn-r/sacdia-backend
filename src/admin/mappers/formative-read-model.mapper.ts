export interface TrajectoryClassDto {
  user_class_id: number;
  class_id: number;
  class_name: string | null;
  investiture: boolean;
  date_investiture: Date | null;
  advanced: boolean;
  certificate: string | null;
  current_class: boolean;
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
  user_class_id: number;
  class_id: number;
  investiture: boolean;
  date_investiture: Date | null;
  advanced: boolean;
  certificate: string | null;
  current_class: boolean;
  classes: {
    name: string;
  } | null;
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
  trajectory_classes: TrajectoryClassDto[];
  classes: TrajectoryClassDto[];
  conflictEnrollmentIds: number[];
}

function mapTrajectoryClasses(
  trajectoryClasses: TrajectoryClassSource[],
): TrajectoryClassDto[] {
  return trajectoryClasses.map((item) => ({
    user_class_id: item.user_class_id,
    class_id: item.class_id,
    class_name: item.classes?.name ?? null,
    investiture: item.investiture,
    date_investiture: item.date_investiture,
    advanced: item.advanced,
    certificate: item.certificate ?? null,
    current_class: item.current_class,
  }));
}

function mapCurrentOperationalEnrollment(
  activeEcclesiasticalYearId: number | null,
  enrollments: OperationalEnrollmentSource[],
): CurrentOperationalEnrollmentDto | null {
  if (activeEcclesiasticalYearId === null) {
    return null;
  }

  if (enrollments.length !== 1) {
    return null;
  }

  const enrollment = enrollments[0];

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

export function buildFormativeReadModel(
  input: FormativeReadModelInput,
): FormativeReadModel {
  const trajectory = mapTrajectoryClasses(input.trajectoryClasses);

  return {
    current_operational_enrollment: mapCurrentOperationalEnrollment(
      input.activeEcclesiasticalYearId,
      input.enrollments,
    ),
    trajectory_classes: trajectory,
    classes: trajectory,
    conflictEnrollmentIds:
      input.activeEcclesiasticalYearId !== null && input.enrollments.length > 1
        ? input.enrollments.map((item) => item.enrollment_id)
        : [],
  };
}
