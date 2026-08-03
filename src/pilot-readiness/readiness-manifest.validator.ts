import {
  ReadinessContractError,
  type ReadinessManifestV1,
  snapshotArtifact,
} from './readiness-artifact';
import { assertArtifactContainsNoSecrets } from './secret-scanner';

type Row = Record<string, unknown>;
const providerNames = [
  'database',
  'redis',
  'r2',
  'fcm',
  'resend',
  'sentry',
] as const;
const manifestKeys = [
  'schemaVersion',
  'environment',
  'release',
  'origins',
  'migrations',
  'providers',
  'backupPolicy',
  'operationWindow',
  'pilotScope',
];
const fail = (
  code:
    | 'READINESS_MANIFEST_INVALID'
    | 'READINESS_MANIFEST_SECRET_EXPOSURE' = 'READINESS_MANIFEST_INVALID',
): never => {
  throw new ReadinessContractError(code);
};
const row = (value: unknown, allowed: readonly string[]): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail();
  const input = value as Row;
  const keys = Object.keys(input);
  if (
    keys.length !== allowed.length ||
    keys.some((key) => !allowed.includes(key))
  )
    fail();
  return input;
};
const optionalRow = (
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail();
  const input = value as Row;
  const keys = Object.keys(input);
  if (
    keys.some((key) => !allowed.includes(key)) ||
    required.some((key) => !keys.includes(key))
  )
    fail();
  return input;
};
const id = (value: unknown) =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{1,127}$/i.test(value);
export const isRfc3339 = (value: unknown) => {
  if (typeof value !== 'string') return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) return false;
  // prettier-ignore
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = [match[1], match[2], match[3], match[4], match[5], match[6], match[8] ?? '0', match[9] ?? '0'].map(Number);
  if (
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  )
    return false;
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, 0);
  return (
    calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() === month - 1 &&
    calendar.getUTCDate() === day &&
    Number.isFinite(Date.parse(value))
  );
};
const origin = (value: unknown) => {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password)
      fail('READINESS_MANIFEST_SECRET_EXPOSURE');
    return parsed.protocol === 'https:' && parsed.origin === value;
  } catch (error) {
    if (error instanceof ReadinessContractError) throw error;
    return false;
  }
};
const idList = (value: unknown) => {
  if (!Array.isArray(value) || value.length === 0) return false;
  for (let index = 0; index < value.length; index += 1)
    if (!id(value[index])) return false;
  return true;
};

export function validateReadinessManifest(value: unknown): ReadinessManifestV1 {
  const snapshot = snapshotArtifact(value);
  assertArtifactContainsNoSecrets(snapshot);
  const manifest = row(snapshot, manifestKeys);
  const environment = row(manifest.environment, ['id', 'tier']);
  const release = optionalRow(
    manifest.release,
    ['commit', 'version', 'deployedAt'],
    ['commit'],
  );
  const origins = row(manifest.origins, ['api', 'admin']);
  const migrations = row(manifest.migrations, ['expected', 'appliedReference']);
  const providers = row(manifest.providers, providerNames);
  const backup = row(manifest.backupPolicy, [
    'owner',
    'maxAgeHours',
    'restoreRunbookRef',
  ]);
  const window = row(manifest.operationWindow, ['startsAt', 'endsAt', 'owner']);
  const scope = row(manifest.pilotScope, [
    'adultsOnly',
    'sensitiveDataAllowed',
    'streams',
  ]);
  for (const name of providerNames) {
    const provider = optionalRow(
      providers[name],
      ['required', 'configured', 'evidenceRef'],
      ['required', 'configured'],
    );
    if (
      typeof provider.required !== 'boolean' ||
      typeof provider.configured !== 'boolean' ||
      (provider.required && !provider.configured) ||
      (provider.evidenceRef !== undefined && !id(provider.evidenceRef))
    )
      fail();
  }
  if (
    manifest.schemaVersion !== '1' ||
    !id(environment.id) ||
    !['staging', 'pilot-clone', 'production'].includes(
      String(environment.tier),
    ) ||
    typeof release.commit !== 'string' ||
    !/^[0-9a-f]{7,64}$/.test(release.commit) ||
    (release.version !== undefined && !id(release.version)) ||
    (release.deployedAt !== undefined && !isRfc3339(release.deployedAt)) ||
    !origin(origins.api) ||
    !origin(origins.admin) ||
    !idList(migrations.expected) ||
    !id(migrations.appliedReference) ||
    !id(backup.owner) ||
    !Number.isInteger(backup.maxAgeHours) ||
    Number(backup.maxAgeHours) <= 0 ||
    !id(backup.restoreRunbookRef) ||
    !isRfc3339(window.startsAt) ||
    !isRfc3339(window.endsAt) ||
    Date.parse(String(window.startsAt)) >= Date.parse(String(window.endsAt)) ||
    !id(window.owner) ||
    typeof scope.adultsOnly !== 'boolean' ||
    scope.sensitiveDataAllowed !== false ||
    !idList(scope.streams)
  )
    fail();
  return snapshot as unknown as ReadinessManifestV1;
}
