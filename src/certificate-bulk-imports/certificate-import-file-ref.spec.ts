import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  collectCertificateImportAllowedHosts,
  isCertificateImportFileRef,
  normalizeCertificateImportFileRef,
} from './certificate-import-file-ref';

const allowed = new Set(['files.example', 'pub-abc.r2.dev']);

describe('certificate-import-file-ref', () => {
  describe('isCertificateImportFileRef', () => {
    it.each([
      'evidence/cert.jpg',
      'certificate-imports/user-1/2026/cert_1.webp',
      'a',
    ])('accepts storage key %s', (value) => {
      expect(isCertificateImportFileRef(value, allowed)).toBe(true);
    });

    it.each([
      'https://files.example/evidence/cert.jpg',
      'https://pub-abc.r2.dev/cert.jpg',
      'https://FILES.EXAMPLE/cert.jpg',
    ])('accepts https URL on an allowed host %s', (value) => {
      expect(isCertificateImportFileRef(value, allowed)).toBe(true);
    });

    it.each([
      '',
      '   ',
      '../etc/passwd',
      '/etc/passwd',
      'evidence//cert.jpg',
      'evidence/./cert.jpg',
      'evidence/../cert.jpg',
      'C:\\windows\\cert.jpg',
      'evidence/foo bar.jpg',
      'https://evil.example/cert.jpg',
      'http://files.example/cert.jpg',
      'https://files.example:8443/cert.jpg',
      'https://user:pass@files.example/cert.jpg',
      'https://127.0.0.1/latest/meta-data',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/cert.jpg',
      'https://[::1]/cert.jpg',
      'file:///etc/passwd',
      '//files.example/cert.jpg',
    ])('rejects %s', (value) => {
      expect(isCertificateImportFileRef(value, allowed)).toBe(false);
    });

    it('rejects an otherwise allowed host when no hosts are configured', () => {
      expect(
        isCertificateImportFileRef('https://files.example/cert.jpg', new Set()),
      ).toBe(false);
    });
  });

  describe('collectCertificateImportAllowedHosts', () => {
    it('collects R2 public URL hosts and extra hosts', () => {
      const hosts = collectCertificateImportAllowedHosts({
        R2_PUBLIC_URL_EVIDENCE_FILES: 'https://cdn.example/evidence',
        R2_PUBLIC_URL_RESOURCES_FILES: 'https://pub-abc.r2.dev',
        CERTIFICATE_IMPORT_ALLOWED_FILE_HOSTS:
          'files.sacdia.app, https://extra.example',
        R2_BUCKET_EVIDENCE_FILES: 'not-a-url',
      });

      expect(hosts).toEqual(
        new Set([
          'cdn.example',
          'pub-abc.r2.dev',
          'files.sacdia.app',
          'extra.example',
        ]),
      );
    });

    it('drops private and loopback hosts even if listed', () => {
      const hosts = collectCertificateImportAllowedHosts({
        R2_PUBLIC_URL_EVIDENCE_FILES: 'https://127.0.0.1/evidence',
        CERTIFICATE_IMPORT_ALLOWED_FILE_HOSTS: 'localhost,169.254.169.254',
      });

      expect(hosts.size).toBe(0);
    });
  });

  describe('normalizeCertificateImportFileRef', () => {
    it('trims a valid key', () => {
      expect(
        normalizeCertificateImportFileRef('  evidence/cert.jpg  ', allowed),
      ).toBe('evidence/cert.jpg');
    });

    it('throws CERTIFICATE_IMPORT_FILE_URL_INVALID for a blocked URL', () => {
      expect(() =>
        normalizeCertificateImportFileRef('http://127.0.0.1/secret', allowed),
      ).toThrow(AppBadRequestException);

      try {
        normalizeCertificateImportFileRef('http://127.0.0.1/secret', allowed);
      } catch (error) {
        expect(error).toMatchObject({
          code: ErrorCode.CERTIFICATE_IMPORT_FILE_URL_INVALID,
        });
      }
    });
  });
});
