type SqlMode =
  | 'normal'
  | 'single-quote'
  | 'double-quote'
  | 'dollar-quote'
  | 'line-comment'
  | 'block-comment';

export function stripSqlComments(sql: string): string {
  return transformSql(sql, false);
}

export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

export function findSqlStatementPositions(
  sql: string,
  statement: 'BEGIN' | 'COMMIT',
): number[] {
  const structuralSql = transformSql(sql, true);
  const matcher = new RegExp(`\\b${statement}\\s*;`, 'gi');

  return Array.from(structuralSql.matchAll(matcher), (match) => match.index);
}

function transformSql(sql: string, maskQuotedContent: boolean): string {
  let output = '';
  let mode: SqlMode = 'normal';
  let blockDepth = 0;
  let dollarDelimiter = '';
  let singleQuoteBackslashEscapes = false;

  const appendQuoted = (value: string): void => {
    output += maskQuotedContent ? value.replace(/[^\n]/g, ' ') : value;
  };

  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    const next = sql[index + 1];

    if (mode === 'line-comment') {
      if (current === '\n') {
        output += current;
        mode = 'normal';
      }
      continue;
    }

    if (mode === 'block-comment') {
      if (current === '/' && next === '*') {
        blockDepth += 1;
        index += 1;
      } else if (current === '*' && next === '/') {
        blockDepth -= 1;
        index += 1;
        if (blockDepth === 0) mode = 'normal';
      } else if (current === '\n') {
        output += current;
      }
      continue;
    }

    if (mode === 'single-quote') {
      appendQuoted(current);
      if (current === "'" && next === "'") {
        appendQuoted(next);
        index += 1;
      } else if (
        singleQuoteBackslashEscapes &&
        current === '\\' &&
        next !== undefined
      ) {
        appendQuoted(next);
        index += 1;
      } else if (current === "'") {
        mode = 'normal';
        singleQuoteBackslashEscapes = false;
      }
      continue;
    }

    if (mode === 'double-quote') {
      appendQuoted(current);
      if (current === '"' && next === '"') {
        appendQuoted(next);
        index += 1;
      } else if (current === '"') {
        mode = 'normal';
      }
      continue;
    }

    if (mode === 'dollar-quote') {
      if (sql.startsWith(dollarDelimiter, index)) {
        appendQuoted(dollarDelimiter);
        index += dollarDelimiter.length - 1;
        mode = 'normal';
      } else {
        appendQuoted(current);
      }
      continue;
    }

    const detectedDollarDelimiter = readDollarDelimiter(sql, index);
    if (current === "'") {
      appendQuoted(current);
      singleQuoteBackslashEscapes = opensEscapeString(sql, index);
      mode = 'single-quote';
    } else if (current === '"') {
      appendQuoted(current);
      mode = 'double-quote';
    } else if (detectedDollarDelimiter) {
      appendQuoted(detectedDollarDelimiter);
      dollarDelimiter = detectedDollarDelimiter;
      index += detectedDollarDelimiter.length - 1;
      mode = 'dollar-quote';
    } else if (current === '-' && next === '-') {
      index += 1;
      mode = 'line-comment';
    } else if (current === '/' && next === '*') {
      output += ' ';
      blockDepth = 1;
      index += 1;
      mode = 'block-comment';
    } else {
      output += current;
    }
  }

  return output;
}

function readDollarDelimiter(sql: string, index: number): string {
  if (sql[index] !== '$' || isIdentifierCharacter(sql[index - 1])) return '';

  return (
    sql.slice(index).match(/^\$(?:[\p{L}_][\p{L}\p{M}\p{N}_]*)?\$/u)?.[0] ?? ''
  );
}

function opensEscapeString(sql: string, quoteIndex: number): boolean {
  const prefix = sql[quoteIndex - 1];

  return (
    (prefix === 'E' || prefix === 'e') &&
    !isIdentifierCharacter(sql[quoteIndex - 2])
  );
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{M}\p{N}_$]/u.test(character);
}
