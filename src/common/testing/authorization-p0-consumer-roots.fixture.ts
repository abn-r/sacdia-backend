import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export type TestConsumerRoots = {
  workspaceRoot: string;
  adminRoot: string;
  appRoot: string;
  docsRoot: string;
  dispose(): void;
};

export function createTestConsumerRoots(
  inventory: readonly string[],
  names: { admin?: string; app?: string } = {},
): TestConsumerRoots {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'be01-consumers-'));
  const workspaceRoot = join(temporaryRoot, 'workspace');
  const adminRoot = join(workspaceRoot, names.admin ?? 'sacdia-admin');
  const appRoot = join(workspaceRoot, names.app ?? 'sacdia-app');
  const docsRoot = join(temporaryRoot, 'canonical');
  for (const directory of [
    join(adminRoot, 'src'),
    join(appRoot, 'lib'),
    join(docsRoot, 'docs/api'),
    join(docsRoot, 'docs/features'),
  ])
    mkdirSync(directory, { recursive: true });
  for (const consumer of inventory) {
    const path = consumer.startsWith('sacdia-admin/')
      ? join(adminRoot, consumer.slice('sacdia-admin/'.length))
      : consumer.startsWith('sacdia-app/')
        ? join(appRoot, consumer.slice('sacdia-app/'.length))
        : join(docsRoot, consumer);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'director-succession\n');
  }
  return {
    workspaceRoot,
    adminRoot,
    appRoot,
    docsRoot,
    dispose: () => rmSync(temporaryRoot, { recursive: true, force: true }),
  };
}
