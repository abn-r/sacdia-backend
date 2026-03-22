# Code Review Checklist

Use this checklist during PR review. Treat each item as pass/fail or requires follow-up.

## Correctness

- Confirm behavior matches requirements and acceptance criteria.
- Verify edge cases (null, empty, bounds, retries, timeouts).
- Verify failure modes return safe and actionable errors.

## Regression Risk

- Identify behavior changes in shared utilities or base classes.
- Check backward compatibility for APIs, events, and schema contracts.
- Confirm feature flags/defaults preserve old behavior when required.

## Security

- Validate all external input.
- Check authorization rules at trust boundaries.
- Avoid secret leakage (logs, source, responses).
- Confirm safe defaults for auth, cookies, CORS, and token handling.

## Data and State

- Verify migrations are reversible or have rollback guidance.
- Confirm transactional integrity and idempotency where needed.
- Check race conditions and concurrent update behavior.

## Performance and Reliability

- Check N+1 queries, repeated remote calls, and unnecessary allocations.
- Validate timeout, retry, and circuit-breaker behavior for integrations.
- Confirm observability: logs, metrics, traces for critical paths.

## Tests

- Confirm tests cover happy path, edge cases, and failure path.
- Verify changed logic has targeted unit/integration coverage.
- Ensure flaky patterns are not introduced (sleep-based timing, global state coupling).

## Maintainability

- Keep functions cohesive and naming clear.
- Avoid hidden side effects and ambiguous abstractions.
- Keep comments focused on why, not what.
