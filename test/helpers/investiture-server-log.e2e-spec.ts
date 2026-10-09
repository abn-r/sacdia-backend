import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertServerLogHasWarningMarker,
  requireInvestitureServerLogPath,
} from './investiture-server-log';

describe('investiture server log', () => {
  it('C1RR-3 fails clearly when SACDIA_POSTGRES_SERVER_LOG is missing', () => {
    expect(() => requireInvestitureServerLogPath({})).toThrow(
      /SACDIA_POSTGRES_SERVER_LOG/,
    );
  });

  it('C1RR-3 fails when the file does not contain the WARNING marker', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sacdia-log-'));
    const path = join(dir, 'foreign.log');
    writeFileSync(path, 'LOG: something else\n');
    expect(() =>
      assertServerLogHasWarningMarker(path, 'sacdia-pg-warning-missing'),
    ).toThrow(/WARNING/);
  });

  it('C1RR-3 accepts the file when the WARNING marker is present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sacdia-log-'));
    const path = join(dir, 'server.log');
    writeFileSync(path, 'WARNING: sacdia-pg-warning-present\n');
    expect(() =>
      assertServerLogHasWarningMarker(path, 'sacdia-pg-warning-present'),
    ).not.toThrow();
  });
});
