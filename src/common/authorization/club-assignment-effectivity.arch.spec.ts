import { scanAssignmentQuerySource } from './club-assignment-effectivity.arch';
describe('club assignment Prisma query scanner', () => {
  it('finds a lexical delegate alias with an aliased root where input', () => {
    const findings = scanAssignmentQuerySource(
      'assignments.ts',
      `const assignments = this.prisma['club_role_assignments'];
       const predicate = { active: true };
       const args = { where: predicate };
       assignments.findMany(args);`,
    );
    expect(findings).toEqual([
      expect.objectContaining({ kind: 'prisma', line: 4 }),
    ]);
  });
  it('fails closed unless the delegate comes from a Prisma client root', () => {
    const findings = scanAssignmentQuerySource(
      'lookalike.ts',
      'repository.club_role_assignments.findMany({ where: { active: true } });',
    );

    expect(findings).toEqual([]);
  });

  it('does not treat predicates on a related model as assignment predicates', () => {
    const findings = scanAssignmentQuerySource(
      'related.ts',
      `prisma.club_role_assignments.findMany({
         where: { roles: { active: true } },
       });`,
    );

    expect(findings).toEqual([]);
  });

  it('finds typed computed relation helpers outside a call site', () => {
    const findings = scanAssignmentQuerySource(
      'users.ts',
      `const assignmentPredicate = { status: 'ACTIVE' };
       const relation = { some: assignmentPredicate };
       const helper: Prisma.usersWhereInput = {
         ['club_role_assignments']: relation,
       };`,
    );

    expect(findings).toEqual([
      expect.objectContaining({ kind: 'relation', line: 4 }),
    ]);
  });

  it('resolves nearest lexical where binding and typed assignment where inputs', () => {
    const findings = scanAssignmentQuerySource(
      'bindings.ts',
      `const where = { roles: { active: true } };
       const ignored = prisma.club_role_assignments.findMany({ where });
       if (enabled) {
         const where = { AND: [{ end_date: { gte: now } }] };
         const filter: Prisma.club_role_assignmentsWhereInput = where;
         const client = options.client ?? this.prisma;
         client.club_role_assignments.findMany({ where: filter });
       }
       const outside = { active: true };
       function parameterShadow(outside: unknown) {
         prisma.club_role_assignments.findMany({ where: outside });
       }`,
    );

    expect(findings).toEqual([
      expect.objectContaining({ kind: 'where-input', line: 5 }),
      expect.objectContaining({ kind: 'prisma', line: 7 }),
    ]);
  });
});
