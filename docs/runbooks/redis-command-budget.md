# Redis command budget (BullMQ + Upstash)

Upstash free tier = 500,000 commands/month (~11.6 commands/min on average).
This runbook explains where commands go, which knobs exist and what each one
costs in behaviour.

## Where commands go

| Consumer | Cost | Notes |
| --- | --- | --- |
| BullMQ worker, idle | per `drainDelay`: 1 `BZPOPMIN` + 1 `moveToActive` script; per `stalledInterval`: 1 stalled-check script | 6 workers run in this process (see below) |
| BullMQ worker, active job | 1 lock-renewal script per `lockDuration / 2` per running job | only while a job runs |
| BullMQ `Queue` (producers) | 0 idle; a few commands per `add` | no `QueueEvents`, no repeatable jobs / schedulers in this codebase |
| Throttler (`RedisThrottlerStorage`) | 3 `EVAL` per request (one per tier: short/medium/long) | `GET /health` is exempt (0 commands) |
| Auth path (cache-manager / keyv) | ~2 GET for token blacklist + 1 GET (+ SET on miss) for the authorization context per authenticated request | |
| Cron locks (`DistributedLockService`) | get + set + del per run (~3-5 commands) | `*/15` crons: activities reminder, investiture reminder; hourly membership expiry |

Workers (queue name -> processor): `notifications`, `achievements`, `emails`
(limiter: 90 jobs/day), `background-jobs`, `master-honors`,
`certificate-import-ocr` (concurrency 1).

## Idle estimate (6 workers, no traffic)

Assumptions: BullMQ 5.81.0 defaults (`drainDelay` 5 s, `stalledInterval`
30 s, from `node_modules/bullmq/dist/esm/classes/worker.js`); each idle cycle
= `BZPOPMIN` (timeout) + `moveToActive` = 2 commands; the stalled check is one
script call per worker per interval; Upstash bills each of those as one
command. Not measured against the Upstash dashboard.

| Setting | per worker | 6 workers / min | 6 workers / month (30 d) |
| --- | --- | --- | --- |
| Before: drainDelay 5 s, stalled 30 s | 24 + 2 = 26 / min | 156 | ~6.7 M |
| After (defaults): drainDelay 30 s, stalled 300 s | 4 + 0.2 = 4.2 / min | 25.2 | ~1.09 M |
| drainDelay 60 s, stalled 300 s | 2 + 0.2 = 2.2 / min | 13.2 | ~570 k |
| drainDelay 60 s, only `notifications` + `achievements` on | 2.2 / min | 4.4 | ~190 k |

`certificate-import-ocr` checks for stalled jobs every 60 s instead of 300 s
(`STALLED_INTERVAL_MS_BY_QUEUE` in `src/config/bullmq-workers.config.ts`): 1
call/min instead of 0.2, about +35 k commands a month (~7% of the 500 k free
tier) on top of the rows above. Each running instance sends its own call.

The "before" figure is far above what the incident shows (quota gone mid
month), so the model over-counts in absolute terms (the Render free plan
sleeps the process when idle, and Upstash may bill blocking calls
differently). Use the relative reduction (~84% with defaults, ~92% with 60 s),
not the absolute numbers, and confirm with the Upstash usage graph.

The free tier cannot be guaranteed from code alone: with 6 workers the floor
is ~13 commands/min at `drainDelay` 60 s, and every authenticated request adds
~6 commands (3 throttler + auth cache). Real traffic needs either fewer
workers (see below) or a paid / self-hosted Redis.

## Knobs

All optional, validated in `src/config/env.validation.ts`, read by
`src/config/bullmq-workers.config.ts`.

| Variable | Default | Effect |
| --- | --- | --- |
| `BULLMQ_WORKER_DRAIN_DELAY_SECONDS` | `30` (1-300) | Seconds an idle worker blocks waiting for a job. |
| `BULLMQ_WORKER_STALLED_INTERVAL_MS` | `300000` (30000-3600000) | Stalled-job check interval. Always clamped to at least the queue's `lockDuration`. |
| `BULLMQ_WORKERS_ENABLED` | `true` | `false` creates no worker in this process. |
| `THROTTLER_FAIL_OPEN` | `false` | Legacy alias. `false` (fail-closed): a Redis error in the throttler surfaces as a 500, so rate limiting is never bypassed. `true` (opt-in): same as `THROTTLER_REDIS_FALLBACK=open`. Superseded by `THROTTLER_REDIS_FALLBACK`, see `redis-outage.md`. |
| `THROTTLER_REDIS_FALLBACK` | `closed` | `closed` / `memory` / `open`: what the throttler does when Redis errors. See `redis-outage.md`. |
| `BULLMQ_DISABLED_QUEUES` | empty | Comma-separated queues whose worker is not created (`notifications,achievements,emails,background-jobs,master-honors,certificate-import-ocr`). Unknown names fail validation. |

Fixed (not env): OCR `lockDuration` 60 s (was 30 s); email
`maximumRateLimitDelay` 5 min (was 30 s).

## Worst-case latency introduced

- `drainDelay` 5 -> 30 s: new jobs wake an idle worker immediately (BullMQ 5
  adds a marker that unblocks `BZPOPMIN`), so normal latency is unchanged.
  Worst case is a lost marker (Redis restart/failover): the job waits up to
  `drainDelay` (30 s). While delayed jobs exist (retry backoffs) BullMQ caps
  the block at 10 s regardless of `drainDelay`.
- `stalledInterval` 30 s -> 300 s: a job orphaned by a crashed worker is
  recovered after its lock expires plus up to two stalled checks, so up to
  ~10 min instead of ~1.5 min. OCR keeps 60 s (recovery in ~1-2 min) because a
  user waits on that screen.
- Deploys and restarts: `main.ts` calls `app.enableShutdownHooks()`, so on
  SIGTERM the OCR worker drains its in-flight job in
  `beforeApplicationShutdown`, before Prisma and the Vision client close in
  `onApplicationShutdown`. `render.yaml` sets `maxShutdownDelaySeconds: 90` so
  Render waits for an OCR call (up to ~40 s) before SIGKILL. Only a crash, an
  OOM kill or SIGKILL still leaves an orphaned job for the stalled check.
  Before this, no shutdown hooks ran and a deploy behaved like a crash.
- The stalled-check key is shared per queue, so multiple instances do not
  multiply the checks' work, but each instance still sends its own script
  call (counted above).
- OCR `lockDuration` 30 -> 60 s: an orphaned OCR job is detected up to 30 s
  later, but a slow event loop is less likely to lose the lock mid-job.
- Email `maximumRateLimitDelay` 30 s -> 5 min: only while the 90/day limiter is
  holding; delayed retries promoted during that time can start up to 5 min late.

## What stops working when a worker is disabled

Disabled workers are not registered as providers. Producers (`Queue.add`) keep
working, so jobs are accepted and pile up as `waiting` until some process with
that worker enabled consumes them. Nothing is lost, nothing is processed.

| Queue | Effect while disabled |
| --- | --- |
| `notifications` | No push notifications / realtime invalidations / broadcasts are delivered. |
| `achievements` | Achievement evaluation and retroactive evaluation stop; no unlock notifications. |
| `emails` | No transactional email (verification, password reset, export ready, cron alerts, investiture notices). |
| `background-jobs` | Finance-period closing, rankings recalculation, monthly-report PDFs and data exports are enqueued but never run. The cron triggers still fire and lock. |
| `master-honors` | Master-honor recalculation stops. |
| `certificate-import-ocr` | Uploaded certificate batches stay in `OCR_QUEUED`. |

Do not disable a worker in the only running instance unless the feature is
intentionally off. Typical use: run workers on one instance and set
`BULLMQ_WORKERS_ENABLED=false` on web-only instances or local dev.

## Redis outage behaviour (rate limiting)

- `GET /api/v1/health` never touches Redis (throttler skipped) so the Render
  health check stays green when Redis is down or over quota.
- The Redis throttler fails closed by default: if Redis errors, throttled
  routes answer 500 instead of bypassing rate limiting (login included). This
  is the security contract enforced by
  `src/config/redis-throttler.storage.integration.spec.ts`.
- `THROTTLER_FAIL_OPEN=true` (legacy, equivalent to
  `THROTTLER_REDIS_FALLBACK=open`) is an explicit opt-in for availability over
  protection: requests pass unthrottled while Redis errors (one error log per
  outage, then a recovery log) and Redis is retried after a 15 s cooldown.
  Only enable it consciously, e.g. briefly during a known quota outage.
  `THROTTLER_REDIS_FALLBACK=memory` keeps rate limiting on (per instance)
  during the outage.
- Boot: by default the API still refuses to start in production if Redis is
  unreachable at boot (cache and throttler readiness probes). Set
  `REDIS_BOOT_OPTIONAL=true` to let it start anyway. Everything about running
  through a Redis outage (boot flag, degraded auth, throttler fallback,
  recommended Render values, residual risk) is in `redis-outage.md`.
