import { isHealthProbePath } from './health-probe-path';

describe('isHealthProbePath', () => {
  it.each([
    '/api/v1/health',
    '/health',
    '/api/v1/health/',
    '/api/v1/health?probe=1',
  ])('matches %s', (url) => {
    expect(isHealthProbePath(url)).toBe(true);
  });

  it.each([
    '/api/v1/health/details',
    '/api/v1/health/details?x=1',
    '/api/v1/healthz',
    '/api/v1/clubs/health',
    '/api/v1/users/me',
    '/',
    '',
  ])('does not match %s', (url) => {
    expect(isHealthProbePath(url)).toBe(false);
  });

  it('handles missing urls', () => {
    expect(isHealthProbePath(undefined)).toBe(false);
    expect(isHealthProbePath(null)).toBe(false);
  });
});
