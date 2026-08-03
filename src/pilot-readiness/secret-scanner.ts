import { ReadinessContractError, snapshotArtifact } from './readiness-artifact';

const forbiddenKey =
  /(?:password|secret|token|credential|api.?key|private.?key|email|phone|address|birth|minor|child|guardian|health|medical|allerg|disease|medicine|blood|insurance|salud|menor|seguro|alerg|medicin|enfermedad|sangre|command|script|path|url|uri)/i;
const forbiddenValue = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\./,
  /\b[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)\s*=/i,
  /(?:postgres(?:ql)?|redis|amqp|mongodb):\/\//i,
  /(^|\s)(?:\.{0,2}\/|[A-Za-z]:\\)/,
  /(?:&&|\|\||;|`|\$\(|\b(?:curl|wget|bash|sh|psql)\s)/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
];
const exposure = (): never => {
  throw new ReadinessContractError('READINESS_MANIFEST_SECRET_EXPOSURE');
};
const highEntropy = (value: string) => {
  const candidates = value.match(/[A-Za-z0-9+/=_-]{40,}/g) ?? [];
  return candidates.some((candidate) => new Set(candidate).size >= 12);
};
const protectedVocabulary = (value: string) => {
  const normalized = value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en-US');
  return /(?<![\p{L}\p{N}])(?:health|medical|allerg(?:y|ies)|disease|medicine|medications?|blood|minor|child|guardian|insurance|salud|menores?|seguros?|alergias?|medicinas?|medicamentos?|medicacion(?:es)?|enfermedades?|sangre)(?![\p{L}\p{N}])/u.test(
    normalized,
  );
};
const contractualHash = (path: string, value: string) =>
  (path === 'release.commit' && /^[0-9a-f]{7,64}$/.test(value)) ||
  (path === 'integrity.digest' &&
    /^(?:[0-9a-f]{64}|[0-9a-f]{128})$/.test(value)) ||
  (/^gates\.\d+\.evidence\.\d+\.sha256$/.test(path) &&
    /^[0-9a-f]{64}$/.test(value));

export function assertArtifactContainsNoSecrets(value: unknown): void {
  const snapshot = snapshotArtifact(value);
  const visit = (input: unknown, path = ''): void => {
    if (Array.isArray(input)) {
      for (let index = 0; index < input.length; index += 1)
        visit(input[index], `${path}.${index}`);
      return;
    }
    if (input && typeof input === 'object') {
      for (const key of Object.keys(input)) {
        const next = path ? `${path}.${key}` : key;
        if (
          forbiddenKey.test(key) &&
          !['origins.api', 'origins.admin'].includes(next)
        )
          exposure();
        visit((input as Record<string, unknown>)[key], next);
      }
      return;
    }
    if (
      typeof input !== 'string' ||
      ['origins.api', 'origins.admin'].includes(path)
    )
      return;
    if (
      /https?:\/\//i.test(input) ||
      forbiddenValue.some((pattern) => pattern.test(input)) ||
      protectedVocabulary(input) ||
      (highEntropy(input) && !contractualHash(path, input))
    )
      exposure();
  };
  visit(snapshot);
}
