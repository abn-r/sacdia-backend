import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import {
  AssignmentQueryFinding,
  scanAssignmentQuerySource,
} from './club-assignment-effectivity.arch';
import { scanAssignmentRawSqlSource } from './club-assignment-effectivity.sql';

type AssignmentQueryIntent =
  | 'effectiveWhere'
  | 'workflowWhere'
  | 'historicalWhere';
type AssignmentQueryOwner = 'T08' | 'T09' | 'allowlist';
export type AssignmentQueryInventoryEntry = {
  path: string;
  intent: AssignmentQueryIntent;
  owner: AssignmentQueryOwner;
  count: number;
  digest: string;
};

const baseline = {
  'admin/admin-geography.service.ts':
    'historicalWhere|allowlist|1|d56c9a4907fd',
  'admin/admin-reference.service.ts': 'effectiveWhere|T09|1|f9e0a7b798f8',
  'admin/admin-users.service.ts': 'effectiveWhere|T09|3|8efadfaf99fa',
  'analytics/analytics.service.ts': 'effectiveWhere|T09|9|cd865fa6eeb2',
  'analytics/operations-dashboard.repository.ts':
    'effectiveWhere|T09|5|b1e4bbcd3060',
  'annual-folders/annual-folders.service.ts':
    'effectiveWhere|T08|2|c7726a03d3c1',
  'annual-folders/score-calculators/sacdia-operational-usage-score.ts':
    'effectiveWhere|T09|1|080dad106bfa',
  'annual-reports/annual-reports.service.ts':
    'effectiveWhere|T09|3|45560f10e5fd',
  'auth/auth.service.ts': 'effectiveWhere|T08|1|f977d2dd17f2',
  'camporee-scoring/camporee-scoring.service.ts':
    'effectiveWhere|T09|1|7e83a87c1703',
  'camporees/camporees.service.ts': 'workflowWhere|allowlist|1|1564632cc103',
  'classes/class-counselor-assignments.service.ts':
    'effectiveWhere|T08|1|94591f7414a0',
  'classes/class-progress-access.service.ts':
    'effectiveWhere|T08|2|636ca870e3ce',
  'classes/class-progress-scope.service.ts':
    'effectiveWhere|T08|2|48c80c658b3f',
  'classes/class-requirement-eligibility.service.ts':
    'effectiveWhere|T08|1|f0f7540f4594',
  'club-enrollments/club-enrollments.service.ts':
    'effectiveWhere|T08|1|1f2269db063f',
  'certifications/eligibility/eligibility-rule-handlers.ts':
    'effectiveWhere|T08|2|9841f0b29dc2',
  'clubs/clubs.service.ts': 'effectiveWhere|T08|8|4d13659e19ec',
  'common/guards/club-roles.guard.ts': 'effectiveWhere|T08|1|32d48d679749',
  'common/guards/permissions.guard.ts': 'effectiveWhere|T08|3|e8b370c41349',
  'common/services/authorization-context.service.ts':
    'effectiveWhere|T08|1|c5e3b3bd1aa7',
  'coordination/coordination.service.ts': 'effectiveWhere|T08|1|9a134e551821',
  'dashboard/dashboard.service.ts': 'effectiveWhere|T08|2|ffdfddfae134',
  'evidence-review/evidence-review.service.ts':
    'effectiveWhere|T09|2|02f5cfc40df4',
  'honors/honor-validation-workflow.service.ts':
    'effectiveWhere|T08|1|73e3474e6bd8',
  'honors/honors.service.ts': 'effectiveWhere|T08|2|61643760d639',
  'honors/master-honors-evaluator.service.ts':
    'effectiveWhere|T08|2|637369e238ef',
  'honors/master-honors.service.ts': 'effectiveWhere|T08|2|2741ba22d4d7',
  'insurance/insurance.service.ts': 'effectiveWhere|T09|2|2fc49adf6156',
  'investiture/investiture.service.ts': 'effectiveWhere|T08|7|d70d00723588',
  'member-of-month/member-of-month.service.ts':
    'effectiveWhere|T09|2|4a63b7e684b3',
  'membership-requests/membership-requests.service.ts':
    'workflowWhere|allowlist|6|294fe5001f9d',
  'monthly-reports/monthly-reports.service.ts':
    'effectiveWhere|T09|3|b00f9c8d194d',
  'notifications/notifications.processor.ts':
    'effectiveWhere|T09|3|3bf28a58f9e2',
  'notifications/notifications.service.ts': 'effectiveWhere|T09|2|12585f37569f',
  'post-registration/post-registration.service.ts':
    'workflowWhere|allowlist|3|4dfdc41976e6',
  'qr/qr.service.ts': 'effectiveWhere|T08|3|a4cc54c2bd51',
  'quarterly-reports/quarterly-reports.service.ts':
    'effectiveWhere|T09|3|1c55ef0ad8fe',
  'rankings/member-rankings/services/enrollment-club-resolver.service.ts':
    'effectiveWhere|T08|1|11a310c43604',
  'rbac/rbac.service.ts': 'effectiveWhere|T08|1|68c2f63166fd',
  'requests/requests.service.ts': 'effectiveWhere|T08|7|98c8941232e0',
  'scoring-categories/scoring-categories.service.ts':
    'effectiveWhere|T09|2|13fb6223b7d5',
  'units/units.service.ts': 'effectiveWhere|T08|1|46d392950956',
  'validation/validation.service.ts': 'effectiveWhere|T09|3|af6362f7dd6f',
} as const;

export const ASSIGNMENT_QUERY_INVENTORY: readonly AssignmentQueryInventoryEntry[] =
  Object.entries(baseline).map(([path, encoded]) => {
    const [intent, owner, count, digest] = encoded.split('|');
    return {
      path,
      intent: intent as AssignmentQueryIntent,
      owner: owner as AssignmentQueryOwner,
      count: Number(count),
      digest,
    };
  });

/** Exact infrastructure modules only — never a basename/prefix match. */
export const ASSIGNMENT_QUERY_SCANNER_INFRASTRUCTURE_FILES = new Set([
  'common/authorization/club-assignment-effectivity.arch.ts',
  'common/authorization/club-assignment-effectivity.inventory.ts',
  'common/authorization/club-assignment-effectivity.policy.ts',
  'common/authorization/club-assignment-effectivity.sql.ts',
]);

function sourceFiles(directory: string, sourceRoot = directory): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, sourceRoot);
    const relativePath = relative(sourceRoot, path).split(sep).join('/');
    return entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !ASSIGNMENT_QUERY_SCANNER_INFRASTRUCTURE_FILES.has(relativePath)
      ? [path]
      : [];
  });
}

export function scanAssignmentQueries(
  sourceRoot: string,
): AssignmentQueryFinding[] {
  return sourceFiles(sourceRoot).flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    const relativePath = relative(sourceRoot, path).split(sep).join('/');
    return [
      ...scanAssignmentQuerySource(relativePath, source),
      ...scanAssignmentRawSqlSource(relativePath, source),
    ];
  });
}

function digest(findings: readonly AssignmentQueryFinding[]): string {
  return createHash('sha256')
    .update(
      findings
        .map(({ kind, fingerprint }) => `${kind}:${fingerprint}`)
        .sort()
        .join('\n'),
    )
    .digest('hex')
    .slice(0, 12);
}

export function assertAssignmentQueryInventory(
  findings: readonly AssignmentQueryFinding[],
  inventory: readonly AssignmentQueryInventoryEntry[],
): void {
  const expected = new Map(inventory.map((entry) => [entry.path, entry]));
  const actual = new Map<string, AssignmentQueryFinding[]>();
  for (const finding of findings) {
    actual.set(finding.path, [...(actual.get(finding.path) ?? []), finding]);
  }
  const unclassified = [...actual.entries()].filter(
    ([path]) => !expected.has(path),
  );
  if (unclassified.length) {
    const details = unclassified
      .flatMap(([path, rows]) =>
        rows.map(({ line, kind }) => `${path}:${line} (${kind})`),
      )
      .join(', ');
    throw new Error(`Unclassified club assignment predicate: ${details}`);
  }
  for (const entry of inventory) {
    const rows = actual.get(entry.path) ?? [];
    const actualDigest = digest(rows);
    if (rows.length !== entry.count || actualDigest !== entry.digest) {
      throw new Error(
        `Stale club assignment inventory: ${entry.path} expected ${entry.count}/${entry.digest}, received ${rows.length}/${actualDigest}`,
      );
    }
  }
}
