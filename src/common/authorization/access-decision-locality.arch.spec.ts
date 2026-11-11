import { join } from 'node:path';

import {
  scanAccessDecisionLocality,
  scanUsersLocalFieldSource,
} from './access-decision-locality.arch';

/**
 * Ratchet: only remove entries, never add. Access decisions (who may see or
 * act on whom) belong in `src/common/authorization/**` and the guards; a file
 * outside them that filters `users` by `local_field_id` or decides with a
 * `club_role_assignments` predicate must move there. Paths relative to `src/`.
 */
export const KNOWN_ACCESS_DECISION_FILES: readonly string[] = [
  'activities/activities-reminder.service.ts',
  'activities/activities.service.ts',
  'admin/admin-reference.service.ts',
  'admin/admin-users.service.ts',
  'analytics/analytics.service.ts',
  'analytics/operations-dashboard.repository.ts',
  'annual-folders/annual-folders.service.ts',
  'annual-folders/score-calculators/sacdia-operational-usage-score.ts',
  'annual-reports/annual-reports.service.ts',
  'camporee-scoring/camporee-scoring.service.ts',
  'certifications/eligibility/eligibility-rule-handlers.ts',
  'classes/class-counselor-assignments.service.ts',
  'classes/class-progress-access.service.ts',
  'classes/class-progress-scope.service.ts',
  'classes/class-requirement-eligibility.service.ts',
  'classes/district-investiture-pastors.service.ts',
  'clubs/clubs.service.ts',
  'common/services/authorization-context.service.ts',
  'coordination/actor-section-scope.service.ts',
  'coordination/coordination.service.ts',
  'dashboard/dashboard.service.ts',
  'evidence-review/evidence-review.service.ts',
  'field-payment-orders/fulfillment/camporee-fulfillment.service.ts',
  'field-payment-orders/fulfillment/insurance-fulfillment.service.ts',
  'field-payment-orders/insurance-reassignments.service.ts',
  'honors/honor-validation-workflow.service.ts',
  'honors/honors.service.ts',
  'honors/master-honors-evaluator.service.ts',
  'honors/master-honors.service.ts',
  'insurance/insurance.service.ts',
  'investiture-requests/investiture-communications.loader.ts',
  'investiture/investiture.service.ts',
  'member-of-month/member-of-month.service.ts',
  'monthly-reports/monthly-reports.service.ts',
  'notifications/notifications.processor.ts',
  'notifications/notifications.service.ts',
  'qr/qr.service.ts',
  'quarterly-reports/quarterly-reports.service.ts',
  'rankings/member-rankings/services/enrollment-club-resolver.service.ts',
  'rbac/rbac.service.ts',
  'requests/requests.service.ts',
  'scoring-categories/scoring-categories.service.ts',
  'support/support.service.ts',
  'units/units.service.ts',
  'validation/validation.service.ts',
];

describe('access decision locality ratchet', () => {
  it('detects users filtered by local_field_id', () => {
    const findings = scanUsersLocalFieldSource(
      'x.ts',
      `const where = { local_field_id: lf };
       prisma.users.findMany({ where });
       this.prisma.users.count({ where: { AND: [{ local_field_id: 1 }] } });
       const typed: Prisma.usersWhereInput = { local_field_id: 2 };
       prisma.users.findMany({ where: { user_id: 'a' }, select: { local_field_id: true } });
       prisma.clubs.findMany({ where: { local_field_id: 3 } });
       function scope(): Prisma.usersWhereInput {
         return { local_field_id: 4 };
       }`,
    );
    expect(findings.map(({ line }) => line)).toEqual([2, 3, 4, 7]);
  });

  it('matches the frozen list exactly', () => {
    const findings = scanAccessDecisionLocality(join(process.cwd(), 'src'));
    const actual = [...new Set(findings.map(({ path }) => path))].sort();
    const known = new Set(KNOWN_ACCESS_DECISION_FILES);

    const added = actual.filter((path) => !known.has(path));
    const stale = KNOWN_ACCESS_DECISION_FILES.filter(
      (path) => !actual.includes(path),
    );

    const details = findings
      .filter(({ path }) => added.includes(path))
      .map(
        ({ path, line, kind, snippet }) =>
          `${path}:${line} [${kind}] ${snippet}`,
      );

    expect({ added: details, stale }).toEqual({ added: [], stale: [] });
    expect([...KNOWN_ACCESS_DECISION_FILES]).toEqual(
      [...KNOWN_ACCESS_DECISION_FILES].sort(),
    );
  });
});
