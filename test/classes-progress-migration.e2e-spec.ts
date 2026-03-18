import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  simulateBoundedClassProgressBackfill,
  type LegacyClassProgressRow,
  type ProgressEnrollmentCandidate,
} from './helpers/class-progress-backfill.helper';

describe('FS-03 bounded progress backfill policy', () => {
  it('leaves ambiguous legacy rows without enrollment_id', () => {
    const legacyRows: LegacyClassProgressRow[] = [
      {
        progressId: 10,
        userId: 'user-1',
        classId: 101,
        enrollmentId: null,
      },
      {
        progressId: 11,
        userId: 'user-2',
        classId: 101,
        enrollmentId: null,
      },
      {
        progressId: 12,
        userId: 'user-3',
        classId: 101,
        enrollmentId: null,
      },
    ];

    const enrollments: ProgressEnrollmentCandidate[] = [
      { enrollmentId: 1001, userId: 'user-1', classId: 101 },
      { enrollmentId: 2001, userId: 'user-2', classId: 101 },
      { enrollmentId: 2002, userId: 'user-2', classId: 101 },
    ];

    const result = simulateBoundedClassProgressBackfill(
      legacyRows,
      enrollments,
    );

    expect(result.rows).toEqual([
      { progressId: 10, userId: 'user-1', classId: 101, enrollmentId: 1001 },
      { progressId: 11, userId: 'user-2', classId: 101, enrollmentId: null },
      { progressId: 12, userId: 'user-3', classId: 101, enrollmentId: null },
    ]);
    expect(result.reassignedAmbiguousRowIds).toEqual([]);
    expect(result.unresolvedRowIds).toEqual([11, 12]);
  });

  it('keeps the migration SQL bounded to deterministic matches only', () => {
    const migrationPath = join(
      __dirname,
      '../../docs/03-DATABASE/migrations/20260313_fs03_enrollment_aware_progress.sql',
    );
    const migrationSql = readFileSync(migrationPath, 'utf8');

    expect(migrationSql).toContain('HAVING COUNT(*) = 1');
    expect(migrationSql).toContain('WHERE cmp.enrollment_id IS NULL');
    expect(migrationSql).toContain('WHERE csp.enrollment_id IS NULL');
    expect(migrationSql).toContain(
      'Section rows left unresolved because user_id + class_id maps to zero or multiple enrollments.',
    );
  });
});
