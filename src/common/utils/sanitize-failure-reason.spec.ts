import {
  FAILURE_REASON_MAX_LENGTH,
  sanitizeFailureReason,
} from './sanitize-failure-reason';

describe('sanitizeFailureReason', () => {
  it('returns null for null, undefined and empty input', () => {
    expect(sanitizeFailureReason(null)).toBeNull();
    expect(sanitizeFailureReason(undefined)).toBeNull();
    expect(sanitizeFailureReason('  \n ')).toBeNull();
  });

  it('keeps plain messages untouched', () => {
    expect(sanitizeFailureReason('Connection timed out')).toBe(
      'Connection timed out',
    );
  });

  it('strips absolute paths and code frames from Prisma errors', () => {
    const raw = [
      '',
      'Invalid `this.prisma.users.findMany()` invocation in',
      '/Users/abner/Documents/sacdia-backend/src/notifications/notifications.processor.ts:940:30',
      '',
      '  937 const x = 1;',
      '→ 940 await this.prisma.users.findMany({',
      '         ~~~~~~~~',
      'Unknown argument `foo`. Available options are marked with ?.',
    ].join('\n');

    const out = sanitizeFailureReason(raw)!;
    expect(out).toContain('Unknown argument `foo`');
    expect(out).toContain('invocation in');
    expect(out).not.toMatch(/\/Users|\.ts|940|937|~~~/);
  });

  it('drops stack frames and relative/windows locations', () => {
    const raw = [
      'Boom at src/a/b.service.ts:12:3 and C:\\app\\src\\x.js:4:1',
      '    at Foo.bar (/srv/app/dist/foo.js:10:5)',
      '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
    ].join('\n');
    const out = sanitizeFailureReason(raw)!;
    expect(out).toBe('Boom at and');
  });

  it('does not mangle dates or urls', () => {
    expect(
      sanitizeFailureReason('Bad date 10/12/2024 for https://x.io/a/b'),
    ).toBe('Bad date 10/12/2024 for https://x.io/a/b');
  });

  it('caps the length', () => {
    const out = sanitizeFailureReason('a'.repeat(5000))!;
    expect(out.length).toBe(FAILURE_REASON_MAX_LENGTH);
    expect(out.endsWith('…')).toBe(true);
  });
});
