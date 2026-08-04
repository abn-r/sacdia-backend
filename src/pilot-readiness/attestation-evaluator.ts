import {
  createHash,
  createHmac,
  timingSafeEqual,
  verify,
  type KeyObject,
} from 'node:crypto';
import {
  canonicalJson,
  canonicalSha256,
  ReadinessContractError,
  snapshotArtifact,
  type EvidenceReference,
  type ReadinessAttestationV1,
  type ReadinessErrorCode,
} from './readiness-artifact';
import { isRfc3339 } from './readiness-manifest.validator';
import { assertArtifactContainsNoSecrets } from './secret-scanner';
type SignedAlgorithm = 'hmac-sha256' | 'ed25519';
type TrustedKey = string | Buffer | KeyObject;
export interface TrustedKeyResolver {
  resolve(keyId: string, algorithm: SignedAlgorithm): TrustedKey | undefined;
}
export interface EvidenceArtifact {
  reference: EvidenceReference;
  artifact: unknown;
}
export interface EvaluationContext {
  now: Date;
  observedEnvironment: string;
  observedRelease: string;
}
const fail = (code: ReadinessErrorCode): never => {
  throw new ReadinessContractError(code);
};
const equalHex = (left: string, right: string, bytes: number) => {
  if (
    !new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(left) ||
    !new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(right)
  )
    return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
};
const referenceKey = (reference: EvidenceReference) =>
  `${reference.issuer}\0${reference.uri}\0${reference.sha256}`;
const timestamp = (value: string) =>
  isRfc3339(value) ? Date.parse(value) : Number.NaN;
type Row = Record<string, unknown>;
const attestationKeys = [
  'schemaVersion',
  'attestationId',
  'mode',
  'manifestSha256',
  'environment',
  'release',
  'issuedAt',
  'expiresAt',
  'gates',
  'integrity',
] as const;
const gateRequirements = Array.from(
  { length: 14 },
  (_, index) => `REQ-PR-${String(index + 1).padStart(3, '0')}`,
);
const statuses = [
  'PASS',
  'FAIL',
  'BLOCKED',
  'NOT_APPLICABLE_WITH_JUSTIFICATION',
];
const row = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('READINESS_ATTESTATION_INVALID');
  const input = value as Row;
  const keys = Object.keys(input);
  if (
    keys.some((key) => !required.includes(key) && !optional.includes(key)) ||
    required.some((key) => !keys.includes(key))
  )
    fail('READINESS_ATTESTATION_INVALID');
  return input;
};
const id = (value: unknown) =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{1,127}$/i.test(value);
const hash = (value: unknown, bytes = 32) =>
  typeof value === 'string' &&
  new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value);
const release = (value: unknown) =>
  typeof value === 'string' && /^[0-9a-f]{7,64}$/.test(value);
const validateReference = (value: unknown): EvidenceReference => {
  const reference = row(
    value,
    ['kind', 'uri', 'sha256', 'issuer', 'environmentId', 'observedAt'],
    ['releaseCommit', 'expiresAt'],
  );
  if (
    !id(reference.kind) ||
    typeof reference.uri !== 'string' ||
    reference.uri.length === 0 ||
    !hash(reference.sha256) ||
    !id(reference.issuer) ||
    !id(reference.environmentId) ||
    !isRfc3339(reference.observedAt) ||
    (reference.releaseCommit !== undefined &&
      !release(reference.releaseCommit)) ||
    (reference.expiresAt !== undefined &&
      (!isRfc3339(reference.expiresAt) ||
        timestamp(String(reference.observedAt)) >=
          timestamp(String(reference.expiresAt))))
  )
    fail('READINESS_ATTESTATION_INVALID');
  return reference as unknown as EvidenceReference;
};
const validateAttestation = (value: unknown): ReadinessAttestationV1 => {
  let snapshot: unknown;
  try {
    snapshot = snapshotArtifact(value);
  } catch {
    return fail('READINESS_ATTESTATION_INVALID');
  }
  const attestation = row(snapshot, attestationKeys);
  const environment = row(attestation.environment, ['declared', 'observed']);
  const integrity = row(
    attestation.integrity,
    ['algorithm', 'status', 'digest'],
    ['keyId'],
  );
  if (
    attestation.schemaVersion !== '1' ||
    !id(attestation.attestationId) ||
    attestation.mode !== 'READ_ONLY' ||
    !hash(attestation.manifestSha256) ||
    !id(environment.declared) ||
    !id(environment.observed) ||
    !release(attestation.release) ||
    !isRfc3339(attestation.issuedAt) ||
    !isRfc3339(attestation.expiresAt) ||
    timestamp(String(attestation.issuedAt)) >=
      timestamp(String(attestation.expiresAt)) ||
    !['sha256', 'hmac-sha256', 'ed25519'].includes(
      String(integrity.algorithm),
    ) ||
    !['UNSIGNED', 'VALID'].includes(String(integrity.status)) ||
    !hash(integrity.digest, integrity.algorithm === 'ed25519' ? 64 : 32) ||
    (integrity.keyId !== undefined && !id(integrity.keyId))
  )
    fail('READINESS_ATTESTATION_INVALID');
  if (!Array.isArray(attestation.gates) || attestation.gates.length === 0)
    fail('READINESS_ATTESTATION_INVALID');
  const gates = attestation.gates as unknown[];
  for (const value of gates) {
    const gate = row(
      value,
      ['requirement', 'status', 'remediation', 'evidence'],
      ['code', 'justification'],
    );
    if (
      !gateRequirements.includes(String(gate.requirement)) ||
      !statuses.includes(String(gate.status)) ||
      typeof gate.remediation !== 'string' ||
      gate.remediation.length === 0 ||
      (gate.code !== undefined &&
        (typeof gate.code !== 'string' || gate.code.length === 0)) ||
      (gate.justification !== undefined &&
        typeof gate.justification !== 'string') ||
      !Array.isArray(gate.evidence)
    )
      fail('READINESS_ATTESTATION_INVALID');
    const evidence = gate.evidence as unknown[];
    for (const reference of evidence) validateReference(reference);
  }
  return attestation as unknown as ReadinessAttestationV1;
};
const validateEvidence = (value: unknown): EvidenceArtifact[] => {
  let snapshot: unknown;
  try {
    snapshot = snapshotArtifact(value);
  } catch {
    return fail('READINESS_EVIDENCE_MISSING');
  }
  if (!Array.isArray(snapshot)) return fail('READINESS_EVIDENCE_MISSING');
  return snapshot.map((value) => {
    const item = row(value, ['reference', 'artifact']);
    try {
      return {
        reference: validateReference(item.reference),
        artifact: item.artifact,
      };
    } catch {
      return fail('READINESS_EVIDENCE_MISSING');
    }
  });
};
export function canonicalAttestationPayload(
  attestation: ReadinessAttestationV1,
): string {
  const snapshot = snapshotArtifact(
    attestation,
  ) as unknown as ReadinessAttestationV1;
  const { digest: _digest, ...integrity } = snapshot.integrity;
  return canonicalJson({ ...snapshot, integrity });
}
export class AttestationEvidenceEvaluator {
  constructor(private readonly keys: TrustedKeyResolver) {}
  verifyIntegrity(input: unknown): 'UNSIGNED' | 'VALID' {
    const attestation = validateAttestation(input);
    const payload = canonicalAttestationPayload(attestation);
    const envelope = attestation.integrity;
    if (envelope.algorithm === 'sha256') {
      if (
        envelope.status !== 'UNSIGNED' ||
        envelope.keyId !== undefined ||
        !equalHex(
          envelope.digest,
          createHash('sha256').update(payload).digest('hex'),
          32,
        )
      )
        return fail('READINESS_ATTESTATION_INVALID');
      return 'UNSIGNED';
    }
    if (
      !['hmac-sha256', 'ed25519'].includes(envelope.algorithm) ||
      envelope.status !== 'VALID' ||
      !envelope.keyId
    )
      return fail('READINESS_ATTESTATION_INVALID');
    try {
      const key = this.keys.resolve(envelope.keyId, envelope.algorithm);
      if (!key) return fail('READINESS_ATTESTATION_INVALID');
      if (envelope.algorithm === 'hmac-sha256') {
        const expected = createHmac('sha256', key)
          .update(payload)
          .digest('hex');
        if (!equalHex(envelope.digest, expected, 32))
          return fail('READINESS_ATTESTATION_INVALID');
      } else if (
        !/^[0-9a-f]{128}$/.test(envelope.digest) ||
        !verify(
          null,
          Buffer.from(payload),
          key,
          Buffer.from(envelope.digest, 'hex'),
        )
      )
        return fail('READINESS_ATTESTATION_INVALID');
    } catch {
      return fail('READINESS_ATTESTATION_INVALID');
    }
    return 'VALID';
  }
  evaluate(
    input: unknown,
    evidence: unknown,
    context: EvaluationContext,
  ): { status: 'VERIFIED'; controls: ['C-01', 'C-02'] } {
    const attestation = validateAttestation(input);
    const observedEvidence = validateEvidence(evidence);
    const current = context.now.getTime();
    const issued = timestamp(attestation.issuedAt);
    const expires = timestamp(attestation.expiresAt);
    if (
      !Number.isFinite(current) ||
      !Number.isFinite(issued) ||
      !Number.isFinite(expires) ||
      issued > current ||
      expires <= current ||
      issued >= expires
    )
      return fail('READINESS_ATTESTATION_INVALID');
    if (
      attestation.environment.declared !== attestation.environment.observed ||
      attestation.environment.observed !== context.observedEnvironment ||
      attestation.release !== context.observedRelease
    )
      return fail('READINESS_RUNTIME_MISMATCH');
    if (this.verifyIntegrity(attestation) !== 'VALID')
      return fail('READINESS_ATTESTATION_INVALID');
    const byReference = new Map<string, EvidenceArtifact[]>();
    for (const item of observedEvidence) {
      const key = referenceKey(item.reference);
      byReference.set(key, [...(byReference.get(key) ?? []), item]);
    }
    const legal = attestation.gates.filter(
      (gate) => gate.requirement === 'REQ-PR-012',
    );
    if (legal.length !== 1 || legal[0].status !== 'PASS')
      return fail('READINESS_EVIDENCE_MISSING');
    const legalGate = legal[0];
    const controls = new Set<string>();
    for (const gate of attestation.gates) {
      for (const reference of gate.evidence) {
        const item = byReference
          .get(referenceKey(reference))
          ?.find(
            (candidate) =>
              canonicalJson(candidate.reference) === canonicalJson(reference),
          );
        if (!item) return fail('READINESS_EVIDENCE_MISSING');
        const observed = timestamp(reference.observedAt);
        const evidenceExpires = reference.expiresAt
          ? timestamp(reference.expiresAt)
          : Number.NaN;
        if (
          !Number.isFinite(observed) ||
          !Number.isFinite(evidenceExpires) ||
          observed > current ||
          evidenceExpires <= current
        )
          return fail('READINESS_EVIDENCE_MISSING');
        if (
          reference.environmentId !== attestation.environment.observed ||
          reference.releaseCommit !== attestation.release
        )
          return fail('READINESS_RUNTIME_MISMATCH');
        assertArtifactContainsNoSecrets(item.artifact);
        if (!equalHex(reference.sha256, canonicalSha256(item.artifact), 32))
          return fail('READINESS_ATTESTATION_INVALID');
        if (gate === legalGate) {
          const artifact = snapshotArtifact(item.artifact);
          if (
            !artifact ||
            typeof artifact !== 'object' ||
            Array.isArray(artifact) ||
            !['C-01', 'C-02'].includes(String(artifact.control)) ||
            artifact.outcome !== 'PASS'
          )
            return fail('READINESS_EVIDENCE_MISSING');
          controls.add(String(artifact.control));
        }
      }
    }
    if (!controls.has('C-01') || !controls.has('C-02'))
      return fail('READINESS_EVIDENCE_MISSING');
    return { status: 'VERIFIED', controls: ['C-01', 'C-02'] };
  }
}
