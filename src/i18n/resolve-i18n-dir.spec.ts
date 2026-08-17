import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveI18nDir } from './resolve-i18n-dir';

describe('resolveI18nDir', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-dir-'));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('prefers src/i18n when the locale catalog exists', () => {
    const srcDir = path.join(cwd, 'src', 'i18n', 'es');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'errors.json'), '{}');

    expect(resolveI18nDir(cwd)).toBe(path.join(cwd, 'src', 'i18n'));
  });

  it('falls back to dist/i18n when src catalog is missing', () => {
    expect(resolveI18nDir(cwd)).toBe(path.join(cwd, 'dist', 'i18n'));
  });
});
