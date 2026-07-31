import { createHash } from 'node:crypto';
import ts from 'typescript';
export type AssignmentQueryKind = 'prisma' | 'relation' | 'where-input';
export type AssignmentQueryFinding = {
  path: string;
  line: number;
  kind: AssignmentQueryKind;
  fingerprint: string;
};
const ASSIGNMENT_FIELDS = new Set(['active', 'status']);
const TEMPORAL_FIELDS = new Set(['start_date', 'end_date', 'expires_at']);
const TEMPORAL_OPERATORS = new Set(['lt', 'lte', 'gt', 'gte']);
const LOGICAL_OPERATORS = new Set(['AND', 'OR', 'NOT']);
const PRISMA_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);
function fingerprint(kind: AssignmentQueryKind, text: string): string {
  return createHash('sha256')
    .update(`${kind}\0${text.replace(/\s+/g, ' ').trim()}`)
    .digest('hex')
    .slice(0, 12);
}
export function scanAssignmentQuerySource(
  path: string,
  source: string,
): AssignmentQueryFinding[] {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const declarations: ts.VariableDeclaration[] = [];
  const parameters: ts.ParameterDeclaration[] = [];
  const collectDeclarations = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      declarations.push(node);
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name))
      parameters.push(node);
    ts.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(sourceFile);
  const scopeOf = (node: ts.Node): ts.Node => {
    let scope = node.parent;
    while (
      scope.parent &&
      !ts.isSourceFile(scope) &&
      !ts.isBlock(scope) &&
      !ts.isFunctionLike(scope)
    ) {
      scope = scope.parent;
    }
    return scope;
  };
  const isInScope = (declaration: ts.VariableDeclaration, use: ts.Node) => {
    const scope = scopeOf(declaration);
    const start = scope.getStart(sourceFile);
    return (
      declaration.getStart(sourceFile) < use.getStart(sourceFile) &&
      start <= use.getStart(sourceFile) &&
      scope.end >= use.end
    );
  };
  const binding = (identifier: ts.Identifier): ts.Expression | null =>
    declarations
      .filter(
        (declaration) =>
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === identifier.text &&
          isInScope(declaration, identifier) &&
          !parameters.some(
            (parameter) =>
              parameter.name.getText(sourceFile) === identifier.text &&
              parameter.parent.getStart(sourceFile) <=
                identifier.getStart(sourceFile) &&
              parameter.parent.end >= identifier.end,
          ),
      )
      .sort((left, right) => {
        const width = (node: ts.Node) => node.end - node.getStart(sourceFile);
        return (
          width(scopeOf(left)) - width(scopeOf(right)) ||
          right.getStart(sourceFile) - left.getStart(sourceFile)
        );
      })[0]?.initializer ?? null;
  const resolve = (
    value: ts.Expression,
    seen = new Set<ts.Expression>(),
  ): ts.Expression => {
    let node = value;
    while (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node)
    ) {
      node = node.expression;
    }
    if (ts.isIdentifier(node)) {
      const initializer = binding(node);
      if (initializer && !seen.has(initializer)) {
        seen.add(initializer);
        return resolve(initializer, seen);
      }
    }
    return node;
  };
  const stringValue = (value: ts.Expression): string | null => {
    const node = resolve(value);
    return ts.isStringLiteralLike(node) ? node.text : null;
  };
  const propertyName = (node: ts.Node): string | null => {
    const name = (node as ts.NamedDeclaration).name;
    if (!name) return null;
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
    return ts.isComputedPropertyName(name)
      ? stringValue(name.expression)
      : null;
  };
  const initializer = (
    property: ts.ObjectLiteralElementLike,
  ): ts.Expression | null => {
    if (ts.isPropertyAssignment(property)) return property.initializer;
    if (ts.isShorthandPropertyAssignment(property)) return property.name;
    return null;
  };
  const properties = (
    value: ts.Expression,
    seen = new Set<ts.Expression>(),
  ): ts.ObjectLiteralElementLike[] => {
    const node = resolve(value);
    if (!ts.isObjectLiteralExpression(node) || seen.has(node)) return [];
    seen.add(node);
    return node.properties.flatMap((property) =>
      ts.isSpreadAssignment(property)
        ? properties(property.expression, seen)
        : [property],
    );
  };
  const values = (value: ts.Expression, name: string): ts.Expression[] =>
    properties(value)
      .filter((property) => propertyName(property) === name)
      .map(initializer)
      .filter((entry): entry is ts.Expression => entry !== null);
  const hasAssignmentPredicate = (
    value: ts.Expression,
    seen = new Set<ts.Expression>(),
  ): boolean => {
    const node = resolve(value);
    if (seen.has(node)) return false;
    seen.add(node);
    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.some(
        (entry) =>
          ts.isExpression(entry) && hasAssignmentPredicate(entry, seen),
      );
    }
    return properties(node).some((property) => {
      const name = propertyName(property);
      const next = initializer(property);
      if (ASSIGNMENT_FIELDS.has(name ?? '')) return true;
      if (
        TEMPORAL_FIELDS.has(name ?? '') &&
        next &&
        properties(next).some((operator) =>
          TEMPORAL_OPERATORS.has(propertyName(operator) ?? ''),
        )
      ) {
        return true;
      }
      return (
        LOGICAL_OPERATORS.has(name ?? '') &&
        !!next &&
        hasAssignmentPredicate(next, seen)
      );
    });
  };
  const isPrismaClientRoot = (
    value: ts.Expression,
    seen = new Set<ts.Expression>(),
  ): boolean => {
    const node = resolve(value);
    if (seen.has(node)) return false;
    seen.add(node);
    if (ts.isIdentifier(node)) {
      return /^(?:prisma|db|tx|client|transaction)(?:[A-Z_].*)?$/i.test(
        node.text,
      );
    }
    if (!ts.isPropertyAccessExpression(node)) return false;
    if (node.expression.kind === ts.SyntaxKind.ThisKeyword) {
      return /^(?:prisma|db|tx|client|transaction)(?:[A-Z_].*)?$/i.test(
        node.name.text,
      );
    }
    return isPrismaClientRoot(node.expression, seen);
  };
  const isAssignmentDelegate = (value: ts.Expression): boolean => {
    const node = resolve(value);
    if (ts.isPropertyAccessExpression(node)) {
      return (
        node.name.text === 'club_role_assignments' &&
        isPrismaClientRoot(node.expression)
      );
    }
    return (
      ts.isElementAccessExpression(node) &&
      !!node.argumentExpression &&
      stringValue(node.argumentExpression) === 'club_role_assignments' &&
      isPrismaClientRoot(node.expression)
    );
  };
  const isPrismaDelegate = (value: ts.Expression): boolean => {
    const node = resolve(value);
    if (ts.isPropertyAccessExpression(node)) {
      return isPrismaClientRoot(node.expression);
    }
    return (
      ts.isElementAccessExpression(node) && isPrismaClientRoot(node.expression)
    );
  };
  const isPrismaOperation = (call: ts.CallExpression): boolean =>
    ts.isPropertyAccessExpression(call.expression) &&
    PRISMA_OPERATIONS.has(call.expression.name.text) &&
    isPrismaDelegate(call.expression.expression);
  const typeTargetsAssignments = (node: ts.TypeNode): boolean =>
    node.getText(sourceFile).includes('club_role_assignmentsWhereInput');
  const findings: AssignmentQueryFinding[] = [];
  const add = (node: ts.Node, kind: AssignmentQueryKind): void => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    findings.push({
      path,
      line: position.line + 1,
      kind,
      fingerprint: fingerprint(kind, node.getText(sourceFile)),
    });
  };
  const scanRelationWhere = (
    value: ts.Expression,
    seen = new Set<ts.Expression>(),
  ): void => {
    const node = resolve(value);
    if (seen.has(node)) return;
    seen.add(node);
    for (const property of properties(node)) {
      const name = propertyName(property);
      const next = initializer(property);
      if (!next) continue;
      if (name === 'club_role_assignments') {
        if (
          values(next, 'some')
            .concat(values(next, 'every'), values(next, 'none'))
            .concat(values(next, 'is'), values(next, 'isNot'))
            .some((filter) => hasAssignmentPredicate(filter))
        ) {
          add(property, 'relation');
        }
        continue;
      }
      if (LOGICAL_OPERATORS.has(name ?? '')) scanRelationWhere(next, seen);
    }
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      isPrismaOperation(node)
    ) {
      const operation = node.expression;
      const argument = node.arguments[0];
      if (argument && ts.isExpression(argument)) {
        const where = values(argument, 'where');
        if (isAssignmentDelegate(operation.expression)) {
          if (where.some((filter) => hasAssignmentPredicate(filter))) {
            add(node, 'prisma');
          }
        } else {
          where.forEach((filter) => scanRelationWhere(filter));
        }
      }
    }
    if (
      (ts.isSatisfiesExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isTypeAssertionExpression(node)) &&
      typeTargetsAssignments(node.type) &&
      hasAssignmentPredicate(node.expression)
    ) {
      add(node, 'where-input');
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.type &&
      node.initializer &&
      typeTargetsAssignments(node.type) &&
      hasAssignmentPredicate(node.initializer)
    ) {
      add(node, 'where-input');
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}
