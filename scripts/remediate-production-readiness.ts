import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface HonorApplicabilityTarget {
  honor_id: number;
  code: string;
  expected_hct: number[];
  expected_legacy: number;
  target_hct: number[];
  target_legacy: number;
}

export interface ProductionReadinessManifest {
  schema_version: 1;
  environment: 'development';
  ecclesiastical_year_id: number;
  hierarchy: {
    division_id: number;
    country_id: number;
    union_id: number;
    local_field_id: number;
    old_district_id: number;
    target_district_id: number;
    church_id: number;
    club_id: number;
  };
  assignments_to_close: string[];
  cq_test_assignments_to_replace: string[];
  officers: {
    carlos_user_id: string;
    ana_user_id: string;
    pedro_user_id: string;
    abner_user_id: string;
  };
  annual_enrollments: {
    master_guides_id: string;
    conquerors_id: string;
  };
  class_enrollment_ids: number[];
  estella_section_ids: number[];
  honor_applicability: HonorApplicabilityTarget[];
}

export interface MigrationFingerprintRow {
  migration_name: string;
  checksum: string;
  finished_at: string;
}

export interface BackupSnapshot {
  format_version: 1;
  captured_at: string;
  fingerprint: string;
  row_counts: Record<string, number>;
  tables: Record<string, Array<Record<string, unknown>>>;
}

export interface EncryptedBackupEnvelope {
  format_version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  auth_tag: string;
  ciphertext: string;
}

export interface RemediationAttestation {
  format_version: 1;
  run_id: string;
  fingerprint: string;
  manifest_sha256: string;
  backup_sha256: string;
  actor: string;
  created_at: string;
  expires_at: string;
}

export interface RemediationApproval {
  format_version: 1;
  run_id: string;
  approved_by: string;
  approved_at: string;
  attestation_sha256: string;
  algorithm: 'hmac-sha256';
  signature: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertRecord(
  value: unknown,
  field: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${field} is required`);
  }
}

function assertInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`);
  }
}

function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`${field} must be a UUID`);
  }
}

function assertUniqueArrayLength(
  value: unknown,
  field: string,
  length: number,
): asserts value is Array<number | string> {
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    new Set(value).size !== length
  ) {
    throw new Error(`${field} must contain ${length} unique IDs`);
  }
}

/**
 * Validates the immutable technical target list before a database connection is
 * created. Runtime row-level expectations are checked separately in dry-run.
 */
export function validateManifest(input: unknown): ProductionReadinessManifest {
  assertRecord(input, 'manifest');
  if (input.schema_version !== 1) {
    throw new Error('manifest.schema_version must be 1');
  }
  if (input.environment !== 'development') {
    throw new Error('manifest.environment must be development');
  }
  assertInteger(
    input.ecclesiastical_year_id,
    'manifest.ecclesiastical_year_id',
  );

  assertRecord(input.hierarchy, 'manifest.hierarchy');
  for (const key of [
    'division_id',
    'country_id',
    'union_id',
    'local_field_id',
    'old_district_id',
    'target_district_id',
    'church_id',
    'club_id',
  ]) {
    assertInteger(input.hierarchy[key], `manifest.hierarchy.${key}`);
  }

  assertUniqueArrayLength(
    input.assignments_to_close,
    'assignments_to_close',
    4,
  );
  input.assignments_to_close.forEach((id, index) =>
    assertUuid(id, `assignments_to_close[${index}]`),
  );

  assertUniqueArrayLength(
    input.cq_test_assignments_to_replace,
    'cq_test_assignments_to_replace',
    2,
  );
  input.cq_test_assignments_to_replace.forEach((id, index) =>
    assertUuid(id, `cq_test_assignments_to_replace[${index}]`),
  );

  assertRecord(input.officers, 'manifest.officers');
  for (const key of [
    'carlos_user_id',
    'ana_user_id',
    'pedro_user_id',
    'abner_user_id',
  ]) {
    assertUuid(input.officers[key], `manifest.officers.${key}`);
  }

  assertRecord(input.annual_enrollments, 'manifest.annual_enrollments');
  assertUuid(
    input.annual_enrollments.master_guides_id,
    'manifest.annual_enrollments.master_guides_id',
  );
  assertUuid(
    input.annual_enrollments.conquerors_id,
    'manifest.annual_enrollments.conquerors_id',
  );

  assertUniqueArrayLength(
    input.class_enrollment_ids,
    'class_enrollment_ids',
    22,
  );
  input.class_enrollment_ids.forEach((id, index) =>
    assertInteger(id, `class_enrollment_ids[${index}]`),
  );

  assertUniqueArrayLength(input.estella_section_ids, 'estella_section_ids', 3);
  input.estella_section_ids.forEach((id, index) =>
    assertInteger(id, `estella_section_ids[${index}]`),
  );

  if (
    !Array.isArray(input.honor_applicability) ||
    input.honor_applicability.length !== 638
  ) {
    throw new Error('honor_applicability must contain 638 targets');
  }
  const honorIds = new Set<number>();
  input.honor_applicability.forEach((target, index) => {
    assertRecord(target, `honor_applicability[${index}]`);
    assertInteger(target.honor_id, `honor_applicability[${index}].honor_id`);
    if (honorIds.has(target.honor_id)) {
      throw new Error('honor_applicability must contain unique honor IDs');
    }
    honorIds.add(target.honor_id);
    if (typeof target.code !== 'string' || target.code.trim() === '') {
      throw new Error(`honor_applicability[${index}].code is required`);
    }
    for (const key of ['expected_hct', 'target_hct'] as const) {
      if (
        !Array.isArray(target[key]) ||
        target[key].length === 0 ||
        target[key].some((id) => !Number.isInteger(id))
      ) {
        throw new Error(`honor_applicability[${index}].${key} is invalid`);
      }
    }
    assertInteger(
      target.expected_legacy,
      `honor_applicability[${index}].expected_legacy`,
    );
    assertInteger(
      target.target_legacy,
      `honor_applicability[${index}].target_legacy`,
    );
  });

  return input as unknown as ProductionReadinessManifest;
}

function databaseEndpoint(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('database URL is invalid');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('database URL must use PostgreSQL');
  }
  const port = parsed.port || '5432';
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!parsed.hostname || !database) {
    throw new Error('database URL must include host and database');
  }
  return `${parsed.hostname.toLowerCase()}:${port}/${database}`;
}

export function assertRuntimeEnvironment(input: {
  nodeEnv: string | undefined;
  sourceDatabaseUrl: string;
  productionDatabaseUrl?: string;
  targetDatabaseUrl?: string;
}): void {
  if (input.nodeEnv?.toLowerCase() !== 'development') {
    throw new Error('NODE_ENV must be development');
  }
  const sourceEndpoint = databaseEndpoint(input.sourceDatabaseUrl);
  if (
    input.productionDatabaseUrl &&
    sourceEndpoint === databaseEndpoint(input.productionDatabaseUrl)
  ) {
    throw new Error('source database matches production');
  }
  if (
    input.targetDatabaseUrl &&
    sourceEndpoint === databaseEndpoint(input.targetDatabaseUrl)
  ) {
    throw new Error('target database must differ from source host/database');
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function computeDatabaseFingerprint(input: {
  databaseUrl: string;
  schema: string;
  ecclesiasticalYearId: number;
  migrations: MigrationFingerprintRow[];
}): string {
  const migrations = [...input.migrations]
    .sort((left, right) =>
      left.migration_name.localeCompare(right.migration_name),
    )
    .map(({ migration_name, checksum, finished_at }) => ({
      migration_name,
      checksum,
      finished_at,
    }));

  return sha256(
    canonicalJson({
      endpoint_sha256: sha256(databaseEndpoint(input.databaseUrl)),
      schema: input.schema,
      ecclesiastical_year_id: input.ecclesiasticalYearId,
      migrations,
    }),
  );
}

function decodeEncryptionKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('REMEDIATION_BACKUP_KEY must decode to 32 bytes');
  }
  return key;
}

export function encryptBackup(
  snapshot: BackupSnapshot,
  keyBase64: string,
): EncryptedBackupEnvelope {
  const key = decodeEncryptionKey(keyBase64);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(snapshot), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    format_version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    auth_tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptBackup(
  envelope: EncryptedBackupEnvelope,
  keyBase64: string,
): BackupSnapshot {
  if (envelope.format_version !== 1 || envelope.algorithm !== 'aes-256-gcm') {
    throw new Error('unsupported backup envelope');
  }
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      decodeEncryptionKey(keyBase64),
      Buffer.from(envelope.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(envelope.auth_tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plaintext) as BackupSnapshot;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'REMEDIATION_BACKUP_KEY must decode to 32 bytes'
    ) {
      throw error;
    }
    throw new Error('backup authentication failed');
  }
}

export function assertBackupRestorable(input: {
  serializedEnvelope: string;
  expectedSha256: string;
  backupKeyBase64: string;
}): BackupSnapshot {
  if (sha256(input.serializedEnvelope) !== input.expectedSha256) {
    throw new Error('backup SHA-256 mismatch');
  }

  let envelope: EncryptedBackupEnvelope;
  try {
    envelope = JSON.parse(input.serializedEnvelope) as EncryptedBackupEnvelope;
  } catch {
    throw new Error('backup envelope is not valid JSON');
  }
  const snapshot = decryptBackup(envelope, input.backupKeyBase64);
  if (snapshot.format_version !== 1 || !isRecord(snapshot.tables)) {
    throw new Error('backup snapshot format is invalid');
  }

  for (const [table, expectedCount] of Object.entries(snapshot.row_counts)) {
    const rows = snapshot.tables[table];
    if (!Array.isArray(rows) || rows.length !== expectedCount) {
      throw new Error(`backup row count mismatch for ${table}`);
    }
  }
  return snapshot;
}

export function createAttestation(input: {
  runId: string;
  fingerprint: string;
  manifestSha256: string;
  backupSha256: string;
  actor: string;
  now: Date;
  ttlSeconds: number;
}): RemediationAttestation {
  if (!input.runId || !input.actor || input.ttlSeconds <= 0) {
    throw new Error('attestation input is invalid');
  }
  return {
    format_version: 1,
    run_id: input.runId,
    fingerprint: input.fingerprint,
    manifest_sha256: input.manifestSha256,
    backup_sha256: input.backupSha256,
    actor: input.actor,
    created_at: input.now.toISOString(),
    expires_at: new Date(
      input.now.getTime() + input.ttlSeconds * 1_000,
    ).toISOString(),
  };
}

export function approveAttestation(input: {
  attestation: RemediationAttestation;
  approver: string;
  approvalKey: string;
  now: Date;
}): RemediationApproval {
  if (input.approver === input.attestation.actor) {
    throw new Error('approver must differ from dry-run actor');
  }
  if (!input.approver || !input.approvalKey) {
    throw new Error('approver and approval key are required');
  }
  const signature = createHmac('sha256', input.approvalKey)
    .update(canonicalJson(input.attestation))
    .digest('hex');

  return {
    format_version: 1,
    run_id: input.attestation.run_id,
    approved_by: input.approver,
    approved_at: input.now.toISOString(),
    attestation_sha256: sha256(canonicalJson(input.attestation)),
    algorithm: 'hmac-sha256',
    signature,
  };
}

function signaturesMatch(expectedHex: string, receivedHex: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(receivedHex)) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(expectedHex, 'hex'),
    Buffer.from(receivedHex, 'hex'),
  );
}

export function verifyApplyAuthorization(input: {
  attestation: RemediationAttestation;
  approval: RemediationApproval;
  approvalKey: string;
  actor: string;
  currentFingerprint: string;
  currentManifestSha256: string;
  currentBackupSha256: string;
  now: Date;
}): void {
  if (input.now.getTime() > Date.parse(input.attestation.expires_at)) {
    throw new Error('attestation expired');
  }
  if (input.actor !== input.attestation.actor) {
    throw new Error('apply actor differs from dry-run actor');
  }
  if (input.approval.approved_by === input.attestation.actor) {
    throw new Error('approver must differ from dry-run actor');
  }
  if (input.currentFingerprint !== input.attestation.fingerprint) {
    throw new Error('database fingerprint changed');
  }
  if (input.currentManifestSha256 !== input.attestation.manifest_sha256) {
    throw new Error('manifest SHA-256 changed');
  }
  if (input.currentBackupSha256 !== input.attestation.backup_sha256) {
    throw new Error('backup SHA-256 changed');
  }
  if (input.approval.run_id !== input.attestation.run_id) {
    throw new Error('approval run ID mismatch');
  }
  const attestationSha = sha256(canonicalJson(input.attestation));
  if (input.approval.attestation_sha256 !== attestationSha) {
    throw new Error('approval attestation SHA-256 mismatch');
  }
  const expectedSignature = createHmac('sha256', input.approvalKey)
    .update(canonicalJson(input.attestation))
    .digest('hex');
  if (!signaturesMatch(expectedSignature, input.approval.signature)) {
    throw new Error('approval signature is invalid');
  }
}
