import { scanAssignmentRawSqlSource } from './club-assignment-effectivity.sql';

const scan = (source: string) => scanAssignmentRawSqlSource('raw.ts', source);

describe('club assignment raw SQL scanner', () => {
  it.each([
    [
      'unknown interpolation',
      'const central = Prisma.sql`${this.assignmentEffectivityPolicy.toSql(context)}`; Prisma.sql`SELECT * FROM club_role_assignments cra WHERE ${central} AND ${fragment}`',
    ],
    [
      'unknown call',
      'const central = Prisma.sql`${this.assignmentEffectivityPolicy.toSql(context)}`; Prisma.sql`SELECT * FROM club_role_assignments cra WHERE ${central} AND ${buildFilter()}`',
    ],
    [
      'conditional interpolation',
      'const central = Prisma.sql`${this.assignmentEffectivityPolicy.toSql(context)}`; Prisma.sql`SELECT * FROM club_role_assignments cra WHERE ${central} AND ${enabled ? central : fallback}`',
    ],
    [
      'member interpolation',
      'const central = Prisma.sql`${this.assignmentEffectivityPolicy.toSql(context)}`; Prisma.sql`SELECT * FROM club_role_assignments cra WHERE ${central} AND ${filters.central}`',
    ],
    [
      'unknown join element',
      'const central = Prisma.sql`${this.assignmentEffectivityPolicy.toSql(context)}`; Prisma.sql`SELECT * FROM club_role_assignments cra WHERE ${Prisma.join([central, fallback])}`',
    ],
    [
      'unknown join spread',
      'const central = Prisma.sql`${this.assignmentEffectivityPolicy.toSql(context)}`; Prisma.sql`SELECT * FROM club_role_assignments cra WHERE ${Prisma.join([...parts])}`',
    ],
    [
      'unknown join separator',
      'const central = Prisma.sql`${this.assignmentEffectivityPolicy.toSql(context)}`; Prisma.sql`SELECT * FROM club_role_assignments cra WHERE ${Prisma.join([central], separator)}`',
    ],
    [
      'parameter policy',
      'const central = Prisma.sql`${this.assignmentEffectivityPolicy.toSql(context)}`; function query(assignmentEffectivityPolicy) { return Prisma.sql`SELECT * FROM club_role_assignments cra WHERE ${central} AND ${assignmentEffectivityPolicy.toSql(context)}`; }',
    ],
    [
      'parameter shadow of canonical binding',
      'const central = Prisma.sql`${this.assignmentEffectivityPolicy.toSql(context)}`; const policy = this.assignmentEffectivityPolicy; function query(policy) { return Prisma.sql`SELECT * FROM club_role_assignments cra WHERE ${central} AND ${policy.toSql(context)}`; }',
    ],
    [
      'reassigned canonical binding',
      'const central = Prisma.sql`${this.assignmentEffectivityPolicy.toSql(context)}`; const policy = this.assignmentEffectivityPolicy; policy = fallback; Prisma.sql`SELECT * FROM club_role_assignments cra WHERE ${central} AND ${policy.toSql(context)}`',
    ],
    [
      'parenthesized boolean predicate',
      'Prisma.sql`SELECT * FROM club_role_assignments cra WHERE (${assignmentEffectivityPolicy.toSql(context)}) AND ((NOT (cra.active)))`',
    ],
    [
      'predicate in join on',
      'Prisma.sql`SELECT * FROM club_role_assignments cra JOIN users u ON (cra.active) WHERE ${assignmentEffectivityPolicy.toSql(context)}`',
    ],
    [
      'quoted target alias',
      'Prisma.sql`SELECT * FROM club_role_assignments AS "cra-role" WHERE ${this.assignmentEffectivityPolicy.toSql(context)} AND "cra-role".start_date <= NOW()`',
    ],
  ])('rejects %s', (_name, source) => {
    expect(scan(source)).toHaveLength(1);
  });

  it('neutralizes comments, quoted strings, and dollar literals before predicate matching', () => {
    const source = `
      Prisma.sql\`SELECT * FROM club_role_assignments cra
        WHERE ${'${this.assignmentEffectivityPolicy.toSql(context)}'}
        /* cra.active */ AND 'cra.status = ''ACTIVE''' <> ''
        AND $$cra.end_date > NOW()$$ <> ''\`;
    `;

    expect(scan(source)).toEqual([]);
  });
});
