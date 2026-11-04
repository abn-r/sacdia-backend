import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

import {
  ASSIGNMENT_QUERY_INVENTORY,
  scanAssignmentQueries,
} from './club-assignment-effectivity.inventory';

export type AccessDecisionFinding = {
  path: string;
  line: number;
  kind: 'users-local-field' | 'assignment-predicate';
  snippet: string;
};

const PRISMA_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

/** Folders/files where deciding access is the point, or that are not runtime code. */
export function isAccessDecisionExcluded(path: string): boolean {
  return (
    path.endsWith('.spec.ts') ||
    path.endsWith('.testing.ts') ||
    path.startsWith('common/authorization/') ||
    path.startsWith('common/guards/')
  );
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function hasLocalFieldKey(root: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      (ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node)) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'local_field_id'
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function isUsersDelegate(expression: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text === 'users';
  }
  if (ts.isElementAccessExpression(expression)) {
    return (
      ts.isStringLiteralLike(expression.argumentExpression) &&
      expression.argumentExpression.text === 'users'
    );
  }
  return false;
}

/**
 * (a) `<client>.users.<op>({ where: { ..., local_field_id } })` and any object
 * typed `Prisma.usersWhereInput` that carries `local_field_id`.
 */
export function scanUsersLocalFieldSource(
  path: string,
  source: string,
): AccessDecisionFinding[] {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const declarations = new Map<string, ts.Expression[]>();
  const collect = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      declarations.set(node.name.text, [
        ...(declarations.get(node.name.text) ?? []),
        node.initializer,
      ]);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const findings: AccessDecisionFinding[] = [];
  const report = (node: ts.Node): void => {
    findings.push({
      path,
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      kind: 'users-local-field',
      snippet: node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 160),
    });
  };
  const carriesKey = (value: ts.Expression): boolean =>
    hasLocalFieldKey(value) ||
    (ts.isIdentifier(value) &&
      (declarations.get(value.text) ?? []).some(hasLocalFieldKey));

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      PRISMA_OPERATIONS.has(node.expression.name.text) &&
      isUsersDelegate(node.expression.expression)
    ) {
      const arg = node.arguments[0];
      const resolved =
        arg && ts.isIdentifier(arg)
          ? (declarations.get(arg.text) ?? [])[0]
          : arg;
      if (resolved && ts.isObjectLiteralExpression(resolved)) {
        for (const property of resolved.properties) {
          if (
            (ts.isPropertyAssignment(property) ||
              ts.isShorthandPropertyAssignment(property)) &&
            ts.isIdentifier(property.name) &&
            property.name.text === 'where'
          ) {
            const where = ts.isPropertyAssignment(property)
              ? property.initializer
              : property.name;
            if (carriesKey(where)) report(node);
          }
        }
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.type &&
      /usersWhereInput\b/.test(node.type.getText(sourceFile)) &&
      node.initializer &&
      hasLocalFieldKey(node.initializer)
    ) {
      report(node);
    }
    if (
      ts.isFunctionLike(node) &&
      node.type &&
      /usersWhereInput\b/.test(node.type.getText(sourceFile)) &&
      'body' in node &&
      node.body &&
      hasLocalFieldKey(node.body)
    ) {
      report(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

export function scanAccessDecisionLocality(
  sourceRoot: string,
): AccessDecisionFinding[] {
  const usersFindings = sourceFiles(sourceRoot).flatMap((file) => {
    const path = relative(sourceRoot, file).split(sep).join('/');
    return isAccessDecisionExcluded(path)
      ? []
      : scanUsersLocalFieldSource(path, readFileSync(file, 'utf8'));
  });

  // `allowlist` owners are workflow/non-authority queries; T08/T09 are the
  // assignment predicates still deciding access, owned by later phases.
  const pending = new Set(
    ASSIGNMENT_QUERY_INVENTORY.filter(({ owner }) => owner !== 'allowlist').map(
      ({ path }) => path,
    ),
  );
  const assignmentFindings = scanAssignmentQueries(sourceRoot)
    .filter(({ path }) => pending.has(path) && !isAccessDecisionExcluded(path))
    .map(({ path, line, kind }): AccessDecisionFinding => ({
      path,
      line,
      kind: 'assignment-predicate',
      snippet: `club_role_assignments predicate (${kind})`,
    }));

  return [...usersFindings, ...assignmentFindings];
}
