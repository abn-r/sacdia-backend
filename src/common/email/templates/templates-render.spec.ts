import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Real render integration: NO mocks of react / react-dom / @react-email.
 *
 * Guards a production incident where pnpm resolved react@19.2.8 but
 * react-dom@19.2.4 (peer of @react-email/render), making every render()
 * throw "Incompatible React versions" and therefore every email fail.
 *
 * Rendering runs in a plain Node child process (tsx) because
 * @react-email/render's CJS build uses a native dynamic import() which Jest's
 * VM sandbox rejects without --experimental-vm-modules. A child process also
 * exercises the exact module resolution production uses.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const TEMPLATES_DIR = __dirname;

const EXPECTED_TEMPLATES = [
  'Layout',
  'DataExportReadyEmail',
  'EmailVerificationEmail',
  'PasswordResetEmail',
  'AccountDeletionConfirmedEmail',
  'CronAlertEmail',
  'InvestitureNoticeEmail',
];
const LOCALES = ['es', 'en', 'fr', 'pt-BR'];

function packageDirOf(name: string): string {
  let dir = path.dirname(require.resolve(name));
  while (dir !== path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest)) {
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
        name?: string;
      };
      if (pkg.name === name) {
        return dir;
      }
    }
    dir = path.dirname(dir);
  }
  throw new Error(`package dir for ${name} not found`);
}

function reactDomVersionSeenBy(name: string): string {
  const manifest = require.resolve('react-dom/package.json', {
    paths: [packageDirOf(name)],
  });
  return (JSON.parse(fs.readFileSync(manifest, 'utf8')) as { version: string })
    .version;
}

const RENDER_SCRIPT = `
require('tsx/cjs');
const React = require('react');
const { render } = require('@react-email/render');
const dir = process.env.TEMPLATES_DIR;
const t = (f) => require(dir + '/' + f);
const { Layout } = t('_layout');
const { DataExportReadyEmail } = t('data-export-ready');
const { EmailVerificationEmail } = t('email-verification');
const { PasswordResetEmail } = t('password-reset');
const { AccountDeletionConfirmedEmail } = t('account-deletion-confirmed');
const { CronAlertEmail } = t('cron-alert');
const { InvestitureNoticeEmail } = t('investiture-notice');
const h = React.createElement;
const locales = ${JSON.stringify(LOCALES)};
const builders = {
  Layout: (lang) => h(Layout, { preview: 'preview', lang }, h('p', null, 'contenido')),
  DataExportReadyEmail: (lang) => h(DataExportReadyEmail, {
    deepLink: 'https://example.com/export', expiresAt: new Date('2030-01-01T00:00:00Z'), lang }),
  EmailVerificationEmail: (lang) => h(EmailVerificationEmail, {
    verificationUrl: 'https://example.com/verify', userName: 'Ana', lang }),
  PasswordResetEmail: (lang) => h(PasswordResetEmail, { resetUrl: 'https://example.com/reset', lang }),
  AccountDeletionConfirmedEmail: (lang) => h(AccountDeletionConfirmedEmail, { lang }),
  CronAlertEmail: (lang) => h(CronAlertEmail, {
    jobName: 'nightly-job', condition: 'consecutive_failures', conditionDetail: '3 fallos',
    recentFailures: [{ run_id: 1, started_at: '2030-01-01T00:00:00.000Z', error_message: 'boom', duration_ms: 1200 }],
    locale: lang }),
  InvestitureNoticeEmail: () => h(InvestitureNoticeEmail, {
    paragraphs: ['Primer parrafo', 'Segundo parrafo'], link: 'https://example.com/investiture' }),
};
(async () => {
  const results = [];
  for (const [name, build] of Object.entries(builders)) {
    for (const lang of locales) {
      const el = build(lang);
      const html = await render(el);
      const text = await render(el, { plainText: true });
      results.push({ name, lang, htmlLength: html.length, textLength: text.length });
    }
  }
  process.stdout.write('RESULTS:' + JSON.stringify(results));
})().catch((e) => { process.stderr.write(String(e && e.message || e)); process.exit(1); });
`;

describe('email templates render with the real @react-email/render', () => {
  it.each(['@react-email/render', 'react-email'])(
    'react-dom resolved from %s has exactly the same version as react',
    (name) => {
      const reactVersion = (require('react') as { version: string }).version;
      expect(reactDomVersionSeenBy(name)).toBe(reactVersion);
    },
  );

  it('renders the layout and every transactional template to non-empty html and text', () => {
    const run = spawnSync(process.execPath, ['-e', RENDER_SCRIPT], {
      cwd: REPO_ROOT,
      env: { ...process.env, TEMPLATES_DIR },
      encoding: 'utf8',
      timeout: 60_000,
    });

    expect({ status: run.status, stderr: run.stderr }).toEqual({
      status: 0,
      stderr: '',
    });

    const results = JSON.parse(
      run.stdout.slice(run.stdout.indexOf('RESULTS:') + 'RESULTS:'.length),
    ) as Array<{
      name: string;
      lang: string;
      htmlLength: number;
      textLength: number;
    }>;

    expect([...new Set(results.map((r) => r.name))]).toEqual(
      EXPECTED_TEMPLATES,
    );
    expect(results).toHaveLength(EXPECTED_TEMPLATES.length * LOCALES.length);
    for (const r of results) {
      expect({ ...r, ok: r.htmlLength > 0 && r.textLength > 0 }).toMatchObject({
        ok: true,
      });
    }
  });
});
