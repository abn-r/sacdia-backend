import { ValidateBy, type ValidationOptions } from 'class-validator';
import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

const MAX_FILE_REF_LENGTH = 500;
const STORAGE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const R2_PUBLIC_URL_PREFIX = 'R2_PUBLIC_URL_';

/**
 * Hosts a future OCR fetcher may contact.
 * Built from R2_PUBLIC_URL_* plus optional CERTIFICATE_IMPORT_ALLOWED_FILE_HOSTS.
 * Private/loopback hosts never enter the set, even if listed in env.
 */
export function collectCertificateImportAllowedHosts(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
  const hosts = new Set<string>();

  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(R2_PUBLIC_URL_PREFIX) || !value) {
      continue;
    }
    const host = hostnameFromAllowlistEntry(value);
    if (host) {
      hosts.add(host);
    }
  }

  const extra = env.CERTIFICATE_IMPORT_ALLOWED_FILE_HOSTS ?? '';
  for (const part of extra.split(',')) {
    const host = hostnameFromAllowlistEntry(part);
    if (host) {
      hosts.add(host);
    }
  }

  return hosts;
}

export function isCertificateImportFileRef(
  value: string,
  allowedHosts: ReadonlySet<string> = collectCertificateImportAllowedHosts(),
): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_FILE_REF_LENGTH) {
    return false;
  }

  if (looksLikeUrl(trimmed)) {
    return isAllowedHttpsFileUrl(trimmed, allowedHosts);
  }

  return isStorageKey(trimmed);
}

export function normalizeCertificateImportFileRef(
  value: unknown,
  allowedHosts: ReadonlySet<string> = collectCertificateImportAllowedHosts(),
): string {
  if (typeof value !== 'string') {
    throw new AppBadRequestException(
      ErrorCode.CERTIFICATE_IMPORT_FILE_URL_INVALID,
    );
  }

  const trimmed = value.trim();
  if (!isCertificateImportFileRef(trimmed, allowedHosts)) {
    throw new AppBadRequestException(
      ErrorCode.CERTIFICATE_IMPORT_FILE_URL_INVALID,
    );
  }

  return trimmed;
}

export function IsCertificateImportFileRef(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isCertificateImportFileRef',
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && isCertificateImportFileRef(value);
        },
        defaultMessage(): string {
          return 'file_url must be a storage key or an https URL on an allowed host';
        },
      },
    },
    validationOptions,
  );
}

function looksLikeUrl(value: string): boolean {
  return value.includes('://') || value.startsWith('//');
}

function isStorageKey(value: string): boolean {
  if (value.startsWith('/') || value.endsWith('/')) {
    return false;
  }

  return value.split('/').every((segment) => {
    if (!segment || segment === '.' || segment === '..') {
      return false;
    }
    return STORAGE_SEGMENT.test(segment);
  });
}

function isAllowedHttpsFileUrl(
  value: string,
  allowedHosts: ReadonlySet<string>,
): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') {
    return false;
  }
  if (url.username || url.password) {
    return false;
  }
  if (url.port !== '') {
    return false;
  }

  const host = normalizeHostname(url.hostname);
  if (!host || isBlockedHostname(host)) {
    return false;
  }

  return allowedHosts.has(host);
}

function hostnameFromAllowlistEntry(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = trimmed.includes('://')
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
    if (url.username || url.password) {
      return null;
    }
    const host = normalizeHostname(url.hostname);
    if (!host || isBlockedHostname(host)) {
      return null;
    }
    return host;
  } catch {
    return null;
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/\.$/, '').toLowerCase();
}

function isBlockedHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return true;
  }
  if (hostname.includes(':')) {
    return true;
  }

  const octets = ipv4Octets(hostname);
  if (!octets) {
    return false;
  }

  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  return false;
}

function ipv4Octets(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return Number.NaN;
    }
    return Number(part);
  });

  if (
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null;
  }

  return octets as [number, number, number, number];
}
