import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

/**
 * Guard for family-profiles verify 2c C1/C2: EVERY production write that can
 * make a `club_role_assignments` row ACTIVE must call the shared consent gate
 * (`assignment-activation-gate.ts`) with the SAME client, BEFORE the write.
 *
 * The scan is syntactic (TypeScript AST), in the spirit of the acting-scope
 * and assignment-effectivity inventories:
 *  - a write is `create|createMany|createManyAndReturn|update|updateMany|
 *    updateManyAndReturn|upsert` on `<client>.club_role_assignments`;
 *  - it ACTIVATES unless its data provably does not: a literal `status` other
 *    than 'active' (a create without status gets the DB default 'active'; an
 *    update without status activates only with a literal `active: true`).
 *    Dynamic data (variables that are mutated, spreads, non-literal status)
 *    counts as activating;
 *  - it is GATED when the enclosing method calls a gate helper with the same
 *    client expression as the write, earlier in the source.
 *
 * Raw SQL writes, nested relation writes and aliased delegates of the table are
 * forbidden outright (they would escape this scan).
 *
 * Adding a write site changes the inventory snapshot below: classify it, and if
 * it activates, gate it.
 */

const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
]);
const CREATE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
]);
/** `assertApprovable` is ConsentGateService's thin delegate to the helper. */
const GATE_CALLS = new Set([
  'assertAssignmentActivationAllowed',
  'isAssignmentActivationAllowed',
  'assertApprovable',
]);
const TABLE = 'club_role_assignments';

type WriteSite = {
  path: string;
  method: string;
  operation: string;
  activates: boolean;
  gated: boolean;
};

type Violation = { path: string; line: number; kind: string };

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return null;
}

function property(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find(
    (element) =>
      (ts.isPropertyAssignment(element) ||
        ts.isShorthandPropertyAssignment(element)) &&
      propertyName(element.name) === name,
  );
}

function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isMethodDeclaration(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isConstructorDeclaration(current)
    ) {
      return current;
    }
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isSourceFile(current.parent.parent.parent.parent)
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function functionName(fn: ts.FunctionLikeDeclaration | null): string {
  if (!fn) return '<module>';
  if (ts.isConstructorDeclaration(fn)) {
    const owner = fn.parent;
    return `${ts.isClassDeclaration(owner) && owner.name ? owner.name.text : '<class>'}.constructor`;
  }
  if (ts.isMethodDeclaration(fn)) {
    const owner = fn.parent;
    const className =
      ts.isClassDeclaration(owner) && owner.name ? owner.name.text : '<class>';
    return `${className}.${propertyName(fn.name) ?? '<computed>'}`;
  }
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text ?? '<anonymous>';
  if (ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) {
    return fn.parent.name.text;
  }
  return '<anonymous>';
}

function collect<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T,
): T[] {
  const found: T[] = [];
  const visit = (node: ts.Node): void => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/**
 * The object a `data:` value stands for, when it is provably a fixed literal:
 * an inline object, or a `const` initialized with one that is never mutated.
 */
function resolveData(
  value: ts.Expression,
  scope: ts.Node,
): ts.ObjectLiteralExpression | ts.ArrayLiteralExpression | null {
  const node = unwrap(value);
  if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) {
    return node;
  }
  if (!ts.isIdentifier(node)) return null;
  const declaration = collect(scope, ts.isVariableDeclaration).find(
    (candidate) =>
      ts.isIdentifier(candidate.name) && candidate.name.text === node.text,
  );
  if (!declaration?.initializer) return null;
  const list = declaration.parent;
  if (
    !ts.isVariableDeclarationList(list) ||
    (list.flags & ts.NodeFlags.Const) === 0
  ) {
    return null;
  }
  const mutated = collect(scope, ts.isBinaryExpression).some(
    (binary) =>
      binary.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      binary.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      (ts.isPropertyAccessExpression(binary.left) ||
        ts.isElementAccessExpression(binary.left)) &&
      ts.isIdentifier(unwrap(binary.left.expression)) &&
      (unwrap(binary.left.expression) as ts.Identifier).text === node.text,
  );
  if (mutated) return null;
  const initializer = unwrap(declaration.initializer);
  return ts.isObjectLiteralExpression(initializer) ? initializer : null;
}

function dataActivates(
  value: ts.Expression | undefined,
  scope: ts.Node,
  isCreate: boolean,
): boolean {
  if (!value) return true;
  const data = resolveData(value, scope);
  if (!data) return true;
  if (ts.isArrayLiteralExpression(data)) {
    return data.elements.some((element) =>
      dataActivates(element, scope, isCreate),
    );
  }
  if (data.properties.some(ts.isSpreadAssignment)) return true;
  const status = property(data, 'status');
  if (status) {
    if (!ts.isPropertyAssignment(status)) return true;
    const literal = unwrap(status.initializer);
    return !ts.isStringLiteralLike(literal) || literal.text === 'active';
  }
  if (isCreate) return true; // DB default status is 'active'
  const active = property(data, 'active');
  return (
    !!active &&
    (!ts.isPropertyAssignment(active) ||
      unwrap(active.initializer).kind !== ts.SyntaxKind.FalseKeyword)
  );
}

function writeActivates(
  call: ts.CallExpression,
  operation: string,
  scope: ts.Node,
): boolean {
  const argument = call.arguments[0] ? unwrap(call.arguments[0]) : null;
  if (!argument || !ts.isObjectLiteralExpression(argument)) return true;
  const valueOf = (name: string): ts.Expression | undefined => {
    const element = property(argument, name);
    if (!element) return undefined;
    return ts.isPropertyAssignment(element)
      ? element.initializer
      : element.name;
  };
  if (operation === 'upsert') {
    return (
      dataActivates(valueOf('create'), scope, true) ||
      dataActivates(valueOf('update'), scope, false)
    );
  }
  return dataActivates(
    valueOf('data'),
    scope,
    CREATE_OPERATIONS.has(operation),
  );
}

function calleeName(call: ts.CallExpression): string | null {
  const callee = unwrap(call.expression);
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

function isGated(
  write: ts.CallExpression,
  client: string,
  scope: ts.Node,
  sourceFile: ts.SourceFile,
): boolean {
  return collect(scope, ts.isCallExpression).some((call) => {
    const name = calleeName(call);
    return (
      name !== null &&
      GATE_CALLS.has(name) &&
      call.arguments[0] !== undefined &&
      unwrap(call.arguments[0]).getText(sourceFile) === client &&
      call.getEnd() <= write.getStart(sourceFile)
    );
  });
}

export function scanAssignmentWrites(
  path: string,
  source: string,
): { sites: WriteSite[]; violations: Violation[] } {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const sites: WriteSite[] = [];
  const violations: Violation[] = [];
  const lineOf = (node: ts.Node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
    1;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (
        ts.isPropertyAccessExpression(callee) &&
        WRITE_OPERATIONS.has(callee.name.text)
      ) {
        const delegate = unwrap(callee.expression);
        const isTable =
          (ts.isPropertyAccessExpression(delegate) &&
            delegate.name.text === TABLE) ||
          (ts.isElementAccessExpression(delegate) &&
            ts.isStringLiteralLike(delegate.argumentExpression) &&
            delegate.argumentExpression.text === TABLE);
        if (isTable) {
          const fn = enclosingFunction(node);
          const scope = fn ?? sourceFile;
          const operation = callee.name.text;
          const client = unwrap(delegate.expression).getText(sourceFile);
          sites.push({
            path,
            method: functionName(fn),
            operation,
            activates: writeActivates(node, operation, scope),
            gated: isGated(node, client, scope, sourceFile),
          });
        }
      }
    }
    // Nested relation writes (users.update({ data: { club_role_assignments: { create } } })).
    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node.name) === TABLE &&
      ts.isObjectLiteralExpression(unwrap(node.initializer))
    ) {
      const nested = unwrap(node.initializer) as ts.ObjectLiteralExpression;
      const writes = [
        'create',
        'createMany',
        'connectOrCreate',
        'upsert',
        'update',
        'updateMany',
        'connect',
        'set',
      ];
      if (writes.some((name) => property(nested, name))) {
        violations.push({ path, line: lineOf(node), kind: 'nested-write' });
      }
    }
    // Aliased delegates (const repo = tx.club_role_assignments) escape the scan.
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ((ts.isPropertyAccessExpression(unwrap(node.initializer)) &&
        (unwrap(node.initializer) as ts.PropertyAccessExpression).name.text ===
          TABLE) ||
        (ts.isElementAccessExpression(unwrap(node.initializer)) &&
          ts.isStringLiteralLike(
            (unwrap(node.initializer) as ts.ElementAccessExpression)
              .argumentExpression,
          ) &&
          (
            (unwrap(node.initializer) as ts.ElementAccessExpression)
              .argumentExpression as ts.StringLiteralLike
          ).text === TABLE))
    ) {
      violations.push({ path, line: lineOf(node), kind: 'aliased-delegate' });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // Raw SQL writes (template or string literals anywhere in the file).
  const rawWrite =
    /\b(?:INSERT\s+INTO|UPDATE)\s+(?:"?public"?\s*\.\s*)?"?club_role_assignments"?(?![A-Za-z0-9_])/i;
  for (const literal of collect(
    sourceFile,
    (candidate): candidate is ts.Node =>
      ts.isNoSubstitutionTemplateLiteral(candidate) ||
      ts.isTemplateExpression(candidate) ||
      ts.isStringLiteral(candidate),
  )) {
    if (rawWrite.test(literal.getText(sourceFile))) {
      violations.push({ path, line: lineOf(literal), kind: 'raw-sql-write' });
    }
  }

  return { sites, violations };
}

function productionFiles(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(root, absolute);
    if (
      !entry.name.endsWith('.ts') ||
      entry.name.endsWith('.spec.ts') ||
      entry.name.endsWith('.e2e-spec.ts') ||
      entry.name.endsWith('.d.ts')
    ) {
      return [];
    }
    return [relative(root, absolute).split(sep).join('/')];
  });
}

function scanSource(root: string) {
  const sites: WriteSite[] = [];
  const violations: Violation[] = [];
  for (const path of productionFiles(root)) {
    const source = readFileSync(join(root, path), 'utf8');
    if (!source.includes(TABLE)) continue;
    const result = scanAssignmentWrites(path, source);
    sites.push(...result.sites);
    violations.push(...result.violations);
  }
  return { sites, violations };
}

const format = (site: WriteSite): string =>
  [
    site.path,
    site.method,
    site.operation,
    site.activates ? 'ACTIVATES' : 'no-activation',
    site.gated ? 'gated' : 'ungated',
  ].join(' | ');

/**
 * Every club_role_assignments write in src, classified. Order: path, method,
 * operation (as sorted strings).
 */
const EXPECTED_WRITE_SITES = [
  // annual continuation: reactivation, base placeholder, type-jump create
  'annual-membership/annual-membership.service.ts | AnnualMembershipService._enrollInTransaction | create | ACTIVATES | gated',
  'annual-membership/annual-membership.service.ts | AnnualMembershipService._enrollInTransaction | update | ACTIVATES | gated',
  'annual-membership/annual-membership.service.ts | AnnualMembershipService._enrollInTransaction | update | ACTIVATES | gated',
  // year-cut type jump (skips instead of throwing)
  'annual-membership/annual-membership.service.ts | AnnualMembershipService.writeTypeJumpEnrollment | create | ACTIVATES | gated',
  'annual-membership/annual-membership.service.ts | AnnualMembershipService.writeTypeJumpEnrollment | update | ACTIVATES | gated',
  // not-enrolled placeholder: status 'inactive'
  'annual-membership/annual-membership-policy.service.ts | AnnualMembershipPolicyService.ensureNotEnrolled | create | no-activation | ungated',
  // POST /clubs/:clubId/sections/:sectionId/roles
  'clubs/clubs.service.ts | ClubsService.assignInitialSectionDirector | create | ACTIVATES | gated',
  'clubs/clubs.service.ts | ClubsService.assignRole | create | ACTIVATES | gated',
  // DELETE /club-roles/:assignmentId: status 'ended'
  'clubs/clubs.service.ts | ClubsService.removeRoleAssignment | update | no-activation | ungated',
  'clubs/clubs.service.ts | ClubsService.succeedSectionDirector | create | ACTIVATES | gated',
  // outgoing director: status 'ended'
  'clubs/clubs.service.ts | ClubsService.succeedSectionDirector | update | no-activation | gated',
  // PATCH /club-roles/:assignmentId: dynamic data (dto.status / role change)
  'clubs/clubs.service.ts | ClubsService.updateRoleAssignment | update | ACTIVATES | gated',
  'membership-requests/membership-requests.service.ts | MembershipRequestsService.approve | updateMany | ACTIVATES | gated',
  'membership-requests/membership-requests.service.ts | MembershipRequestsService.cancelPendingForUser | updateMany | no-activation | ungated',
  'membership-requests/membership-requests.service.ts | MembershipRequestsService.expireStaleRequests | updateManyAndReturn | no-activation | ungated',
  'membership-requests/membership-requests.service.ts | MembershipRequestsService.reject | updateMany | no-activation | ungated',
  // club selection: status 'pending' (a request, approved later through approve)
  'post-registration/post-registration.service.ts | PostRegistrationService.resolveMemberAssignment | create | no-activation | ungated',
  'post-registration/post-registration.service.ts | PostRegistrationService.resolveMemberAssignment | update | no-activation | ungated',
  'post-registration/post-registration.service.ts | PostRegistrationService.resolveMemberAssignment | update | no-activation | ungated',
  'requests/requests.service.ts | RequestsService.reviewAssignment | create | ACTIVATES | gated',
  // transfer: moves ACTIVE rows to another section; gated on purpose
  'requests/requests.service.ts | RequestsService.reviewTransfer | updateManyAndReturn | no-activation | gated',
  'year-cut/year-cut.service.ts | YearCutService.activateScheduledPlans | create | ACTIVATES | gated',
  // year end: status 'ended'
  'year-cut/year-cut.service.ts | YearCutService.closeAssignmentsAtOutgoingEnd | updateMany | no-activation | ungated',
].sort();

/** Moves an already active membership to another section: gated too. */
const GATED_BEYOND_ACTIVATION = [
  'requests/requests.service.ts | RequestsService.reviewTransfer',
];

describe('club role activation consent gate inventory (family-profiles C1/C2)', () => {
  const scan = scanSource(join(process.cwd(), 'src'));

  it('classifies every club_role_assignments write in src (snapshot: a new write must be reviewed here)', () => {
    expect(scan.sites.map(format).sort()).toEqual(EXPECTED_WRITE_SITES);
  });

  it('gates every write that can make an assignment active, with the same client, before the write', () => {
    const ungated = scan.sites
      .filter((site) => site.activates && !site.gated)
      .map(format);
    expect(ungated).toEqual([]);
  });

  it('keeps gating the transfer that moves an active membership', () => {
    for (const key of GATED_BEYOND_ACTIVATION) {
      const sites = scan.sites.filter(
        (site) => `${site.path} | ${site.method}` === key,
      );
      expect(sites.length).toBeGreaterThan(0);
      expect(sites.every((site) => site.gated)).toBe(true);
    }
  });

  it('has no raw SQL writes, nested relation writes or aliased delegates of the table in src', () => {
    expect(scan.violations).toEqual([]);
  });

  describe('scanner self-checks (the guard is not vacuous)', () => {
    const one = (source: string) =>
      scanAssignmentWrites('x.ts', `class S {\n${source}\n}`);

    it('treats a create without status as activating (DB default active)', () => {
      const { sites } = one(
        `async m(tx) { await tx.club_role_assignments.create({ data: { user_id: u } }); }`,
      );
      expect(sites).toEqual([
        expect.objectContaining({ activates: true, gated: false }),
      ]);
    });

    it('treats a dynamic status and a mutated data object as activating', () => {
      const dynamic = one(
        `async m(tx, dto) { await tx.club_role_assignments.update({ where: {}, data: { status: dto.status } }); }`,
      );
      const mutated = one(
        `async m(tx, dto) { const d: Record<string, unknown> = {}; d.status = dto.status; await tx.club_role_assignments.update({ where: {}, data: d }); }`,
      );
      expect(dynamic.sites[0].activates).toBe(true);
      expect(mutated.sites[0].activates).toBe(true);
    });

    it('treats literal non-active statuses as non-activating and active: true as activating', () => {
      const pending = one(
        `async m(tx) { await tx.club_role_assignments.update({ where: {}, data: { active: true, status: 'pending' } }); }`,
      );
      const reactivate = one(
        `async m(tx) { await tx.club_role_assignments.updateMany({ where: {}, data: { active: true } }); }`,
      );
      expect(pending.sites[0].activates).toBe(false);
      expect(reactivate.sites[0].activates).toBe(true);
    });

    it('only accepts a gate call made earlier, in the same method, with the same client', () => {
      const ok = one(
        `async m(tx, id) { await assertAssignmentActivationAllowed(tx, id); await tx.club_role_assignments.create({ data: { status: 'active' } }); }`,
      );
      const after = one(
        `async m(tx, id) { await tx.club_role_assignments.create({ data: { status: 'active' } }); await assertAssignmentActivationAllowed(tx, id); }`,
      );
      const otherClient = one(
        `async m(tx, id) { await assertAssignmentActivationAllowed(this.prisma, id); await tx.club_role_assignments.create({ data: { status: 'active' } }); }`,
      );
      const otherMethod = one(
        `async a(tx, id) { await assertAssignmentActivationAllowed(tx, id); }\nasync b(tx) { await tx.club_role_assignments.create({ data: { status: 'active' } }); }`,
      );
      expect(ok.sites[0].gated).toBe(true);
      expect(after.sites[0].gated).toBe(false);
      expect(otherClient.sites[0].gated).toBe(false);
      expect(otherMethod.sites[0].gated).toBe(false);
    });

    it('flags raw SQL writes, nested relation writes and aliased delegates', () => {
      const { violations } = one(
        [
          'async m(tx) {',
          "  await tx.$executeRaw`UPDATE club_role_assignments SET status = 'active'`;",
          '  await tx.$executeRawUnsafe(\'INSERT INTO "club_role_assignments" VALUES (1)\');',
          '  await tx.users.update({ where: {}, data: { club_role_assignments: { create: { role_id: r } } } });',
          '  const repo = tx.club_role_assignments;',
          '}',
        ].join('\n'),
      );
      expect(violations.map((violation) => violation.kind).sort()).toEqual([
        'aliased-delegate',
        'nested-write',
        'raw-sql-write',
        'raw-sql-write',
      ]);
    });

    it('ignores reads', () => {
      const { sites, violations } = one(
        `async m(tx) { await tx.club_role_assignments.findMany({ where: { status: 'active' } }); }`,
      );
      expect(sites).toEqual([]);
      expect(violations).toEqual([]);
    });
  });
});
