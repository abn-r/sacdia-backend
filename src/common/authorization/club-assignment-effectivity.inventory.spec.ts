import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CLUB_ASSIGNMENT_NON_AUTHORITY_ALLOWLIST } from './club-assignment-effectivity.policy';
import {
  ASSIGNMENT_QUERY_INVENTORY,
  ASSIGNMENT_QUERY_SCANNER_INFRASTRUCTURE_FILES,
  assertAssignmentQueryInventory,
  scanAssignmentQueries,
} from './club-assignment-effectivity.inventory';

describe('club assignment effectivity inventory', () => {
  it('excludes only known scanner infrastructure paths', () => {
    expect([...ASSIGNMENT_QUERY_SCANNER_INFRASTRUCTURE_FILES].sort()).toEqual([
      'common/authorization/club-assignment-effectivity.arch.ts',
      'common/authorization/club-assignment-effectivity.inventory.ts',
      'common/authorization/club-assignment-effectivity.policy.ts',
      'common/authorization/club-assignment-effectivity.sql.ts',
    ]);
    for (const path of ASSIGNMENT_QUERY_SCANNER_INFRASTRUCTURE_FILES) {
      expect(path.startsWith('common/authorization/')).toBe(true);
      expect(path.includes('*')).toBe(false);
    }
  });

  it('scans a future production file sharing the scanner basename prefix', () => {
    const root = mkdtempSync(join(tmpdir(), 'assignment-query-'));
    const directory = join(root, 'common', 'authorization');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'club-assignment-effectivity.repository.ts'),
      'prisma.club_role_assignments.findMany({ where: { active: true } });',
    );

    try {
      expect(scanAssignmentQueries(root)).toEqual([
        expect.objectContaining({
          path: 'common/authorization/club-assignment-effectivity.repository.ts',
          kind: 'prisma',
        }),
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('classifies the complete hardened scan baseline', () => {
    const findings = scanAssignmentQueries(join(process.cwd(), 'src'));

    expect(() =>
      assertAssignmentQueryInventory(findings, ASSIGNMENT_QUERY_INVENTORY),
    ).not.toThrow();
    expect(findings).toHaveLength(114);
    expect(ASSIGNMENT_QUERY_INVENTORY).toHaveLength(47);
    expect(
      Object.fromEntries(
        ['T08', 'T09', 'allowlist'].map((owner) => [
          owner,
          ASSIGNMENT_QUERY_INVENTORY.filter(
            (entry) => entry.owner === owner,
          ).reduce((total, entry) => total + entry.count, 0),
        ]),
      ),
    ).toEqual({ T08: 55, T09: 48, allowlist: 11 });
  });

  it('classifies the five indirect query sites exposed by the hardened core', () => {
    expect(
      Object.fromEntries(
        ASSIGNMENT_QUERY_INVENTORY.filter(({ path }) =>
          [
            'clubs/clubs.service.ts',
            'investiture/investiture.service.ts',
            'requests/requests.service.ts',
          ].includes(path),
        ).map(({ path, count }) => [path, count]),
      ),
    ).toEqual({
      'clubs/clubs.service.ts': 8,
      'investiture/investiture.service.ts': 7,
      'requests/requests.service.ts': 7,
    });
  });

  it('keeps workflow and history predicates explicitly non-authoritative', () => {
    expect(
      ASSIGNMENT_QUERY_INVENTORY.filter(
        ({ intent }) => intent !== 'effectiveWhere',
      ).every(({ owner }) => owner === 'allowlist'),
    ).toBe(true);
    for (const intent of ['workflowWhere', 'historicalWhere'] as const) {
      expect(CLUB_ASSIGNMENT_NON_AUTHORITY_ALLOWLIST[intent]).toEqual({
        grantsAuthority: false,
      });
    }
  });
});
