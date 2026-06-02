#!/usr/bin/env node

/**
 * SACDIA API benchmark runner.
 *
 * Measures throughput, latency, error rate, and stress capacity with autocannon.
 * Defaults are intentionally local-only to avoid accidental production load.
 */

const fs = require('node:fs');
const path = require('node:path');
const autocannon = require('autocannon');

const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_ENDPOINT = '/api/v1/health';
const DEFAULT_OUT_DIR = 'reports/benchmarks';

const PROFILES = {
  smoke: {
    description:
      'Validación corta para confirmar que el target responde antes de exigirlo.',
    thresholds: { maxErrorRate: 0.01, maxP95Ms: 500 },
    stages: [{ name: 'smoke-5c', connections: 5, duration: 10, pipelining: 1 }],
  },
  baseline: {
    description:
      'Medición estable de referencia para comparar cambios entre versiones.',
    thresholds: { maxErrorRate: 0.01, maxP95Ms: 500 },
    stages: [
      { name: 'baseline-25c', connections: 25, duration: 30, pipelining: 1 },
    ],
  },
  stress: {
    description:
      'Rampa de concurrencia para encontrar el último escalón estable.',
    thresholds: { maxErrorRate: 0.01, maxP95Ms: 500 },
    stages: [
      { name: 'stress-25c', connections: 25, duration: 30, pipelining: 1 },
      { name: 'stress-50c', connections: 50, duration: 30, pipelining: 1 },
      { name: 'stress-100c', connections: 100, duration: 30, pipelining: 1 },
      { name: 'stress-200c', connections: 200, duration: 30, pipelining: 1 },
    ],
  },
  spike: {
    description:
      'Pico repentino + recuperación para detectar degradación bajo ráfagas.',
    thresholds: { maxErrorRate: 0.02, maxP95Ms: 750 },
    stages: [
      {
        name: 'spike-warmup-25c',
        connections: 25,
        duration: 15,
        pipelining: 1,
      },
      { name: 'spike-200c', connections: 200, duration: 30, pipelining: 1 },
      {
        name: 'spike-recovery-25c',
        connections: 25,
        duration: 15,
        pipelining: 1,
      },
    ],
  },
};

function printHelp() {
  console.log(`SACDIA API benchmark runner

Usage:
  pnpm run benchmark:baseline
  pnpm run benchmark:stress -- --endpoint /api/v1/health
  BENCH_TOKEN=... pnpm run benchmark:baseline -- --endpoint /api/v1/auth/me

Options:
  --profile <smoke|baseline|stress|spike>
  --url <base-url>                  Default: ${DEFAULT_BASE_URL}
  --endpoint <path>                 Default: ${DEFAULT_ENDPOINT}
  --scenario <json-file>            Run multiple targets from a scenario file
  --method <GET|POST|PATCH|PUT>     Default: GET
  --body <json-string>
  --body-file <path>
  --headers <json-string>
  --header <name:value>             Repeatable
  --auth-token <token>              Or BENCH_TOKEN
  --connections <n>                 Override profile with one custom stage
  --duration <seconds>              Override stage duration
  --pipelining <n>                  Default: profile value
  --timeout <seconds>               Default: 10
  --out <dir>                       Default: ${DEFAULT_OUT_DIR}
  --allow-remote                    Same as BENCH_ALLOW_REMOTE=1
  --rotate-x-forwarded-for          Local-only lab mode: simulate many client IPs
  --max-error-rate <decimal>        Default: profile threshold
  --max-p95-ms <ms>                 Default: profile threshold
`);
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    baseUrl: env.BENCH_URL || env.URL || DEFAULT_BASE_URL,
    endpoint: env.BENCH_ENDPOINT || DEFAULT_ENDPOINT,
    profile: env.BENCH_PROFILE || 'baseline',
    method: env.BENCH_METHOD || 'GET',
    body: env.BENCH_BODY,
    bodyFile: env.BENCH_BODY_FILE,
    headersJson: env.BENCH_HEADERS,
    headerPairs: [],
    authToken: env.BENCH_TOKEN,
    scenarioPath: env.BENCH_SCENARIO,
    outDir: env.BENCH_OUT_DIR || DEFAULT_OUT_DIR,
    allowRemote:
      env.BENCH_ALLOW_REMOTE === '1' || env.BENCH_ALLOW_REMOTE === 'true',
    rotateXForwardedFor:
      env.BENCH_ROTATE_X_FORWARDED_FOR === '1' ||
      env.BENCH_ROTATE_X_FORWARDED_FOR === 'true',
    timeout: numberFromEnv(env.BENCH_TIMEOUT_SECONDS, 10),
    connections: undefined,
    duration: undefined,
    pipelining: undefined,
    maxErrorRate: numberFromEnv(env.BENCH_MAX_ERROR_RATE, undefined),
    maxP95Ms: numberFromEnv(env.BENCH_MAX_P95_MS, undefined),
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value for ${arg}`);
      }
      return argv[index];
    };

    switch (arg) {
      case '--':
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--profile':
        options.profile = next();
        break;
      case '--url':
      case '--base-url':
        options.baseUrl = next();
        break;
      case '--endpoint':
        options.endpoint = normalizeEndpoint(next());
        break;
      case '--scenario':
        options.scenarioPath = next();
        break;
      case '--method':
        options.method = next().toUpperCase();
        break;
      case '--body':
        options.body = next();
        break;
      case '--body-file':
        options.bodyFile = next();
        break;
      case '--headers':
        options.headersJson = next();
        break;
      case '--header':
        options.headerPairs.push(next());
        break;
      case '--auth-token':
        options.authToken = next();
        break;
      case '--connections':
        options.connections = parsePositiveInteger(next(), '--connections');
        break;
      case '--duration':
        options.duration = parsePositiveInteger(next(), '--duration');
        break;
      case '--pipelining':
        options.pipelining = parsePositiveInteger(next(), '--pipelining');
        break;
      case '--timeout':
        options.timeout = parsePositiveInteger(next(), '--timeout');
        break;
      case '--out':
        options.outDir = next();
        break;
      case '--allow-remote':
        options.allowRemote = true;
        break;
      case '--rotate-x-forwarded-for':
        options.rotateXForwardedFor = true;
        break;
      case '--max-error-rate':
        options.maxErrorRate = parseNonNegativeNumber(
          next(),
          '--max-error-rate',
        );
        break;
      case '--max-p95-ms':
        options.maxP95Ms = parsePositiveInteger(next(), '--max-p95-ms');
        break;
      default:
        if (!arg.startsWith('-') && !options._legacyEndpointConsumed) {
          options.endpoint = normalizeEndpoint(arg);
          options._legacyEndpointConsumed = true;
          break;
        }
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  options.endpoint = normalizeEndpoint(options.endpoint);
  options.method = options.method.toUpperCase();
  return options;
}

function numberFromEnv(value, fallback) {
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePositiveInteger(value, flagName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flagName} must be a non-negative number`);
  }
  return parsed;
}

function normalizeEndpoint(endpoint) {
  if (!endpoint || endpoint === '/') {
    return '/';
  }
  return endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
}

function assertSafeTarget(baseUrl, allowRemote) {
  if (!isLocalTarget(baseUrl) && !allowRemote) {
    throw new Error(
      `Remote benchmark blocked for ${baseUrl}. Set BENCH_ALLOW_REMOTE=1 or pass --allow-remote when you intentionally target staging/non-local infrastructure.`,
    );
  }
}

function isLocalTarget(baseUrl) {
  const parsedUrl = new URL(baseUrl);
  const hostname = parsedUrl.hostname.toLowerCase();

  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  );
}

function assertRotatingForwardedForSafe(baseUrl, rotateXForwardedFor) {
  if (rotateXForwardedFor && !isLocalTarget(baseUrl)) {
    throw new Error(
      '--rotate-x-forwarded-for is local-only because it intentionally bypasses per-IP rate limiting for lab measurements.',
    );
  }
}

function buildHeaders({ authToken, headersJson, headerPairs = [] } = {}) {
  const headers = { 'content-type': 'application/json' };

  if (headersJson) {
    const parsedHeaders = JSON.parse(headersJson);
    for (const [name, value] of Object.entries(parsedHeaders)) {
      headers[name.toLowerCase()] = String(value);
    }
  }

  for (const pair of headerPairs) {
    const separatorIndex = pair.indexOf(':');
    if (separatorIndex === -1) {
      throw new Error(`Invalid --header value: ${pair}. Expected name:value`);
    }
    const name = pair.slice(0, separatorIndex).trim().toLowerCase();
    const value = pair.slice(separatorIndex + 1).trim();
    if (!name) {
      throw new Error(`Invalid --header value: ${pair}. Header name is empty`);
    }
    headers[name] = value;
  }

  if (authToken) {
    headers.authorization = authToken.toLowerCase().startsWith('bearer ')
      ? authToken
      : `Bearer ${authToken}`;
  }

  return headers;
}

function resolveProfile(name, overrides = {}) {
  const profile = PROFILES[name];
  if (!profile) {
    throw new Error(
      `Unknown profile: ${name}. Expected one of: ${Object.keys(PROFILES).join(', ')}`,
    );
  }

  const thresholds = {
    maxErrorRate: overrides.maxErrorRate ?? profile.thresholds.maxErrorRate,
    maxP95Ms: overrides.maxP95Ms ?? profile.thresholds.maxP95Ms,
  };

  if (overrides.connections) {
    return {
      ...profile,
      thresholds,
      stages: [
        {
          name: `custom-${overrides.connections}c`,
          connections: overrides.connections,
          duration: overrides.duration ?? profile.stages[0].duration,
          pipelining: overrides.pipelining ?? profile.stages[0].pipelining,
        },
      ],
    };
  }

  return {
    ...profile,
    thresholds,
    stages: profile.stages.map((stage) => ({
      ...stage,
      duration: overrides.duration ?? stage.duration,
      pipelining: overrides.pipelining ?? stage.pipelining,
    })),
  };
}

function loadScenario(options) {
  if (!options.scenarioPath) {
    return {
      name: 'single-target',
      targets: [
        {
          name:
            options.endpoint.replace(/^\//, '').replaceAll('/', '-') || 'root',
          endpoint: options.endpoint,
          method: options.method,
          body: readBody(options),
        },
      ],
    };
  }

  const scenarioAbsolutePath = path.resolve(options.scenarioPath);
  const scenario = JSON.parse(fs.readFileSync(scenarioAbsolutePath, 'utf8'));
  if (!Array.isArray(scenario.targets) || scenario.targets.length === 0) {
    throw new Error(
      `Scenario ${options.scenarioPath} must define at least one target`,
    );
  }

  return {
    name:
      scenario.name ||
      path.basename(options.scenarioPath, path.extname(options.scenarioPath)),
    defaults: scenario.defaults || {},
    targets: scenario.targets.map((target) => ({
      ...target,
      endpoint: normalizeEndpoint(target.endpoint),
    })),
  };
}

function readBody(options) {
  if (options.bodyFile) {
    return fs.readFileSync(path.resolve(options.bodyFile), 'utf8');
  }
  return options.body;
}

function joinUrl(baseUrl, endpoint) {
  return `${baseUrl.replace(/\/$/, '')}${normalizeEndpoint(endpoint)}`;
}

function runAutocannon(config) {
  return new Promise((resolve, reject) => {
    autocannon(config, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

async function runBenchmark(options) {
  assertSafeTarget(options.baseUrl, options.allowRemote);
  assertRotatingForwardedForSafe(options.baseUrl, options.rotateXForwardedFor);

  const startedAt = new Date();
  const profile = resolveProfile(options.profile, options);
  const scenario = loadScenario(options);
  const baseHeaders = buildHeaders(options);
  const results = [];

  console.log(`\n🚀 SACDIA API benchmark`);
  console.log(`Target: ${options.baseUrl}`);
  console.log(`Profile: ${options.profile} — ${profile.description}`);
  console.log(`Scenario: ${scenario.name}`);
  if (options.rotateXForwardedFor) {
    console.log(
      'Mode: rotating x-forwarded-for enabled (local lab simulation of many client IPs)',
    );
  }
  console.log(
    `Threshold: errorRate <= ${(profile.thresholds.maxErrorRate * 100).toFixed(2)}%, p95 <= ${profile.thresholds.maxP95Ms}ms`,
  );

  for (const target of scenario.targets) {
    const targetDefaults = scenario.defaults || {};
    const targetHeaders = {
      ...baseHeaders,
      ...(targetDefaults.headers || {}),
      ...(target.headers || {}),
    };
    const method = (
      target.method ||
      targetDefaults.method ||
      options.method
    ).toUpperCase();
    const body =
      target.body !== undefined
        ? stringifyBody(target.body)
        : targetDefaults.body !== undefined
          ? stringifyBody(targetDefaults.body)
          : target.bodyFile
            ? fs.readFileSync(path.resolve(target.bodyFile), 'utf8')
            : targetDefaults.bodyFile
              ? fs.readFileSync(path.resolve(targetDefaults.bodyFile), 'utf8')
              : readBody(options);

    console.log(
      `\n▶ ${target.name || target.endpoint} ${method} ${target.endpoint}`,
    );

    for (const stage of profile.stages) {
      const url = joinUrl(options.baseUrl, target.endpoint);
      console.log(
        `  • ${stage.name}: ${stage.connections} conexiones, ${stage.duration}s`,
      );

      const result = await runAutocannon({
        url,
        method,
        body,
        headers: targetHeaders,
        setupClient: options.rotateXForwardedFor
          ? createRotatingForwardedForSetup(targetHeaders)
          : undefined,
        connections: stage.connections,
        duration: stage.duration,
        pipelining: stage.pipelining,
        timeout: options.timeout,
      });

      const normalized = normalizeResult({
        result,
        target,
        stage,
        url,
        method,
        thresholds: profile.thresholds,
      });
      results.push(normalized);
      printStageSummary(normalized);
    }
  }

  const report = {
    tool: 'sacdia-api-benchmark',
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    profile: options.profile,
    scenario: scenario.name,
    thresholds: profile.thresholds,
    results,
    capacity: calculateCapacity(results, profile.thresholds),
  };

  const reportPath = writeReport(report, options.outDir);
  printCapacity(report.capacity, reportPath);
  return report;
}

function createRotatingForwardedForSetup(headers = {}) {
  let counter = 0;

  const nextHeaders = () => {
    counter += 1;
    return {
      ...headers,
      'x-forwarded-for': generateSyntheticIp(counter),
    };
  };

  return (client) => {
    client.setHeaders(nextHeaders());
    client.on('response', () => {
      client.setHeaders(nextHeaders());
    });
  };
}

function generateSyntheticIp(counter) {
  const secondOctet = (counter >> 16) & 255;
  const thirdOctet = (counter >> 8) & 255;
  const fourthOctet = counter & 255;
  return `10.${secondOctet}.${thirdOctet}.${fourthOctet}`;
}

function stringifyBody(body) {
  if (body === undefined || body === null) {
    return undefined;
  }
  return typeof body === 'string' ? body : JSON.stringify(body);
}

function normalizeResult({ result, target, stage, url, method, thresholds }) {
  const requestsTotal = result.requests?.total ?? 0;
  const errors = result.errors ?? 0;
  const timeouts = result.timeouts ?? 0;
  const non2xx = result.non2xx ?? 0;
  const failed = errors + timeouts + non2xx;
  const errorRate = requestsTotal > 0 ? failed / requestsTotal : 1;
  const tailLatency = getTailLatencyMs(result.latency);

  return {
    target: target.name || target.endpoint,
    endpoint: target.endpoint,
    method,
    url,
    name: stage.name,
    stage,
    requestsTotal,
    requests: result.requests,
    latency: result.latency,
    throughput: result.throughput,
    errors,
    timeouts,
    non2xx,
    statusCodeStats: result.statusCodeStats,
    errorRate,
    stable:
      errorRate <= thresholds.maxErrorRate &&
      tailLatency <= thresholds.maxP95Ms,
  };
}

function calculateCapacity(results, thresholds) {
  const stableStages = results.filter((result) => {
    const requestsTotal = result.requestsTotal ?? result.requests?.total ?? 0;
    const failed =
      (result.errors ?? 0) + (result.timeouts ?? 0) + (result.non2xx ?? 0);
    const errorRate = requestsTotal > 0 ? failed / requestsTotal : 1;
    const tailLatency = getTailLatencyMs(result.latency);
    return (
      errorRate <= thresholds.maxErrorRate && tailLatency <= thresholds.maxP95Ms
    );
  });

  if (stableStages.length === 0) {
    return {
      stable: false,
      message: 'No hubo ningún escalón estable con los umbrales configurados.',
    };
  }

  const winner = stableStages.reduce((best, current) => {
    const bestRps = best.requests?.average ?? 0;
    const currentRps = current.requests?.average ?? 0;
    return currentRps >= bestRps ? current : best;
  });

  const requestsTotal = winner.requestsTotal ?? winner.requests?.total ?? 0;
  const failed =
    (winner.errors ?? 0) + (winner.timeouts ?? 0) + (winner.non2xx ?? 0);

  return {
    stable: true,
    target: winner.target,
    endpoint: winner.endpoint,
    stage: winner.name,
    connections: winner.stage?.connections,
    rps: winner.requests?.average ?? 0,
    p95Ms: getTailLatencyMs(winner.latency),
    p99Ms: winner.latency?.p99 ?? 0,
    errorRate: requestsTotal > 0 ? failed / requestsTotal : 0,
    message: `Capacidad estable estimada: ${(winner.requests?.average ?? 0).toFixed(2)} req/s en ${winner.name}.`,
  };
}

function writeReport(report, outDir) {
  const absoluteOutDir = path.resolve(outDir);
  fs.mkdirSync(absoluteOutDir, { recursive: true });
  const safeTimestamp = report.startedAt
    .replaceAll(':', '-')
    .replaceAll('.', '-');
  const reportPath = path.join(
    absoluteOutDir,
    `${safeTimestamp}-${report.profile}.json`,
  );
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
}

function printStageSummary(result) {
  const rps = result.requests?.average ?? 0;
  const p50 = result.latency?.p50 ?? 0;
  const p95 = getTailLatencyMs(result.latency);
  const p99 = result.latency?.p99 ?? 0;
  const errorRate = result.errorRate * 100;
  const status = result.stable ? '🟢 estable' : '🔴 fuera de umbral';

  console.log(
    `    ${status} | ${rps.toFixed(2)} req/s | p50 ${p50}ms | p95 ${p95}ms | p99 ${p99}ms | errores ${errorRate.toFixed(2)}%`,
  );
}

function getTailLatencyMs(latency) {
  if (!latency) return Number.POSITIVE_INFINITY;
  return latency.p95 ?? latency.p97_5 ?? latency.p99 ?? latency.max ?? 0;
}

function printCapacity(capacity, reportPath) {
  console.log('\n📊 Resultado');
  console.log(`  ${capacity.message}`);
  if (capacity.stable) {
    console.log(`  Target estable: ${capacity.target} ${capacity.endpoint}`);
    console.log(`  Concurrencia: ${capacity.connections}`);
    console.log(
      `  Latencia: p95 ${capacity.p95Ms}ms / p99 ${capacity.p99Ms}ms`,
    );
    console.log(`  Error rate: ${(capacity.errorRate * 100).toFixed(2)}%`);
  }
  console.log(`  Reporte JSON: ${reportPath}\n`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }
  await runBenchmark(options);
}

module.exports = {
  assertSafeTarget,
  buildHeaders,
  calculateCapacity,
  createRotatingForwardedForSetup,
  isLocalTarget,
  normalizeEndpoint,
  parseArgs,
  resolveProfile,
  runBenchmark,
  main,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`\n❌ Benchmark failed: ${error.message}`);
    process.exit(1);
  });
}
