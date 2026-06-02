import { namedThrottle } from './throttler.helpers';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

describe('namedThrottle', () => {
  it('expands one throttle policy to every configured global throttler name', () => {
    expect(namedThrottle({ ttl: 60_000, limit: 5 })).toEqual({
      short: { ttl: 60_000, limit: 5 },
      medium: { ttl: 60_000, limit: 5 },
      long: { ttl: 60_000, limit: 5 },
    });
  });

  it('prevents ineffective default throttle overrides in source controllers', () => {
    const sourceRoot = join(__dirname, '..');
    const offenders = listTypeScriptFiles(sourceRoot).filter((file) =>
      readFileSync(file, 'utf8').includes('@Throttle({' + ' default'),
    );

    expect(offenders).toEqual([]);
  });
});

function listTypeScriptFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      return listTypeScriptFiles(path);
    }

    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}
