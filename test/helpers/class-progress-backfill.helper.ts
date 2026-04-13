export interface LegacyClassProgressRow {
  progressId: number;
  userId: string;
  classId: number;
  enrollmentId: number | null;
}

export interface ProgressEnrollmentCandidate {
  enrollmentId: number;
  userId: string;
  classId: number;
}

export interface BoundedBackfillSimulationResult {
  rows: LegacyClassProgressRow[];
  unresolvedRowIds: number[];
  reassignedAmbiguousRowIds: number[];
}

export function simulateBoundedClassProgressBackfill(
  rows: LegacyClassProgressRow[],
  enrollments: ProgressEnrollmentCandidate[],
): BoundedBackfillSimulationResult {
  const unresolvedRowIds: number[] = [];

  const resolvedRows = rows.map((row) => {
    if (row.enrollmentId !== null) {
      return row;
    }

    const candidates = enrollments.filter(
      (enrollment) =>
        enrollment.userId === row.userId && enrollment.classId === row.classId,
    );

    if (candidates.length === 1) {
      return {
        ...row,
        enrollmentId: candidates[0].enrollmentId,
      };
    }

    unresolvedRowIds.push(row.progressId);

    return row;
  });

  return {
    rows: resolvedRows,
    unresolvedRowIds,
    reassignedAmbiguousRowIds: [],
  };
}
