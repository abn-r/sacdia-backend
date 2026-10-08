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
      expect.objectContaining({ kind: 'prisma', line: 11 }),
    ]);
  });

  it('finds shorthand where binding on assignment findMany', () => {
    const findings = scanAssignmentQuerySource(
      'shorthand.ts',
      `const where = { active: true, status: 'active' };
       prisma.club_role_assignments.findMany({ where });`,
    );
    expect(findings).toEqual([
      expect.objectContaining({ kind: 'prisma', line: 2 }),
    ]);
  });

  it('finds complete argument object aliases', () => {
    const findings = scanAssignmentQuerySource(
      'args-alias.ts',
      `const args = { where: { active: true } };
       prisma.club_role_assignments.findMany(args);`,
    );
    expect(findings).toEqual([
      expect.objectContaining({ kind: 'prisma', line: 2 }),
    ]);
  });

  it('fails closed on uninspectable where helpers and argument parameters', () => {
    const findings = scanAssignmentQuerySource(
      'opaque.ts',
      `function makeWhere() { return { active: true }; }
       prisma.club_role_assignments.findMany({ where: makeWhere() });
       function query(args: object) {
         prisma.club_role_assignments.findMany(args);
       }`,
    );
    expect(findings).toEqual([
      expect.objectContaining({ kind: 'prisma', line: 2 }),
      expect.objectContaining({ kind: 'prisma', line: 4 }),
    ]);
  });

  it('recognizes a `store` transaction handle as a Prisma client root', () => {
    const findings = scanAssignmentQuerySource(
      'store-root.ts',
      `function check(store: DecisionStore) {
         return store.club_role_assignments.findFirst({
           where: { active: true },
         });
       }`,
    );
    expect(findings).toEqual([
      expect.objectContaining({ kind: 'prisma', line: 2 }),
    ]);
  });

  it('fails closed on a spread helper call inside an assignment where', () => {
    const findings = scanAssignmentQuerySource(
      'spread-call.ts',
      `prisma.club_role_assignments.findFirst({
         where: { user_id: userId, ...memberWhere(context) },
       });
       prisma.club_role_assignments.findFirst({
         where: { AND: [{ user_id: userId, ...memberWhere(context) }] },
       });
       const inner = { ...memberWhere(context) };
       prisma.club_role_assignments.findFirst({
         where: { user_id: userId, ...inner },
       });`,
    );
    expect(findings).toEqual([
      expect.objectContaining({ kind: 'prisma', line: 1 }),
      expect.objectContaining({ kind: 'prisma', line: 4 }),
      expect.objectContaining({ kind: 'prisma', line: 8 }),
    ]);
  });

  it('keeps a spread of an inspectable object without predicates clean', () => {
    const findings = scanAssignmentQuerySource(
      'spread-object.ts',
      `const base = { user_id: userId };
       prisma.club_role_assignments.findFirst({
         where: { ...base, club_section_id: sectionId },
       });`,
    );
    expect(findings).toEqual([]);
  });

  it('fails closed on a relation operator fed by a helper call', () => {
    const findings = scanAssignmentQuerySource(
      'relation-call.ts',
      `prisma.enrollments.findMany({
         where: {
           users: {
             club_role_assignments: { some: memberWhere(context) },
           },
         },
       });
       prisma.enrollments.findMany({
         where: {
           users: {
             club_role_assignments: { none: { user_id: userId } },
           },
         },
       });`,
    );
    expect(findings).toEqual([
      expect.objectContaining({ kind: 'relation', line: 4 }),
    ]);
  });

  it('flags functions declared to return an assignment where input', () => {
    const findings = scanAssignmentQuerySource(
      'where-input-return.ts',
      `export function memberWhere(
         scope: Scope,
       ): Prisma.club_role_assignmentsWhereInput {
         return { club_section_id: scope.id, active: true };
       }
       const arrowWhere = (scope: Scope): Prisma.club_role_assignmentsWhereInput =>
         ({ club_section_id: scope.id });
       class Policy {
         build(): Prisma.club_role_assignmentsWhereInput {
           return build();
         }
       }
       type Builder = () => Prisma.club_role_assignmentsWhereInput;
       function unrelated(): Prisma.usersWhereInput {
         return { active: true };
       }`,
    );
    expect(findings).toEqual([
      expect.objectContaining({ kind: 'where-input', line: 1 }),
      expect.objectContaining({ kind: 'where-input', line: 6 }),
      expect.objectContaining({ kind: 'where-input', line: 9 }),
    ]);
  });
});
