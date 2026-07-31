import { createHash } from 'node:crypto';
import ts from 'typescript';

export type AssignmentQueryKind =
  | 'prisma'
  | 'relation'
  | 'where-input'
  | 'raw-sql';
export type AssignmentQueryFinding = {
  path: string;
  line: number;
  kind: AssignmentQueryKind;
  fingerprint: string;
};

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
  const collect = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      declarations.push(node);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
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
  const binding = (identifier: ts.Identifier): ts.Expression | null =>
    declarations
      .filter(
        (declaration) =>
          declaration.name.getText(sourceFile) === identifier.text &&
          declaration.getStart(sourceFile) < identifier.getStart(sourceFile) &&
          scopeOf(declaration).getStart(sourceFile) <=
            identifier.getStart(sourceFile) &&
          scopeOf(declaration).end >= identifier.end,
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
  const initializer = (
    property: ts.ObjectLiteralElementLike,
  ): ts.Expression | null => {
    if (ts.isPropertyAssignment(property)) return property.initializer;
    if (ts.isShorthandPropertyAssignment(property)) return property.name;
    return null;
  };
  const values = (value: ts.Expression, name: string): ts.Expression[] =>
    properties(value)
      .filter((property) => propertyName(property) === name)
      .map(initializer)
      .filter((entry): entry is ts.Expression => entry !== null);
  const hasDirectPredicate = (
    value: ts.Expression,
    seen = new Set<ts.Expression>(),
  ): boolean => {
    const node = resolve(value);
    if (seen.has(node)) return false;
    seen.add(node);
    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.some(
        (entry) => ts.isExpression(entry) && hasDirectPredicate(entry, seen),
      );
    }
    return properties(node).some((property) => {
      const name = propertyName(property);
      const next = initializer(property);
      return (
        ['active', 'status'].includes(name ?? '') ||
        (['start_date', 'end_date', 'expires_at'].includes(name ?? '') &&
          !!next &&
          ['lt', 'lte', 'gt', 'gte'].some(
            (operator) => values(next, operator).length > 0,
          )) ||
        (['AND', 'OR', 'NOT'].includes(name ?? '') &&
          !!next &&
          hasDirectPredicate(next, seen))
      );
    });
  };
  const isAssignmentDelegate = (value: ts.Expression): boolean => {
    const node = resolve(value);
    return (
      (ts.isPropertyAccessExpression(node) &&
        node.name.text === 'club_role_assignments') ||
      (ts.isElementAccessExpression(node) &&
        !!node.argumentExpression &&
        stringValue(node.argumentExpression) === 'club_role_assignments')
    );
  };
  const typeTargetsAssignments = (node: ts.TypeNode) =>
    node.getText(sourceFile).includes('club_role_assignmentsWhereInput');
  const isCentralFragment = (value: ts.Expression): boolean => {
    const node = resolve(value);
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      node.expression.name.text !== 'toSql'
    ) {
      return false;
    }
    const receiver = resolve(node.expression.expression);
    return (
      (ts.isIdentifier(receiver) &&
        receiver.text === 'assignmentEffectivityPolicy') ||
      (ts.isPropertyAccessExpression(receiver) &&
        receiver.name.text === 'assignmentEffectivityPolicy' &&
        receiver.expression.kind === ts.SyntaxKind.ThisKeyword)
    );
  };
  const sqlInfo = (
    value: ts.Expression,
    seen = new Set<ts.Expression>(),
  ): { text: string; central: boolean } => {
    const node = resolve(value);
    if (seen.has(node)) return { text: '', central: false };
    seen.add(node);
    if (isCentralFragment(node)) return { text: '', central: true };
    if (ts.isTaggedTemplateExpression(node))
      return sqlInfo(node.template, seen);
    if (ts.isStringLiteralLike(node))
      return { text: node.text, central: false };
    const combine = (expressions: readonly ts.Expression[]) =>
      expressions.reduce<{ text: string; central: boolean }>(
        (result, expression) => {
          const fragment = sqlInfo(expression, seen);
          return {
            text: `${result.text} ${fragment.text}`,
            central: result.central || fragment.central,
          };
        },
        { text: '', central: false },
      );
    if (ts.isArrayLiteralExpression(node)) {
      return combine(node.elements.filter(ts.isExpression));
    }
    if (ts.isCallExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(sourceFile) === 'Prisma' &&
        node.expression.name.text === 'join'
      ) {
        const joined = node.arguments[0]
          ? sqlInfo(node.arguments[0], seen)
          : { text: '', central: false };
        return joined.central && !joined.text.trim()
          ? joined
          : { ...joined, text: `${joined.text}\0` };
      }
      return { text: '\0', central: false };
    }
    if (ts.isTemplateExpression(node)) {
      return node.templateSpans.reduce<{ text: string; central: boolean }>(
        (result, span) => {
          const fragment = sqlInfo(span.expression, seen);
          return {
            text: `${result.text} ${fragment.text} ${span.literal.text}`,
            central: result.central || fragment.central,
          };
        },
        { text: node.head.text, central: false },
      );
    }
    return { text: '', central: false };
  };
  const tableAliases = (sql: string): string[] => {
    const aliases: string[] = [];
    const pattern =
      /\b(?:FROM|JOIN)\s+(?:"?\w+"?\.)?"?club_role_assignments"?(?:\s+(?:AS\s+)?(?:"([^"]+)"|(\w+)))?/gi;
    for (const match of sql.matchAll(pattern)) {
      const alias = match[1] ?? match[2];
      if (
        alias &&
        !/^(?:WHERE|JOIN|ON|ORDER|GROUP|LIMIT|LEFT|RIGHT|INNER|FULL|CROSS)$/i.test(
          alias,
        )
      ) {
        aliases.push(alias);
      }
    }
    return ['club_role_assignments', ...aliases];
  };
  const sqlHasTable = (sql: string) =>
    /\b(?:FROM|JOIN)\s+(?:"?\w+"?\.)?"?club_role_assignments"?\b/i.test(sql);
  const sqlHasPredicate = (sql: string) => {
    const operator = String.raw`\s*(?:=|<>|!=|<=|>=|<|>|IN\b|IS\b)`;
    const column = String.raw`"?(?:active|status|start_date|end_date|expires_at)"?`;
    const unqualified = new RegExp(`(?:^|[^\\w.])${column}${operator}`, 'i');
    const boolean = (subject: string) =>
      new RegExp(
        `\\b(?:WHERE|AND|OR)\\s+(?:NOT\\s+)?${subject}(?![\\w.])`,
        'i',
      ).test(sql);
    return (
      unqualified.test(sql) ||
      boolean(String.raw`"?active"?`) ||
      tableAliases(sql).some((alias) => {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const target = `(?:"${escaped}"|${escaped})\\s*\\.\\s*${column}`;
        return (
          new RegExp(`${target}${operator}`, 'i').test(sql) ||
          boolean(`(?:"${escaped}"|${escaped})\\s*\\.\\s*"?active"?`)
        );
      })
    );
  };
  const findings: AssignmentQueryFinding[] = [];
  const add = (node: ts.Node, kind: AssignmentQueryKind) => {
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
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const argument = node.arguments[0];
      if (
        argument &&
        isAssignmentDelegate(node.expression.expression) &&
        values(argument, 'where').some((where) => hasDirectPredicate(where))
      ) {
        add(node, 'prisma');
      }
      if (node.expression.name.text === '$queryRawUnsafe' && argument) {
        const sql = sqlInfo(argument).text;
        if (sqlHasTable(sql) && sqlHasPredicate(sql)) add(node, 'raw-sql');
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node) === 'club_role_assignments'
    ) {
      if (
        ['some', 'every', 'none', 'where', 'is', 'isNot'].some((operator) =>
          values(node.initializer, operator).some((filter) =>
            hasDirectPredicate(filter),
          ),
        )
      ) {
        add(node, 'relation');
      }
    }
    if (
      (ts.isSatisfiesExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isTypeAssertionExpression(node)) &&
      typeTargetsAssignments(node.type) &&
      hasDirectPredicate(node.expression)
    ) {
      add(node, 'where-input');
    }
    if (
      ts.isVariableDeclaration(node) &&
      !!node.type &&
      typeTargetsAssignments(node.type) &&
      node.initializer &&
      hasDirectPredicate(node.initializer)
    ) {
      add(node, 'where-input');
    }
    if (ts.isTaggedTemplateExpression(node)) {
      const sql = sqlInfo(node);
      if (
        sqlHasTable(sql.text) &&
        (sqlHasPredicate(sql.text) || !sql.central || sql.text.includes('\0'))
      ) {
        // A table-level raw query must delegate effectivity structurally.
        add(node, 'raw-sql');
      }
    }
    if (
      (ts.isTemplateExpression(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isStringLiteral(node)) &&
      !ts.isTaggedTemplateExpression(node.parent) &&
      !(
        ts.isCallExpression(node.parent) &&
        ts.isPropertyAccessExpression(node.parent.expression) &&
        node.parent.expression.name.text === '$queryRawUnsafe'
      )
    ) {
      const sql = sqlInfo(node).text;
      if (sqlHasTable(sql) && sqlHasPredicate(sql)) {
        add(node, 'raw-sql');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}
