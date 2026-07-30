import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

type LoaderModule = {
  loadAuthorizationP0PreflightSql?: (moduleDirectory?: string) => string;
};

const root = join(__dirname, '../..');
const sqlPath = join(root, 'prisma/scripts/authorization-p0-preflight.sql');

function compileLoader(moduleFile: string): void {
  const source = readFileSync(
    join(__dirname, 'authorization-p0-preflight.ts'),
    'utf8',
  );
  writeFileSync(
    moduleFile,
    ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
      },
    }).outputText,
  );
}

function load(moduleFile: string, cwd: string) {
  return spawnSync(
    process.execPath,
    [
      '-e',
      `try {
        const sql = require(${JSON.stringify(moduleFile)})
          .loadAuthorizationP0PreflightSql();
        process.stdout.write(sql.startsWith('/* Read-only P0 preflight') ? 'ok' : 'bad');
      } catch (error) {
        process.stderr.write(String(error.message));
        process.exit(1);
      }`,
    ],
    { cwd, encoding: 'utf8' },
  );
}

describe('authorization P0 preflight SQL loader', () => {
  it('loads lazily from the source module layout', () => {
    const runtime = require('./authorization-p0-preflight') as LoaderModule;
    expect(runtime.loadAuthorizationP0PreflightSql).toBeDefined();
    expect(runtime.loadAuthorizationP0PreflightSql?.()).toBe(
      readFileSync(sqlPath, 'utf8'),
    );
  });

  it('declares the canonical SQL as a Nest dist asset', () => {
    const config = JSON.parse(
      readFileSync(join(root, 'nest-cli.json'), 'utf8'),
    );
    expect(config.compilerOptions.assets).toContainEqual({
      include: '../prisma/scripts/authorization-p0-preflight.sql',
      outDir: 'dist/prisma/scripts',
    });
  });

  it('loads in a dist-only layout without depending on CWD', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'sacdia-preflight-dist-'));
    const moduleDirectory = join(temporary, 'dist/src/common');
    const assetDirectory = join(temporary, 'dist/prisma/scripts');
    const moduleFile = join(moduleDirectory, 'authorization-p0-preflight.js');
    const cwd = join(temporary, 'runtime');
    mkdirSync(moduleDirectory, { recursive: true });
    mkdirSync(assetDirectory, { recursive: true });
    mkdirSync(cwd);
    copyFileSync(
      sqlPath,
      join(assetDirectory, 'authorization-p0-preflight.sql'),
    );
    try {
      compileLoader(moduleFile);
      expect(load(moduleFile, cwd)).toMatchObject({ status: 0, stdout: 'ok' });
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it('fails closed instead of falling back to SQL beneath CWD', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'sacdia-preflight-cwd-'));
    const moduleDirectory = join(temporary, 'dist/src/common');
    const moduleFile = join(moduleDirectory, 'authorization-p0-preflight.js');
    const cwd = join(temporary, 'runtime');
    const cwdSqlDirectory = join(cwd, 'prisma/scripts');
    mkdirSync(moduleDirectory, { recursive: true });
    mkdirSync(cwdSqlDirectory, { recursive: true });
    copyFileSync(
      sqlPath,
      join(cwdSqlDirectory, 'authorization-p0-preflight.sql'),
    );
    try {
      compileLoader(moduleFile);
      expect(load(moduleFile, cwd)).toMatchObject({
        status: 1,
        stderr: 'AUTHORIZATION_P0_PREFLIGHT_SQL_UNAVAILABLE',
      });
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
