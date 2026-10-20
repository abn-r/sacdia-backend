import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { assertAssignmentActivationAllowed } from './assignment-activation-gate';

/**
 * Guard for family-profiles verify 2c C1/C2 (+ r2 W-N1): EVERY production write
 * that can make a `club_role_assignments` row ACTIVE must call the shared
 * consent gate (`assignment-activation-gate.ts`) with the SAME client and the
 * SAME user, BEFORE the write, on a path that always runs.
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
 *  - it is GATED when a gate call (a) takes the same client expression as the
 *    write, (b) takes the same USER expression as the write (`data.user_id` of
 *    a create, `where.user_id` of an update) or, when the user is not
 *    statically visible in the write (update by assignment_id, opaque data),
 *    the user named by an explicit `// activation-gate: <expr>` comment on the
 *    write's statement, and (c) DOMINATES the write: it is a statement of a
 *    block that contains the write, earlier in source order, either
 *    `await assert...(...)` or `if (!(await isAssignmentActivationAllowed(...)))
 *    { ...exit }`. A gate inside a conditional or dead branch does not count,
 *    except for a write annotated `// activation-gate-when: <condition>` (the
 *    write only activates under that condition, e.g. a PATCH whose status is
 *    dynamic), which accepts the gate as the body of one plain `if` (no else,
 *    constant-false conditions never count).
 *
 * Everything that could hide a write from this scan is a violation:
 *  - raw SQL writes;
 *  - nested relation writes through ANY relation field that targets the table
 *    (names derived from prisma/schema.prisma, e.g. activated_assignment,
 *    outgoing_assignment), and nested values the scan cannot read (a variable
 *    or spread inside a write payload);
 *  - delegates held, destructured or handed on (`const repo = tx.<table>`,
 *    `const { <table>: repo } = tx`, `helper(tx.<table>)`), unless the statement
 *    carries `// activation-gate-allow: <reason>`.
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
const READ_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);
const CREATE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
]);
/** Keys of a nested relation write payload. */
const NESTED_WRITE_KEYS = [
  'create',
  'createMany',
  'connectOrCreate',
  'upsert',
  'update',
  'updateMany',
  'connect',
  'set',
];
/** `assertApprovable` is ConsentGateService's thin delegate to the helper. */
const ASSERT_GATES = new Set([
  'assertAssignmentActivationAllowed',
  'assertApprovable',
]);
/** Boolean form: only accepted as `if (!(await gate(...))) { ...exit }`. */
const BOOLEAN_GATES = new Set(['isAssignmentActivationAllowed']);
const TABLE = 'club_role_assignments';
const GATE_ANNOTATION = /activation-gate:\s*([^\s*][^\n*]*?)\s*(?:\*\/)?\s*$/m;
const ALLOW_ANNOTATION = /activation-gate-allow:\s*\S/;
const WHEN_ANNOTATION = /activation-gate-when:\s*\S/;

/**
 * Every field of a model whose type is `club_role_assignments` (the table's own
 * name plus aliases like `activated_assignment`), from the Prisma schema.
 */
export function loadRelationNames(schema: string): Set<string> {
  const names = new Set<string>([TABLE]);
  const field = new RegExp(
    `^\\s*(\\w+)\\s+${TABLE}(?:\\[\\]|\\?)?\\s*(?:@.*)?$`,
    'gm',
  );
  for (const match of schema.matchAll(field)) {
    if (match[1] !== 'model') names.add(match[1]);
  }
  return names;
}

const RELATION_NAMES = loadRelationNames(
  readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8'),
);

type WriteSite = {
  path: string;
  method: string;
  operation: string;
  activates: boolean;
  gated: boolean;
};

type Violation = { path: string; line: number; kind: string };

function isWrapper(node: ts.Node): node is ts.Expression {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  );
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (isWrapper(current)) {
    current = (current as ts.ParenthesizedExpression).expression;
  }
  return current;
}

/** Climb out of parentheses / casts / non-null (not `await`). */
function outermost(node: ts.Node): ts.Node {
  let current = node;
  while (current.parent && isWrapper(current.parent)) current = current.parent;
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

function valueOf(
  argument: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  const element = property(argument, name);
  if (!element) return undefined;
  if (ts.isPropertyAssignment(element)) return element.initializer;
  return ts.isShorthandPropertyAssignment(element) ? element.name : undefined;
}

function writeActivates(
  call: ts.CallExpression,
  operation: string,
  scope: ts.Node,
): boolean {
  const argument = call.arguments[0] ? unwrap(call.arguments[0]) : null;
  if (!argument || !ts.isObjectLiteralExpression(argument)) return true;
  if (operation === 'upsert') {
    return (
      dataActivates(valueOf(argument, 'create'), scope, true) ||
      dataActivates(valueOf(argument, 'update'), scope, false)
    );
  }
  return dataActivates(
    valueOf(argument, 'data'),
    scope,
    CREATE_OPERATIONS.has(operation),
  );
}

/** The user a literal object names through `user_id`, as source text. */
function userOf(
  object: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): string | null {
  if (object.properties.some(ts.isSpreadAssignment)) return null;
  const element = property(object, 'user_id');
  if (!element) return null;
  if (ts.isShorthandPropertyAssignment(element)) return element.name.text;
  if (!ts.isPropertyAssignment(element)) return null;
  const initializer = unwrap(element.initializer);
  if (
    ts.isObjectLiteralExpression(initializer) ||
    ts.isArrayLiteralExpression(initializer)
  ) {
    return null; // a filter ({ in: [...] }), not one user
  }
  return initializer.getText(sourceFile);
}

/**
 * The user the write targets when the source says so: `data.user_id` of a
 * create, `where.user_id` of an update. Null when not statically visible.
 */
function writeUser(
  call: ts.CallExpression,
  operation: string,
  scope: ts.Node,
  sourceFile: ts.SourceFile,
): string | null {
  const argument = call.arguments[0] ? unwrap(call.arguments[0]) : null;
  if (!argument || !ts.isObjectLiteralExpression(argument)) return null;
  if (CREATE_OPERATIONS.has(operation) || operation === 'upsert') {
    const raw = valueOf(argument, operation === 'upsert' ? 'create' : 'data');
    const data = raw ? resolveData(raw, scope) : null;
    if (!data) return null;
    const objects = ts.isArrayLiteralExpression(data)
      ? data.elements.map((element) => unwrap(element))
      : [data];
    const users = objects.map((object) =>
      ts.isObjectLiteralExpression(object) ? userOf(object, sourceFile) : null,
    );
    if (users.length === 0 || users.some((user) => user === null)) return null;
    return new Set(users).size === 1 ? users[0] : null;
  }
  const where = valueOf(argument, 'where');
  const filter = where ? unwrap(where) : null;
  return filter && ts.isObjectLiteralExpression(filter)
    ? userOf(filter, sourceFile)
    : null;
}

function calleeName(call: ts.CallExpression): string | null {
  const callee = unwrap(call.expression);
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

function isContainerChild(statement: ts.Node): boolean {
  const parent = statement.parent;
  return (
    !!parent &&
    (ts.isBlock(parent) ||
      ts.isSourceFile(parent) ||
      ts.isCaseClause(parent) ||
      ts.isDefaultClause(parent) ||
      ts.isModuleBlock(parent))
  );
}

function exits(statement: ts.Statement): boolean {
  if (ts.isBlock(statement)) {
    const last = statement.statements[statement.statements.length - 1];
    return last !== undefined && exits(last);
  }
  return (
    ts.isReturnStatement(statement) ||
    ts.isThrowStatement(statement) ||
    ts.isContinueStatement(statement) ||
    ts.isBreakStatement(statement)
  );
}

function climb(node: ts.Node, includeAwait: boolean): ts.Node {
  let current = node;
  while (
    current.parent &&
    (isWrapper(current.parent) ||
      (includeAwait && ts.isAwaitExpression(current.parent)))
  ) {
    current = current.parent;
  }
  return current;
}

/**
 * The statement that guarantees the gate ran (and, for the boolean form, that
 * the flow stopped when it said no) for everything after it in its block.
 */
function guaranteeingStatement(
  gate: ts.CallExpression,
  name: string,
): ts.Statement | null {
  let node = climb(gate, true);
  if (BOOLEAN_GATES.has(name)) {
    const negation = node.parent;
    if (
      !negation ||
      !ts.isPrefixUnaryExpression(negation) ||
      negation.operator !== ts.SyntaxKind.ExclamationToken
    ) {
      return null;
    }
    node = climb(negation, false);
    const branch = node.parent;
    if (
      !branch ||
      !ts.isIfStatement(branch) ||
      branch.expression !== node ||
      !exits(branch.thenStatement)
    ) {
      return null;
    }
    return isContainerChild(branch) ? branch : null;
  }
  const statement = node.parent;
  if (!statement || !ts.isExpressionStatement(statement)) return null;
  return isContainerChild(statement) ? statement : null;
}

function isConstantFalse(expression: ts.Expression): boolean {
  const node = unwrap(expression);
  return (
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(node) && node.text === 'undefined') ||
    (ts.isNumericLiteral(node) && Number(node.text) === 0) ||
    (ts.isStringLiteralLike(node) && node.text === '')
  );
}

/**
 * For a write annotated `activation-gate-when`: the gate as the plain
 * `await assert...(...)` statement of the block of ONE `if` (no else, not a
 * constant-false condition); that `if` is then the guaranteeing statement.
 */
function conditionalStatement(
  gate: ts.CallExpression,
  name: string,
): ts.Statement | null {
  if (!ASSERT_GATES.has(name)) return null;
  const statement = climb(gate, true).parent;
  if (
    !statement ||
    !ts.isExpressionStatement(statement) ||
    !statement.parent ||
    !ts.isBlock(statement.parent)
  ) {
    return null;
  }
  const branch = statement.parent.parent;
  if (
    !branch ||
    !ts.isIfStatement(branch) ||
    branch.thenStatement !== statement.parent ||
    branch.elseStatement !== undefined ||
    isConstantFalse(branch.expression) ||
    !isContainerChild(branch)
  ) {
    return null;
  }
  return branch;
}

/** The statement (child of a block) a node lives in. */
function enclosingStatement(node: ts.Node): ts.Node {
  let current = node;
  while (current.parent && !isContainerChild(current)) current = current.parent;
  return current;
}

function leadingComments(node: ts.Node, sourceFile: ts.SourceFile): string {
  const ranges =
    ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? [];
  return ranges
    .map((range) => sourceFile.text.slice(range.pos, range.end))
    .join('\n');
}

/** `// activation-gate: <expr>` on the statement of the node. */
function annotatedUser(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): string | null {
  const match = GATE_ANNOTATION.exec(
    leadingComments(enclosingStatement(node), sourceFile),
  );
  return match ? match[1].trim() : null;
}

/** `// activation-gate-allow: <reason>` on the node or its statement. */
function isAllowed(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  return (
    ALLOW_ANNOTATION.test(leadingComments(node, sourceFile)) ||
    ALLOW_ANNOTATION.test(leadingComments(enclosingStatement(node), sourceFile))
  );
}

function isGated(
  write: ts.CallExpression,
  client: string,
  user: string | null,
  activates: boolean,
  conditional: boolean,
  scope: ts.Node,
  sourceFile: ts.SourceFile,
): boolean {
  return collect(scope, ts.isCallExpression).some((call) => {
    const name = calleeName(call);
    if (
      name === null ||
      !(ASSERT_GATES.has(name) || BOOLEAN_GATES.has(name)) ||
      call.arguments[0] === undefined ||
      unwrap(call.arguments[0]).getText(sourceFile) !== client
    ) {
      return false;
    }
    const dominates = (statement: ts.Statement | null): boolean =>
      statement !== null &&
      statement.getEnd() <= write.getStart(sourceFile) &&
      statement.parent.getStart(sourceFile) <= write.getStart(sourceFile) &&
      write.getEnd() <= statement.parent.getEnd();
    if (
      !dominates(guaranteeingStatement(call, name)) &&
      !(conditional && dominates(conditionalStatement(call, name)))
    ) {
      return false;
    }
    if (user === null) return !activates; // nothing to bind a non-activating write to
    return (
      call.arguments[1] !== undefined &&
      unwrap(call.arguments[1]).getText(sourceFile) === user
    );
  });
}

/** `<client>.<table>` / `<client>['<table>']`: the client expression, else null. */
function tableAccessBase(node: ts.Node): ts.Expression | null {
  if (ts.isPropertyAccessExpression(node) && node.name.text === TABLE) {
    return node.expression;
  }
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    node.argumentExpression.text === TABLE
  ) {
    return node.expression;
  }
  return null;
}

/** tx / this.prisma / db ...: a Prisma client, not a row holding a relation. */
function isClientLike(expression: ts.Expression, sourceFile: ts.SourceFile) {
  return /(?:^|\.)\w*(?:tx|trx|prisma|db|client|transaction)$/i.test(
    unwrap(expression).getText(sourceFile),
  );
}

const CLIENT_TYPE = /TransactionClient|PrismaService|PrismaClient|Pick</;

/** Inside the payload of a write (data/create/update) or a Prisma *Input type. */
function inWritePayload(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isPropertyAssignment(current) &&
      ['data', 'create', 'update'].includes(propertyName(current.name) ?? '')
    ) {
      return true;
    }
    if (
      (ts.isVariableDeclaration(current) && current.type) ||
      ts.isSatisfiesExpression(current) ||
      ts.isAsExpression(current)
    ) {
      const type = ts.isVariableDeclaration(current)
        ? current.type
        : current.type;
      if (
        type &&
        /(?:Create|Update|Upsert)\w*Input/.test(type.getText(sourceFile))
      ) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

export function scanAssignmentWrites(
  path: string,
  source: string,
  relationNames: ReadonlySet<string> = RELATION_NAMES,
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
  const flag = (node: ts.Node, kind: string) =>
    violations.push({ path, line: lineOf(node), kind });

  const handleDelegate = (node: ts.Node, base: ts.Expression): void => {
    const delegate = outermost(node);
    const parent = delegate.parent;
    if (
      parent &&
      ts.isPropertyAccessExpression(parent) &&
      parent.expression === delegate
    ) {
      const operation = parent.name.text;
      const method = outermost(parent);
      const call = method.parent;
      const called =
        !!call && ts.isCallExpression(call) && call.expression === method;
      if (called && WRITE_OPERATIONS.has(operation)) {
        const fn = enclosingFunction(call);
        const scope = fn ?? sourceFile;
        const client = unwrap(base).getText(sourceFile);
        const activates = writeActivates(call, operation, scope);
        const user =
          writeUser(call, operation, scope, sourceFile) ??
          annotatedUser(call, sourceFile);
        sites.push({
          path,
          method: functionName(fn),
          operation,
          activates,
          gated: isGated(
            call,
            client,
            user,
            activates,
            WHEN_ANNOTATION.test(
              leadingComments(enclosingStatement(call), sourceFile),
            ),
            scope,
            sourceFile,
          ),
        });
        return;
      }
      if (called && READ_OPERATIONS.has(operation)) return;
      // A write method that is not called (`const f = tx.<table>.create`), or
      // any other use of a client's delegate.
      if (
        (WRITE_OPERATIONS.has(operation) || isClientLike(base, sourceFile)) &&
        !isAllowed(node, sourceFile)
      ) {
        flag(node, 'delegate-escape');
      }
      return;
    }
    if (
      parent &&
      ts.isElementAccessExpression(parent) &&
      parent.expression === delegate
    ) {
      // tx.<table>['create'](...) / tx.<table>[op](...); a numeric index is a
      // relation array read (user.<table>[0]).
      const key = parent.argumentExpression;
      if (
        (isClientLike(base, sourceFile) ||
          (ts.isStringLiteralLike(key) && WRITE_OPERATIONS.has(key.text))) &&
        !isAllowed(node, sourceFile)
      ) {
        flag(node, 'delegate-escape');
      }
      return;
    }
    if (
      parent &&
      ts.isVariableDeclaration(parent) &&
      parent.initializer === delegate
    ) {
      flag(node, 'aliased-delegate');
      return;
    }
    if (isClientLike(base, sourceFile) && !isAllowed(node, sourceFile)) {
      flag(node, 'delegate-escape');
    }
  };

  const visit = (node: ts.Node): void => {
    const base = tableAccessBase(node);
    if (base) handleDelegate(node, base);

    // Nested relation writes through any relation field that targets the table
    // (users.update({ data: { club_role_assignments: { create } } }),
    // director_succession_plans.update({ data: { activated_assignment: { connect } } })).
    if (
      (ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node)) &&
      relationNames.has(propertyName(node.name) ?? '')
    ) {
      const value = ts.isPropertyAssignment(node)
        ? unwrap(node.initializer)
        : node.name;
      if (ts.isObjectLiteralExpression(value)) {
        if (
          NESTED_WRITE_KEYS.some((name) => property(value, name)) &&
          !isAllowed(node, sourceFile)
        ) {
          flag(node, 'nested-write');
        } else if (
          value.properties.some(ts.isSpreadAssignment) &&
          inWritePayload(node, sourceFile) &&
          !isAllowed(node, sourceFile)
        ) {
          flag(node, 'nested-opaque');
        }
      } else if (
        value.kind !== ts.SyntaxKind.TrueKeyword &&
        value.kind !== ts.SyntaxKind.FalseKeyword &&
        value.kind !== ts.SyntaxKind.NullKeyword &&
        !(ts.isIdentifier(value) && value.text === 'undefined') &&
        inWritePayload(node, sourceFile) &&
        !isAllowed(node, sourceFile)
      ) {
        // A variable / call / spread we cannot read inside a write payload.
        flag(node, 'nested-opaque');
      }
    }

    // Destructured delegates: const { club_role_assignments: repo } = tx.
    if (
      ts.isBindingElement(node) &&
      ts.isObjectBindingPattern(node.parent) &&
      !node.dotDotDotToken
    ) {
      const key = node.propertyName
        ? ts.isIdentifier(node.propertyName) ||
          ts.isStringLiteralLike(node.propertyName)
          ? node.propertyName.text
          : null
        : ts.isIdentifier(node.name)
          ? node.name.text
          : null;
      if (key === TABLE) {
        const owner = node.parent.parent;
        const bound = ts.isIdentifier(node.name) ? node.name.text : null;
        const scope = enclosingFunction(node) ?? sourceFile;
        const usedToWrite =
          bound !== null &&
          collect(scope, ts.isPropertyAccessExpression).some(
            (access) =>
              ts.isIdentifier(access.expression) &&
              access.expression.text === bound &&
              WRITE_OPERATIONS.has(access.name.text),
          );
        const fromClient =
          (ts.isVariableDeclaration(owner) &&
            !!owner.initializer &&
            isClientLike(owner.initializer, sourceFile)) ||
          (ts.isParameter(owner) &&
            !!owner.type &&
            CLIENT_TYPE.test(owner.type.getText(sourceFile)));
        if ((fromClient || usedToWrite) && !isAllowed(node, sourceFile)) {
          flag(node, 'destructured-delegate');
        }
      }
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
    const kinds = (source: string) =>
      one(source)
        .violations.map((violation) => violation.kind)
        .sort();
    const ACTIVE_CREATE = `await tx.club_role_assignments.create({ data: { user_id: u, status: 'active' } });`;

    it('derives the relation fields that target the table from the Prisma schema', () => {
      expect([...RELATION_NAMES]).toEqual(
        expect.arrayContaining([
          'club_role_assignments',
          'activated_assignment',
          'outgoing_assignment',
        ]),
      );
      expect(
        loadRelationNames(
          [
            'model a {',
            '  alias_one   club_role_assignments? @relation("x")',
            '  alias_many  club_role_assignments[]',
            '  other       users',
            '}',
            'model club_role_assignments {',
            '}',
          ].join('\n'),
        ),
      ).toEqual(new Set(['club_role_assignments', 'alias_one', 'alias_many']));
    });

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
        `async m(tx, u) { await assertAssignmentActivationAllowed(tx, u); ${ACTIVE_CREATE} }`,
      );
      const after = one(
        `async m(tx, u) { ${ACTIVE_CREATE} await assertAssignmentActivationAllowed(tx, u); }`,
      );
      const otherClient = one(
        `async m(tx, u) { await assertAssignmentActivationAllowed(this.prisma, u); ${ACTIVE_CREATE} }`,
      );
      const otherMethod = one(
        `async a(tx, u) { await assertAssignmentActivationAllowed(tx, u); }\nasync b(tx, u) { ${ACTIVE_CREATE} }`,
      );
      expect(ok.sites[0].gated).toBe(true);
      expect(after.sites[0].gated).toBe(false);
      expect(otherClient.sites[0].gated).toBe(false);
      expect(otherMethod.sites[0].gated).toBe(false);
    });

    describe('gate binding (W-N1)', () => {
      it('rejects a gate for ANOTHER user than the one the write names', () => {
        const forOther = one(
          `async m(tx, u, v) { await assertAssignmentActivationAllowed(tx, v); ${ACTIVE_CREATE} }`,
        );
        const forSame = one(
          `async m(tx, u, v) { await assertAssignmentActivationAllowed(tx, u); ${ACTIVE_CREATE} }`,
        );
        const updateOther = one(
          `async m(tx, u, v) { await assertAssignmentActivationAllowed(tx, v); await tx.club_role_assignments.updateMany({ where: { user_id: u }, data: { status: 'active' } }); }`,
        );
        expect(forOther.sites[0].gated).toBe(false);
        expect(forSame.sites[0].gated).toBe(true);
        expect(updateOther.sites[0].gated).toBe(false);
      });

      it('compares every user of a createMany: a mixed batch is never gated by one user', () => {
        const mixed = one(
          `async m(tx) { await assertAssignmentActivationAllowed(tx, a); await tx.club_role_assignments.createMany({ data: [{ user_id: a, status: 'active' }, { user_id: b, status: 'active' }] }); }`,
        );
        expect(mixed.sites[0].gated).toBe(false);
      });

      it('requires an annotation when the user is not visible in the write', () => {
        const write = `await tx.club_role_assignments.update({ where: { assignment_id: id }, data: { status: 'active' } });`;
        const bare = one(
          `async m(tx, id, u) { await assertAssignmentActivationAllowed(tx, u); ${write} }`,
        );
        const annotated = one(
          `async m(tx, id, u) { await assertAssignmentActivationAllowed(tx, u);\n// activation-gate: u\n${write} }`,
        );
        const wrongAnnotation = one(
          `async m(tx, id, u, v) { await assertAssignmentActivationAllowed(tx, v);\n// activation-gate: u\n${write} }`,
        );
        const noGate = one(
          `async m(tx, id, u) {\n// activation-gate: u\n${write} }`,
        );
        expect(bare.sites[0].gated).toBe(false);
        expect(annotated.sites[0].gated).toBe(true);
        expect(wrongAnnotation.sites[0].gated).toBe(false);
        // The annotation names the user; it never replaces the gate call.
        expect(noGate.sites[0].gated).toBe(false);
      });

      it('does not count a gate in a dead or conditional branch', () => {
        const dead = one(
          `async m(tx, u) { if (false) { await assertAssignmentActivationAllowed(tx, u); } ${ACTIVE_CREATE} }`,
        );
        const conditional = one(
          `async m(tx, u, c) { if (c) { await assertAssignmentActivationAllowed(tx, u); } ${ACTIVE_CREATE} }`,
        );
        const shortCircuit = one(
          `async m(tx, u, c) { c && (await assertAssignmentActivationAllowed(tx, u)); ${ACTIVE_CREATE} }`,
        );
        const ternary = one(
          `async m(tx, u, c) { c ? await assertAssignmentActivationAllowed(tx, u) : null; ${ACTIVE_CREATE} }`,
        );
        const callback = one(
          `async m(tx, u, xs) { xs.forEach(async () => { await assertAssignmentActivationAllowed(tx, u); }); ${ACTIVE_CREATE} }`,
        );
        const swallowed = one(
          `async m(tx, u) { await assertAssignmentActivationAllowed(tx, u).catch(() => undefined); ${ACTIVE_CREATE} }`,
        );
        const tryBlock = one(
          `async m(tx, u) { try { await assertAssignmentActivationAllowed(tx, u); } catch {} ${ACTIVE_CREATE} }`,
        );
        for (const result of [
          dead,
          conditional,
          shortCircuit,
          ternary,
          callback,
          swallowed,
          tryBlock,
        ]) {
          expect(result.sites[0].gated).toBe(false);
        }
      });

      it('accepts the boolean gate only as `if (!(await gate(...))) { exit }` before the write', () => {
        const exitsIf = (body: string) =>
          one(
            `async m(tx, u) { if (!(await isAssignmentActivationAllowed(tx, u))) ${body} ${ACTIVE_CREATE} }`,
          );
        expect(exitsIf(`{ return; }`).sites[0].gated).toBe(true);
        expect(exitsIf(`{ log(); continue; }`).sites[0].gated).toBe(true);
        expect(exitsIf(`{ throw new Error(); }`).sites[0].gated).toBe(true);
        // does not stop the flow
        expect(exitsIf(`{ log(); }`).sites[0].gated).toBe(false);
        // wrong polarity
        const positive = one(
          `async m(tx, u) { if (await isAssignmentActivationAllowed(tx, u)) { return; } ${ACTIVE_CREATE} }`,
        );
        // result ignored / held in a variable
        const held = one(
          `async m(tx, u) { const ok = await isAssignmentActivationAllowed(tx, u); ${ACTIVE_CREATE} }`,
        );
        // the write sits inside the if instead of after it
        const inside = one(
          `async m(tx, u) { if (!(await isAssignmentActivationAllowed(tx, u))) { ${ACTIVE_CREATE} return; } }`,
        );
        expect(positive.sites[0].gated).toBe(false);
        expect(held.sites[0].gated).toBe(false);
        expect(inside.sites[0].gated).toBe(false);
      });

      it('accepts a conditional gate only for a write annotated activation-gate-when', () => {
        const body = `if (c) { await assertAssignmentActivationAllowed(tx, u); }`;
        const write = `await tx.club_role_assignments.update({ where: { assignment_id: id }, data });`;
        const plain = one(
          `async m(tx, id, u, c, data) { ${body}\n// activation-gate: u\n${write} }`,
        );
        const annotated = one(
          `async m(tx, id, u, c, data) { ${body}\n// activation-gate: u\n// activation-gate-when: c\n${write} }`,
        );
        const dead = one(
          `async m(tx, id, u, c, data) { if (false) { await assertAssignmentActivationAllowed(tx, u); }\n// activation-gate: u\n// activation-gate-when: c\n${write} }`,
        );
        const withElse = one(
          `async m(tx, id, u, c, data) { if (c) { await assertAssignmentActivationAllowed(tx, u); } else { log(); }\n// activation-gate: u\n// activation-gate-when: c\n${write} }`,
        );
        expect(plain.sites[0].gated).toBe(false);
        expect(annotated.sites[0].gated).toBe(true);
        expect(dead.sites[0].gated).toBe(false);
        expect(withElse.sites[0].gated).toBe(false);
      });
    });

    it('flags raw SQL writes, nested relation writes and aliased delegates', () => {
      expect(
        kinds(
          [
            'async m(tx) {',
            "  await tx.$executeRaw`UPDATE club_role_assignments SET status = 'active'`;",
            '  await tx.$executeRawUnsafe(\'INSERT INTO "club_role_assignments" VALUES (1)\');',
            '  await tx.users.update({ where: {}, data: { club_role_assignments: { create: { role_id: r } } } });',
            '  const repo = tx.club_role_assignments;',
            '}',
          ].join('\n'),
        ),
      ).toEqual([
        'aliased-delegate',
        'nested-write',
        'raw-sql-write',
        'raw-sql-write',
      ]);
    });

    describe('forms that used to escape the scan (W-N1) now fail the guard', () => {
      it('destructured delegates, renamed or not, and as a parameter', () => {
        expect(
          kinds(
            `async m(tx) { const { club_role_assignments: repo } = tx; await repo.create({ data: { user_id: u } }); }`,
          ),
        ).toEqual(['destructured-delegate']);
        expect(
          kinds(
            `async m(tx) { const { club_role_assignments } = this.prisma; return club_role_assignments; }`,
          ),
        ).toEqual(['destructured-delegate']);
        expect(
          kinds(
            `async m({ club_role_assignments }: Prisma.TransactionClient) { await club_role_assignments.update({ where: {}, data: {} }); }`,
          ),
        ).toEqual(['destructured-delegate']);
        expect(
          kinds(
            `async m(row) { const { club_role_assignments: repo } = row; await repo.updateMany({ where: {}, data: {} }); }`,
          ),
        ).toEqual(['destructured-delegate']);
      });

      it('does not flag reading the relation array of a loaded row', () => {
        expect(
          kinds(
            `async m(row) { const { club_role_assignments } = row; return club_role_assignments.map((a) => a.role_id); }\nasync n(user) { return user.club_role_assignments[0] ?? user?.club_role_assignments?.length; }`,
          ),
        ).toEqual([]);
      });

      it('nested writes through every relation field that targets the table', () => {
        for (const relation of [
          'activated_assignment',
          'outgoing_assignment',
        ]) {
          expect(
            kinds(
              `async m(tx) { await tx.director_succession_plans.update({ where: {}, data: { ${relation}: { create: { user_id: u, status: 'active' } } } }); }`,
            ),
          ).toEqual(['nested-write']);
          expect(
            kinds(
              `async m(tx) { await tx.director_succession_plans.update({ where: {}, data: { ${relation}: { connect: { assignment_id: a } } } }); }`,
            ),
          ).toEqual(['nested-write']);
        }
        expect(
          kinds(
            `async m(tx) { await tx.users.update({ where: {}, data: { club_role_assignments: { updateMany: { where: {}, data: { status: 'active' } } } } }); }`,
          ),
        ).toEqual(['nested-write']);
      });

      it('does not flag reading through those relation fields', () => {
        expect(
          kinds(
            `async m(tx) { await tx.director_succession_plans.findMany({ include: { activated_assignment: { select: { user_id: true } }, outgoing_assignment: true }, where: { club_role_assignments: { some: { status: 'active' } } } }); }`,
          ),
        ).toEqual([]);
      });

      it('a delegate handed to a helper, returned or stored', () => {
        expect(
          kinds(`async m(tx) { await helper(tx.club_role_assignments); }`),
        ).toEqual(['delegate-escape']);
        expect(
          kinds(`async m() { return this.prisma.club_role_assignments; }`),
        ).toEqual(['delegate-escape']);
        expect(
          kinds(`async m(tx) { this.repo = tx['club_role_assignments']; }`),
        ).toEqual(['delegate-escape']);
        expect(
          kinds(`async m(tx) { const f = tx.club_role_assignments.create; }`),
        ).toEqual(['delegate-escape']);
        expect(
          kinds(
            `async m(tx) { await tx.club_role_assignments['create']({ data: {} }); }`,
          ),
        ).toEqual(['delegate-escape']);
      });

      it('an allowlist annotation clears a classified escape', () => {
        expect(
          kinds(
            `async m(tx) {\n// activation-gate-allow: read-only helper, audited in x.service.ts\nawait helper(tx.club_role_assignments); }`,
          ),
        ).toEqual([]);
        expect(
          kinds(
            `async m(tx) {\n// activation-gate-allow:\nawait helper(tx.club_role_assignments); }`,
          ),
        ).toEqual(['delegate-escape']);
      });

      it('a nested value held in a variable or spread inside a write payload', () => {
        expect(
          kinds(
            `async m(tx) { const nested = { create: { user_id: u } }; await tx.users.update({ where: {}, data: { club_role_assignments: nested } }); }`,
          ),
        ).toEqual(['nested-opaque']);
        expect(
          kinds(
            `async m(tx) { const nested = { connect: { assignment_id: a } }; await tx.director_succession_plans.create({ data: { activated_assignment: nested } }); }`,
          ),
        ).toEqual(['nested-opaque']);
        expect(
          kinds(
            `async m(tx) { await tx.users.update({ where: {}, data: { club_role_assignments: { ...extra } } }); }`,
          ),
        ).toEqual(['nested-opaque']);
        expect(
          kinds(
            `async m(tx, club_role_assignments) { await tx.users.update({ where: {}, data: { club_role_assignments } }); }`,
          ),
        ).toEqual(['nested-opaque']);
        expect(
          kinds(
            `async m(tx) { const data: Prisma.usersUpdateInput = { club_role_assignments: nested }; await tx.users.update({ where: {}, data }); }`,
          ),
        ).toEqual(['nested-opaque']);
      });

      it('does not flag the same key outside a write payload', () => {
        expect(
          kinds(
            `async m(tx) { await tx.users.findMany({ include: { club_role_assignments: assignmentInclude } }); return { club_role_assignments: user.club_role_assignments }; }`,
          ),
        ).toEqual([]);
      });
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

/**
 * Phase 3a (FP3-01/FP3-02): the gate is keyed on AGE, not on a dependent
 * profile. These checks keep the inventory honest about that: the seven files
 * that run the gate are the expected ones, the gate source encodes the
 * age-based rule, and the real gate refuses a 16-year-old without consent.
 */
describe('activation gate is age-based (family-profiles phase 3a)', () => {
  const srcRoot = join(process.cwd(), 'src');
  const gateSource = readFileSync(
    join(srcRoot, 'membership-requests/assignment-activation-gate.ts'),
    'utf8',
  );

  const GATE_HELPERS =
    /\b(?:assertAssignmentActivationAllowed|isAssignmentActivationAllowed|lockActivationDependentsAscending|assertApprovable)\b/;
  const EXPECTED_GATE_FILES = [
    'annual-membership/annual-membership.service.ts',
    'clubs/clubs.service.ts',
    'membership-requests/assignment-activation-gate.ts',
    'membership-requests/consent-gate.service.ts',
    'membership-requests/membership-requests.service.ts',
    'requests/requests.service.ts',
    'year-cut/year-cut.service.ts',
  ];

  it('is invoked by exactly the seven expected activating files', () => {
    const files = productionFiles(srcRoot).filter((path) =>
      GATE_HELPERS.test(readFileSync(join(srcRoot, path), 'utf8')),
    );
    expect(files.sort()).toEqual(EXPECTED_GATE_FILES);
  });

  it('encodes the age rule: country majority, calendar math in the country TZ, NULL birthday fails closed', () => {
    expect(gateSource).toMatch(/ageToday\(/);
    expect(gateSource).toMatch(/ageOfMajority/);
    expect(gateSource).toMatch(/age_of_majority/);
    expect(gateSource).toMatch(/!user\.birthday|!birthday/);
    // It reads the users row (birthday), not only the dependent profile table.
    expect(gateSource).toMatch(/tx\.users\.findUnique|db\.users\.findMany/);
    expect(gateSource).not.toMatch(/tx\.dependent_profiles\.findUnique/);
  });

  it('the real gate refuses a 16-year-old with no consent (409 MR_CONSENT_NOT_VERIFIED)', async () => {
    const birthday = new Date();
    birthday.setUTCFullYear(birthday.getUTCFullYear() - 16);
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      users: {
        findUnique: jest.fn().mockResolvedValue({
          birthday,
          country_id: null,
          dependent_profile: null,
        }),
      },
      guardianships: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    await expect(
      assertAssignmentActivationAllowed(tx as never, 'teen-1'),
    ).rejects.toMatchObject({ code: 'MR_CONSENT_NOT_VERIFIED', status: 409 });
  });

  it('still classifies the director-create site as a TODO for 3c (not present yet)', () => {
    // The director-create inventory line lands with 3c; nothing in src writes
    // club_role_assignments from a guardianships service today.
    const sites = scanSource(srcRoot).sites.map(format);
    expect(sites.some((site) => site.startsWith('guardianships/'))).toBe(false);
  });
});
