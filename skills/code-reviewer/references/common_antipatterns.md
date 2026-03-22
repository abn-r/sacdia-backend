# Common Antipatterns

Use this file to spot recurring high-risk patterns quickly.

## Security and Safety

- Dynamic code execution (`eval`, `exec`) on untrusted input.
- String-built SQL or shell commands without safe parameterization.
- Hardcoded secrets, tokens, passwords, or private keys.

## Reliability

- Bare `except` blocks and swallowed exceptions.
- Network calls without timeout/retry policy.
- Shared mutable global state across request handlers.

## Performance

- N+1 database fetch loops.
- Recomputing expensive values inside tight loops.
- Synchronous blocking calls in async code paths.

## Maintainability

- God objects/functions with mixed responsibilities.
- Copy-pasted business rules across services.
- Hidden side effects in getters/utilities.

## Testing

- Assertions on implementation details only.
- Missing tests for failure paths.
- Flaky tests depending on wall-clock timing.
