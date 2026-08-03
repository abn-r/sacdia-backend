import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';
import {
  canonicalSha256,
  ReadinessContractError,
  type EvidenceReference,
  type ReadinessAttestationV1,
} from './readiness-artifact';
import {
  AttestationEvidenceEvaluator,
  canonicalAttestationPayload,
  type EvidenceArtifact,
} from './attestation-evaluator';
const now = new Date('2026-08-03T18:00:00Z');
const release = 'c52898a7e35a53c0f65c34e423cc78a8bc332925';
const environmentId = 'pilot-mx';
const hmacKey = randomBytes(32);
const wrongHmacKey = randomBytes(32);
const ed25519 = generateKeyPairSync('ed25519');
const artifacts = [
  { control: 'C-01', outcome: 'PASS', approvalId: 'approval-c01' },
  { control: 'C-02', outcome: 'PASS', approvalId: 'approval-c02' },
] as const;
const reference = (
  artifact: unknown,
  control: string,
  overrides: Partial<EvidenceReference> = {},
): EvidenceReference => ({
  kind: 'legal-approval',
  uri: `evidence:${control.toLowerCase()}`,
  sha256: canonicalSha256(artifact),
  issuer: 'legal-review',
  environmentId,
  releaseCommit: release,
  observedAt: '2026-08-03T17:00:00Z',
  expiresAt: '2026-08-03T19:00:00Z',
  ...overrides,
});
const evidence = (): EvidenceArtifact[] =>
  artifacts.map((artifact) => ({
    artifact,
    reference: reference(artifact, artifact.control),
  }));
const unsigned = (
  refs = evidence().map((item) => item.reference),
): ReadinessAttestationV1 => ({
  schemaVersion: '1',
  attestationId: 'attestation-02a',
  mode: 'READ_ONLY',
  manifestSha256: 'a'.repeat(64),
  environment: { declared: environmentId, observed: environmentId },
  release,
  issuedAt: '2026-08-03T17:30:00Z',
  expiresAt: '2026-08-03T18:30:00Z',
  gates: [
    {
      requirement: 'REQ-PR-012',
      status: 'PASS',
      remediation: 'none',
      evidence: refs,
    },
  ],
  integrity: { algorithm: 'sha256', status: 'UNSIGNED', digest: '' },
});
const seal = (
  algorithm: 'sha256' | 'hmac-sha256' | 'ed25519',
  input = unsigned(),
): ReadinessAttestationV1 => {
  const keyId = algorithm === 'sha256' ? undefined : `${algorithm}-test-key`;
  const candidate = {
    ...input,
    integrity: {
      algorithm,
      status:
        algorithm === 'sha256' ? ('UNSIGNED' as const) : ('VALID' as const),
      digest: '',
      ...(keyId ? { keyId } : {}),
    },
  };
  const payload = canonicalAttestationPayload(candidate);
  const digest =
    algorithm === 'sha256'
      ? createHash('sha256').update(payload).digest('hex')
      : algorithm === 'hmac-sha256'
        ? createHmac('sha256', hmacKey).update(payload).digest('hex')
        : sign(null, Buffer.from(payload), ed25519.privateKey).toString('hex');
  return { ...candidate, integrity: { ...candidate.integrity, digest } };
};
const evaluator = (hmac = hmacKey) =>
  new AttestationEvidenceEvaluator({
    resolve: (keyId, algorithm) => {
      if (keyId !== `${algorithm}-test-key`) return undefined;
      return algorithm === 'hmac-sha256' ? hmac : ed25519.publicKey;
    },
  });
const verify = (
  attestation: ReadinessAttestationV1,
  items = evidence(),
  observedEnvironment = environmentId,
  observedRelease = release,
) =>
  evaluator().evaluate(attestation, items, {
    now,
    observedEnvironment,
    observedRelease,
  });
const expectCode = (run: () => unknown, code: string) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ReadinessContractError);
    expect((error as ReadinessContractError).code).toBe(code);
    return;
  }
  throw new Error('expected readiness error');
};
describe('attestation evidence evaluator', () => {
  it.each(['hmac-sha256', 'ed25519'] as const)(
    'verifies %s without persisting trusted keys',
    (algorithm) => {
      expect(verify(seal(algorithm))).toEqual({
        status: 'VERIFIED',
        controls: ['C-01', 'C-02'],
      });
    },
  );
  it('keeps a valid sha256 checksum unsigned and fail-closed', () => {
    const attestation = seal('sha256');
    expect(evaluator().verifyIntegrity(attestation)).toBe('UNSIGNED');
    expectCode(() => verify(attestation), 'READINESS_ATTESTATION_INVALID');
  });
  it('rejects a wrong trusted key and a forged digest', () => {
    expectCode(
      () =>
        evaluator(wrongHmacKey).evaluate(seal('hmac-sha256'), evidence(), {
          now,
          observedEnvironment: environmentId,
          observedRelease: release,
        }),
      'READINESS_ATTESTATION_INVALID',
    );
    const forged = seal('hmac-sha256');
    forged.integrity.digest = '0'.repeat(64);
    expectCode(() => verify(forged), 'READINESS_ATTESTATION_INVALID');
    expectCode(
      () => verify(seal('rsa-sha256' as 'ed25519')),
      'READINESS_ATTESTATION_INVALID',
    );
  });
  it('rejects wrong evidence digest and expired evidence', () => {
    const wrongDigest = evidence();
    wrongDigest[0].artifact = { ...artifacts[0], outcome: 'FAIL' };
    expectCode(
      () => verify(seal('hmac-sha256'), wrongDigest),
      'READINESS_ATTESTATION_INVALID',
    );
    const expired = evidence();
    expired[0].reference.expiresAt = '2026-08-03T17:59:59Z';
    expectCode(
      () =>
        verify(
          seal('hmac-sha256', unsigned(expired.map((x) => x.reference))),
          expired,
        ),
      'READINESS_EVIDENCE_MISSING',
    );
  });
  it('rejects expired attestations and cross-environment replay', () => {
    const expired = unsigned();
    expired.expiresAt = '2026-08-03T17:59:59Z';
    expectCode(
      () => verify(seal('hmac-sha256', expired)),
      'READINESS_ATTESTATION_INVALID',
    );
    expectCode(
      () => verify(seal('hmac-sha256'), evidence(), 'other-environment'),
      'READINESS_RUNTIME_MISMATCH',
    );
  });
  it('rejects cross-release replay and duplicate C-01 evidence', () => {
    expectCode(
      () =>
        verify(seal('hmac-sha256'), evidence(), environmentId, 'new-release'),
      'READINESS_RUNTIME_MISMATCH',
    );
    const duplicate = [evidence()[0], evidence()[0]];
    expectCode(
      () =>
        verify(
          seal('hmac-sha256', unsigned(duplicate.map((x) => x.reference))),
          duplicate,
        ),
      'READINESS_EVIDENCE_MISSING',
    );
  });
  it('binds integrity metadata but excludes the recursive digest', () => {
    const payload = canonicalAttestationPayload(unsigned());
    expect(payload).toContain('"algorithm":"sha256"');
    expect(payload).not.toContain('"digest"');
  });
});
