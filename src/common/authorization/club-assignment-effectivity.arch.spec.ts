import { scanAssignmentQuerySource } from './club-assignment-effectivity.arch';
describe('club assignment effectivity architecture core', () => {
  it('fails closed on call fragments and boolean target predicates only', () => {
    const findings = scanAssignmentQuerySource(
      'mutation.ts',
      `Prisma.sql\`SELECT * FROM club_role_assignments cra WHERE \${assignmentEffectivityPolicy.toSql(context)} AND \${Prisma.raw('cra.active = true')}\`;
       Prisma.sql\`SELECT * FROM club_role_assignments AS "cra-role" WHERE \${assignmentEffectivityPolicy.toSql(context)} AND NOT "cra-role".active\`;
       prisma.club_role_assignments.findMany({ where: { roles: { active: true } } });`,
    );

    expect(findings.map(({ kind }) => kind)).toEqual(['raw-sql', 'raw-sql']);
  });

  it('allows a recursively proven central join and related predicate', () => {
    const source =
      'const central = Prisma.sql`${this.assignmentEffectivityPolicy.toSql(context)}`; Prisma.sql`SELECT * FROM club_role_assignments cra JOIN users u ON true WHERE ${Prisma.join([central])} AND u.active = true`';
    expect(scanAssignmentQuerySource('central.ts', source)).toEqual([]);
  });
});
