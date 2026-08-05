import { createHash } from 'node:crypto';
import ts from 'typescript';
import { AssignmentQueryFinding } from './club-assignment-effectivity.arch';
type SqlFragment = { text: string; central: boolean; unknown: boolean };
function fingerprint(text: string): string {
  return createHash('sha256')
    .update(`raw-sql\0${text.replace(/\s+/g, ' ').trim()}`)
    .digest('hex')
    .slice(0, 12);
}
function unwrapped(node: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}
function neutralizeSql(text: string): string {
  let output = '';
  for (let index = 0; index < text.length; index += 1) {
    if (text.startsWith('--', index)) {
      const end = text.indexOf('\n', index);
      output += ' '.repeat((end < 0 ? text.length : end) - index);
      index = end < 0 ? text.length : end - 1;
    } else if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2);
      const finish = end < 0 ? text.length : end + 2;
      output += ' '.repeat(finish - index);
      index = finish - 1;
    } else if (text[index] === "'") {
      let end = index + 1;
      while (end < text.length) {
        if (text[end] === "'" && text[end + 1] === "'") end += 2;
        else if (text[end++] === "'") break;
      }
      output += ' '.repeat(end - index);
      index = end - 1;
    } else if (text[index] === '$') {
      const match = text.slice(index).match(/^\$[A-Za-z_0-9]*\$/);
      if (!match) output += text[index];
      else {
        const end = text.indexOf(match[0], index + match[0].length);
        const finish = end < 0 ? text.length : end + match[0].length;
        output += ' '.repeat(finish - index);
        index = finish - 1;
      }
    } else output += text[index];
  }
  return output;
}
function tableAliases(sql: string): string[] {
  const aliases = ['club_role_assignments'];
  const table = '(?:"club_role_assignments"|club_role_assignments)';
  const schema = '(?:(?:"[^"]+"|[A-Za-z_]\\w*)\\s*\\.\\s*)?';
  const alias = '(?:\\s+(?:AS\\s+)?(?:"([^"]+)"|([A-Za-z_]\\w*)))?';
  const reserved =
    /^(where|join|on|order|group|limit|left|right|inner|full|cross)$/i;
  for (const match of neutralizeSql(sql).matchAll(
    new RegExp(`\\b(?:FROM|JOIN)\\s+${schema}${table}${alias}`, 'gi'),
  )) {
    const name = match[1] ?? match[2];
    if (name && !reserved.test(name)) aliases.push(name);
  }
  return aliases;
}
function targetSql(sql: string): boolean {
  return /\b(?:FROM|JOIN)\s+(?:(?:"[^"]+"|[A-Za-z_]\w*)\s*\.\s*)?(?:"club_role_assignments"|club_role_assignments)(?![A-Za-z0-9_])/i.test(
    neutralizeSql(sql),
  );
}
function hasTargetPredicate(sql: string): boolean {
  const cleaned = neutralizeSql(sql);
  const column = '(?:active|status|start_date|end_date|expires_at)';
  const operator = '\\s*(?:=|<>|!=|<=|>=|<|>|IN\\b|IS\\b)';
  const aliases = tableAliases(sql).map((alias) =>
    alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  const target = `(?:${aliases.map((alias) => `(?:"${alias}"|${alias})`).join('|')})`;
  const qualified = new RegExp(
    `${target}\\s*\\.\\s*"?${column}"?${operator}`,
    'i',
  );
  const bare = new RegExp(`(?:^|[^\\w.])"?${column}"?${operator}`, 'i');
  const boolean = new RegExp(
    `\\b(?:WHERE|AND|OR|ON)\\s*(?:\\(+\\s*)*(?:NOT\\s*)?(?:\\(+\\s*)?${target}\\s*\\.\\s*"?active"?(?!\\s*(?:=|<>|!=|<=|>=|<|>|IN\\b|IS\\b))`,
    'i',
  );
  return qualified.test(cleaned) || bare.test(cleaned) || boolean.test(cleaned);
}
export function scanAssignmentRawSqlSource(
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
  const writes: ts.Identifier[] = [];
  const visitBindings = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
      declarations.push(node);
    if (
      ts.isBinaryExpression(node) &&
      ts.isIdentifier(node.left) &&
      node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken &&
      node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
    )
      writes.push(node.left);
    ts.forEachChild(node, visitBindings);
  };
  visitBindings(sourceFile);
  const scope = (node: ts.Node): ts.Node => {
    let candidate = node.parent;
    while (
      candidate.parent &&
      !ts.isSourceFile(candidate) &&
      !ts.isBlock(candidate) &&
      !ts.isFunctionLike(candidate)
    )
      candidate = candidate.parent;
    return candidate;
  };
  const contains = (outer: ts.Node, inner: ts.Node) =>
    outer.getStart(sourceFile) <= inner.getStart(sourceFile) &&
    outer.end >= inner.end;
  const hasUnprovenShadow = (identifier: ts.Identifier): boolean => {
    let node: ts.Node | undefined = identifier.parent;
    while (node) {
      if (
        ts.isFunctionLike(node) &&
        node.parameters.some(
          (parameter) =>
            ts.isIdentifier(parameter.name) &&
            parameter.name.text === identifier.text,
        )
      ) {
        return true;
      }
      node = node.parent;
    }
    return sourceFile.statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        !!statement.importClause &&
        statement.importClause.getText(sourceFile).includes(identifier.text),
    );
  };
  const binding = (identifier: ts.Identifier): ts.Expression | null => {
    if (hasUnprovenShadow(identifier)) return null;
    const candidates = declarations
      .filter((declaration) => {
        const list = declaration.parent;
        return (
          declaration.name.getText(sourceFile) === identifier.text &&
          declaration.initializer &&
          declaration.getStart(sourceFile) < identifier.getStart(sourceFile) &&
          ts.isVariableDeclarationList(list) &&
          (list.flags & ts.NodeFlags.Const) !== 0 &&
          contains(scope(declaration), identifier)
        );
      })
      .sort(
        (left, right) =>
          scope(left).end -
            scope(left).getStart(sourceFile) -
            (scope(right).end - scope(right).getStart(sourceFile)) ||
          right.getStart(sourceFile) - left.getStart(sourceFile),
      );
    const declaration = candidates[0];
    if (!declaration) return null;
    const assigned = writes.some(
      (write) =>
        write.text === identifier.text &&
        write.getStart(sourceFile) > declaration.getStart(sourceFile) &&
        contains(scope(declaration), write),
    );
    return assigned ? null : (declaration.initializer ?? null);
  };
  const resolve = (
    value: ts.Expression,
    seen = new Set<ts.Expression>(),
  ): ts.Expression | null => {
    const node = unwrapped(value);
    if (!ts.isIdentifier(node)) return node;
    const initializer = binding(node);
    if (!initializer || seen.has(initializer)) return null;
    seen.add(initializer);
    return resolve(initializer, seen);
  };
  const prismaMember = (node: ts.Expression, name: string): boolean =>
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'Prisma' &&
    node.name.text === name;
  const rawQueryTag = (node: ts.Expression): boolean =>
    ts.isPropertyAccessExpression(node) && node.name.text === '$queryRaw';
  const canonicalPolicy = (
    value: ts.Expression,
    seen = new Set<ts.Expression>(),
  ): boolean => {
    const node = unwrapped(value);
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'assignmentEffectivityPolicy' &&
      node.expression.kind === ts.SyntaxKind.ThisKeyword
    )
      return true;
    if (!ts.isIdentifier(node)) return false;
    const initializer = binding(node);
    if (!initializer || seen.has(initializer)) return false;
    seen.add(initializer);
    return canonicalPolicy(initializer, seen);
  };
  const centralCall = (node: ts.Expression): boolean =>
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'toSql' &&
    canonicalPolicy(node.expression.expression);
  const fragment = (
    value: ts.Expression,
    seen = new Set<ts.Expression>(),
  ): SqlFragment => {
    const node = resolve(value, seen);
    if (!node) return { text: '', central: false, unknown: true };
    if (centralCall(node)) return { text: '', central: true, unknown: false };
    if (ts.isStringLiteralLike(node))
      return { text: node.text, central: false, unknown: false };
    if (ts.isTemplateExpression(node)) return template(node, seen);
    if (ts.isTaggedTemplateExpression(node)) {
      if (
        !prismaMember(node.tag, 'sql') &&
        !prismaMember(node.tag, 'raw') &&
        !rawQueryTag(node.tag)
      )
        return { text: '', central: false, unknown: true };
      return template(node.template, seen);
    }
    if (ts.isCallExpression(node) && prismaMember(node.expression, 'join')) {
      const [entries, ...rest] = node.arguments;
      const resolvedEntries = entries && unwrapped(entries);
      if (!resolvedEntries || !ts.isArrayLiteralExpression(resolvedEntries))
        return { text: '', central: false, unknown: true };
      return combine([
        ...resolvedEntries.elements.map((entry) =>
          ts.isExpression(entry)
            ? fragment(entry, seen)
            : { text: '', central: false, unknown: true },
        ),
        ...rest.map((entry) => fragment(entry, seen)),
      ]);
    }
    return { text: '', central: false, unknown: true };
  };
  const combine = (fragments: SqlFragment[]): SqlFragment => ({
    text: fragments.map(({ text }) => text).join(' '),
    central: fragments.some(({ central }) => central),
    unknown: fragments.some(({ unknown }) => unknown),
  });
  const template = (
    node: ts.TemplateLiteral,
    seen: Set<ts.Expression>,
  ): SqlFragment =>
    ts.isNoSubstitutionTemplateLiteral(node)
      ? { text: node.text, central: false, unknown: false }
      : combine([
          { text: node.head.text, central: false, unknown: false },
          ...node.templateSpans.flatMap((span) => [
            fragment(span.expression, seen),
            { text: span.literal.text, central: false, unknown: false },
          ]),
        ]);
  const findings: AssignmentQueryFinding[] = [];
  const add = (node: ts.Node) => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    findings.push({
      path,
      line: position.line + 1,
      kind: 'raw-sql',
      fingerprint: fingerprint(node.getText(sourceFile)),
    });
  };
  const inspect = (node: ts.Node, value: ts.Expression) => {
    const result = fragment(value);
    if (
      targetSql(result.text) &&
      (!result.central || result.unknown || hasTargetPredicate(result.text))
    )
      add(node);
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isTaggedTemplateExpression(node) &&
      (prismaMember(node.tag, 'sql') ||
        prismaMember(node.tag, 'raw') ||
        rawQueryTag(node.tag))
    )
      inspect(node, node);
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === '$queryRawUnsafe' &&
      node.arguments[0]
    )
      inspect(node, node.arguments[0]);
    if (ts.isTemplateExpression(node) && ts.isReturnStatement(node.parent))
      inspect(node, node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}
