/**
 * Masks an email address for safe logging. Example: ab***@gmail.com
 * Prevents PII leakage in log aggregation systems.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return 'unknown';
  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) return '***';
  const visibleLocal =
    localPart.length <= 2 ? (localPart[0] ?? '*') : localPart.slice(0, 2);
  return `${visibleLocal}***@${domain}`;
}
