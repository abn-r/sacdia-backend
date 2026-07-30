import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type JsonRow = Record<string, unknown>;

export interface AuthorizationP0PreflightCheck {
  id: string;
  total_count: number;
  rows: JsonRow[];
  sample_count: number;
  truncated: boolean;
}

export interface AuthorizationP0PreflightReport {
  schema: {
    director_succession_plans: string;
    [key: string]: unknown;
  };
  checks: AuthorizationP0PreflightCheck[];
}

export function loadAuthorizationP0PreflightSql(
  moduleDirectory = __dirname,
): string {
  try {
    return readFileSync(
      resolve(
        moduleDirectory,
        '../../prisma/scripts/authorization-p0-preflight.sql',
      ),
      'utf8',
    );
  } catch (cause) {
    throw new Error('AUTHORIZATION_P0_PREFLIGHT_SQL_UNAVAILABLE', { cause });
  }
}
