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
  verifyIntegrity(attestation: ReadinessAttestationV1): 'UNSIGNED' | 'VALID' {
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
    input: ReadinessAttestationV1,
    evidence: EvidenceArtifact[],
    context: EvaluationContext,
  ): { status: 'VERIFIED'; controls: ['C-01', 'C-02'] } {
    const attestation = snapshotArtifact(
      input,
    ) as unknown as ReadinessAttestationV1;
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
    const byReference = new Map(
      evidence.map((item) => [referenceKey(item.reference), item]),
    );
    const legal = attestation.gates.find(
      (gate) => gate.requirement === 'REQ-PR-012',
    );
    if (!legal || legal.status !== 'PASS')
      return fail('READINESS_EVIDENCE_MISSING');
    const controls = new Set<string>();
    for (const gate of attestation.gates) {
      for (const reference of gate.evidence) {
        const item = byReference.get(referenceKey(reference));
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
        if (gate === legal) {
          const artifact = snapshotArtifact(item.artifact) as Record<
            string,
            unknown
          >;
          if (
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
