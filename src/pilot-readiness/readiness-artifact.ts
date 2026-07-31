import { createHash } from 'node:crypto';

export type GateStatus =
  | 'PASS'
  | 'FAIL'
  | 'BLOCKED'
  | 'NOT_APPLICABLE_WITH_JUSTIFICATION';
export type ReadinessErrorCode =
  | 'READINESS_MANIFEST_INVALID'
  | 'READINESS_MANIFEST_SECRET_EXPOSURE'
  | 'READINESS_EVIDENCE_MISSING'
  | 'READINESS_RUNTIME_MISMATCH'
  | 'READINESS_ATTESTATION_INVALID'
  | 'READINESS_DEPENDENCY_UNVERIFIED'
  | 'READINESS_OBSERVABILITY_INCOMPLETE'
  | 'READINESS_RUNBOOK_OR_OWNER_MISSING'
  | 'READINESS_PROVIDER_EVIDENCE_MISSING'
  | 'READINESS_ARTIFACT_UNSAFE';

export interface EvidenceReference {
  kind: string;
  uri: string;
  sha256: string;
  issuer: string;
  environmentId: string;
  releaseCommit?: string;
  observedAt: string;
  expiresAt?: string;
}
export interface GateResult {
  requirement:
    | 'REQ-PR-001'
    | 'REQ-PR-002'
    | 'REQ-PR-003'
    | 'REQ-PR-004'
    | 'REQ-PR-005'
    | 'REQ-PR-006'
    | 'REQ-PR-007'
    | 'REQ-PR-008'
    | 'REQ-PR-009'
    | 'REQ-PR-010'
    | 'REQ-PR-011'
    | 'REQ-PR-012'
    | 'REQ-PR-013'
    | 'REQ-PR-014';
  status: GateStatus;
  code?: ReadinessErrorCode | string;
  remediation: string;
  evidence: EvidenceReference[];
  justification?: string;
}
export interface ReadinessManifestV1 {
  schemaVersion: '1';
  environment: { id: string; tier: 'staging' | 'pilot-clone' | 'production' };
  release: { commit: string; version?: string; deployedAt?: string };
  origins: { api: string; admin: string };
  migrations: { expected: string[]; appliedReference: string };
  providers: Record<
    'database' | 'redis' | 'r2' | 'fcm' | 'resend' | 'sentry',
    { required: boolean; configured: boolean; evidenceRef?: string }
  >;
  backupPolicy: {
    owner: string;
    maxAgeHours: number;
    restoreRunbookRef: string;
  };
  operationWindow: { startsAt: string; endsAt: string; owner: string };
  pilotScope: {
    adultsOnly: boolean;
    sensitiveDataAllowed: false;
    streams: string[];
  };
}
export interface ReadinessAttestationV1 {
  schemaVersion: '1';
  attestationId: string;
  mode: 'READ_ONLY';
  manifestSha256: string;
  environment: { declared: string; observed: string };
  release: string;
  issuedAt: string;
  expiresAt: string;
  gates: GateResult[];
  integrity: {
    algorithm: 'sha256' | 'hmac-sha256' | 'ed25519';
    status: 'UNSIGNED' | 'VALID';
    digest: string;
    keyId?: string;
  };
}

export class ReadinessContractError extends Error {
  constructor(readonly code: ReadinessErrorCode) {
    super(code);
  }
}

type Artifact =
  | null
  | boolean
  | number
  | string
  | Artifact[]
  | { [key: string]: Artifact };
const hasLoneSurrogate = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (
        ++index >= value.length ||
        value.charCodeAt(index) < 0xdc00 ||
        value.charCodeAt(index) > 0xdfff
      )
        return true;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
};
const unsafe = (): never => {
  throw new ReadinessContractError('READINESS_ARTIFACT_UNSAFE');
};
const isArrayIndex = (key: string) =>
  /^(?:0|[1-9]\d*)$/.test(key) && Number(key) < 2 ** 32 - 1;

const signature = (value: object) =>
  Reflect.ownKeys(value)
    .map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) return unsafe();
      return `${typeof key === 'string' ? key : String(key)}:${descriptor.enumerable}:${descriptor.configurable}:${'value' in descriptor ? `${descriptor.writable}:${typeof descriptor.value === 'function' ? descriptor.value.name : typeof descriptor.value}` : `${typeof descriptor.get}:${typeof descriptor.set}`}`;
    })
    .sort()
    .join('|');
const objectSignature = signature(Object.prototype);
const arraySignature = signature(Array.prototype);
const prePrototype = (value: object, array: boolean) => {
  const prototype = Object.getPrototypeOf(value);
  if (array)
    return (
      Array.isArray(prototype) &&
      signature(prototype) === arraySignature &&
      Object.getPrototypeOf(prototype) !== null &&
      signature(Object.getPrototypeOf(prototype)) === objectSignature &&
      Object.getPrototypeOf(Object.getPrototypeOf(prototype)) === null
    );
  return (
    prototype !== null &&
    signature(prototype) === objectSignature &&
    Object.getPrototypeOf(prototype) === null
  );
};

const inspect = (value: unknown, seen: Set<object>, post = false): void => {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (hasLoneSurrogate(value)) unsafe();
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) unsafe();
    return;
  }
  if (typeof value !== 'object' || seen.has(value)) unsafe();
  const objectValue = value as object;
  try {
    seen.add(objectValue);
    const own = Reflect.ownKeys(objectValue);
    if (own.some((key) => typeof key !== 'string')) unsafe();
    const names = Object.getOwnPropertyNames(objectValue);
    const descriptors = Object.getOwnPropertyDescriptors(objectValue);
    if (
      Object.entries(descriptors).some(
        ([key, descriptor]) =>
          !('value' in descriptor) ||
          (key !== 'length' && !descriptor.enumerable),
      )
    )
      unsafe();
    if (Array.isArray(value)) {
      const prototype = Object.getPrototypeOf(objectValue);
      if (
        (post
          ? prototype !== Array.prototype
          : !prePrototype(objectValue, true)) ||
        own.length !== value.length + 1 ||
        !own.includes('length')
      )
        unsafe();
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index);
        if (
          !Object.prototype.hasOwnProperty.call(descriptors, key) ||
          !isArrayIndex(key)
        )
          unsafe();
        inspect(descriptors[key].value, seen, post);
      }
    } else {
      if (
        post
          ? Object.getPrototypeOf(value) !== Object.prototype
          : !prePrototype(objectValue, false)
      )
        unsafe();
      for (const key of names) {
        if (hasLoneSurrogate(key)) unsafe();
        inspect(descriptors[key].value, seen, post);
      }
    }
    seen.delete(objectValue);
  } catch {
    unsafe();
  }
};

/** Captures a validated data-only snapshot; callers must validate semantics separately. */
export function snapshotArtifact(value: unknown): Artifact {
  inspect(value, new Set());
  try {
    const snapshot = structuredClone(value);
    const normalized = JSON.parse(JSON.stringify(snapshot));
    inspect(normalized, new Set(), true);
    return normalized as Artifact;
  } catch {
    return unsafe();
  }
}

const encode = (value: Artifact): string => {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let index = 0; index < value.length; index += 1)
      parts.push(encode(value[index]));
    return `[${parts.join(',')}]`;
  }
  return `{${Object.getOwnPropertyNames(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${encode(value[key])}`)
    .join(',')}}`;
};

export const canonicalJson = (value: unknown) =>
  encode(snapshotArtifact(value));
export const canonicalSha256 = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
