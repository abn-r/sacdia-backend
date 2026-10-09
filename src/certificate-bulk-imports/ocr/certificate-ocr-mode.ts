import type { FileStorageService } from '../../common/services/file-storage.service';
import { decodeOcrProxySecret } from '../../config/ocr-proxy-secret';
import { CloudRunCertificateOcrProvider } from './cloud-run-certificate-ocr.provider';
import type { CertificateOcrProvider } from './certificate-ocr.provider';
import {
  GoogleVisionCertificateOcrProvider,
  type GoogleVisionClientFactory,
} from './google-vision-certificate-ocr.provider';

const ENV_PATTERN = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;
const KID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

type OcrModeConfig = {
  get(key: string): unknown;
};

export function selectCertificateOcrProvider(deps: {
  config: OcrModeConfig;
  storage: FileStorageService;
  visionClientFactory: GoogleVisionClientFactory;
}): CertificateOcrProvider {
  const configured = deps.config.get('OCR_MODE');
  if (
    deps.config.get('NODE_ENV') === 'production' &&
    !isNonEmptyString(configured)
  ) {
    throw new Error('OCR_MODE is required');
  }
  const mode = configured ?? 'direct';
  if (mode === 'direct') {
    return new GoogleVisionCertificateOcrProvider(
      deps.storage,
      deps.config as never,
      deps.visionClientFactory,
    );
  }
  if (mode !== 'remote') {
    throw new Error('OCR_MODE is invalid');
  }
  const url = deps.config.get('OCR_PROXY_URL');
  const environment = deps.config.get('OCR_PROXY_ENV');
  const kid = deps.config.get('OCR_PROXY_KID');
  const secret = deps.config.get('OCR_PROXY_SECRET');
  const decoded = isNonEmptyString(secret)
    ? decodeOcrProxySecret(secret)
    : null;
  if (
    !isNonEmptyString(url) ||
    !isNonEmptyString(environment) ||
    !isNonEmptyString(kid) ||
    !decoded ||
    !isRemoteProxyUrl(url, deps.config.get('NODE_ENV')) ||
    !ENV_PATTERN.test(environment) ||
    !KID_PATTERN.test(kid)
  ) {
    throw new Error('OCR remote configuration is incomplete');
  }
  return new CloudRunCertificateOcrProvider(deps.storage, {
    url,
    environment,
    kid,
    secret: decoded,
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRemoteProxyUrl(value: string, nodeEnv: unknown): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    if (nodeEnv === 'production') return false;
    return url.protocol === 'http:' && url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}
