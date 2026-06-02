const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertSafeTarget,
  buildHeaders,
  calculateCapacity,
  createRotatingForwardedForSetup,
  isLocalTarget,
  normalizeEndpoint,
  parseArgs,
  resolveProfile,
} = require('./benchmark-api');

test('normalizes endpoint paths with a leading slash', () => {
  assert.equal(normalizeEndpoint('api/v1/health'), '/api/v1/health');
  assert.equal(normalizeEndpoint('/api/v1/health'), '/api/v1/health');
});

test('blocks remote targets unless explicitly allowed', () => {
  assert.doesNotThrow(() => assertSafeTarget('http://localhost:3000', false));
  assert.doesNotThrow(() => assertSafeTarget('http://[::1]:3000', false));
  assert.throws(
    () => assertSafeTarget('https://api.example.com', false),
    /BENCH_ALLOW_REMOTE=1/,
  );
  assert.doesNotThrow(() => assertSafeTarget('https://api.example.com', true));
});

test('detects local targets for safe distributed-client simulation', () => {
  assert.equal(isLocalTarget('http://127.0.0.1:3000'), true);
  assert.equal(isLocalTarget('http://[::1]:3000'), true);
  assert.equal(isLocalTarget('https://api.example.com'), false);
});

test('ignores pnpm argument separator', () => {
  const options = parseArgs(['--', '--rotate-x-forwarded-for']);

  assert.equal(options.rotateXForwardedFor, true);
});

test('parses rotating x-forwarded-for simulation flag', () => {
  const options = parseArgs(['--rotate-x-forwarded-for']);

  assert.equal(options.rotateXForwardedFor, true);
});

test('rotating forwarded-for setup keeps base headers and rotates client IPs', () => {
  const calls = [];
  const listeners = {};
  const client = {
    setHeaders: (headers) => calls.push(headers),
    on: (event, listener) => {
      listeners[event] = listener;
    },
  };

  createRotatingForwardedForSetup({ authorization: 'Bearer token' })(client);
  listeners.response();

  assert.equal(calls[0].authorization, 'Bearer token');
  assert.match(calls[0]['x-forwarded-for'], /^10\./);
  assert.notEqual(calls[0]['x-forwarded-for'], calls[1]['x-forwarded-for']);
});

test('parses cli profile and numeric overrides', () => {
  const options = parseArgs([
    '--url',
    'http://localhost:3000',
    '--profile',
    'stress',
    '--endpoint',
    '/api/v1/health',
    '--connections',
    '75',
    '--duration',
    '15',
  ]);

  assert.equal(options.baseUrl, 'http://localhost:3000');
  assert.equal(options.profile, 'stress');
  assert.equal(options.endpoint, '/api/v1/health');
  assert.equal(options.connections, 75);
  assert.equal(options.duration, 15);
});

test('builds headers from json, repeated header flags, and bearer token', () => {
  const headers = buildHeaders({
    authToken: 'token-123',
    headersJson: '{"x-suite":"benchmark"}',
    headerPairs: ['x-run: manual'],
  });

  assert.equal(headers.authorization, 'Bearer token-123');
  assert.equal(headers['x-suite'], 'benchmark');
  assert.equal(headers['x-run'], 'manual');
  assert.equal(headers['content-type'], 'application/json');
});

test('stress profile ramps concurrency in multiple stages', () => {
  const profile = resolveProfile('stress');

  assert.deepEqual(
    profile.stages.map((stage) => stage.connections),
    [25, 50, 100, 200],
  );
});

test('capacity falls back to p97_5 when autocannon does not expose p95', () => {
  const capacity = calculateCapacity(
    [
      {
        name: '5c',
        requests: { average: 850 },
        latency: { p97_5: 16, p99: 28 },
        errors: 0,
        timeouts: 0,
        non2xx: 0,
        requestsTotal: 8500,
      },
    ],
    { maxErrorRate: 0.01, maxP95Ms: 500 },
  );

  assert.equal(capacity.stable, true);
  assert.equal(capacity.stage, '5c');
  assert.equal(capacity.p95Ms, 16);
});

test('capacity selects the highest stable stage under error and latency thresholds', () => {
  const capacity = calculateCapacity(
    [
      {
        name: '25c',
        requests: { average: 600 },
        latency: { p95: 120 },
        errors: 0,
        timeouts: 0,
        non2xx: 0,
        requestsTotal: 12000,
      },
      {
        name: '50c',
        requests: { average: 980 },
        latency: { p95: 280 },
        errors: 0,
        timeouts: 0,
        non2xx: 0,
        requestsTotal: 19600,
      },
      {
        name: '100c',
        requests: { average: 1100 },
        latency: { p95: 900 },
        errors: 0,
        timeouts: 0,
        non2xx: 0,
        requestsTotal: 22000,
      },
    ],
    { maxErrorRate: 0.01, maxP95Ms: 500 },
  );

  assert.equal(capacity.stage, '50c');
  assert.equal(capacity.rps, 980);
  assert.equal(capacity.p95Ms, 280);
});
