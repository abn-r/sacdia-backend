# Coding Standards

Use these language-agnostic standards when review criteria are unclear.

## Design

- Prefer explicit contracts over implicit behavior.
- Keep modules small, composable, and dependency-light.
- Favor pure functions for business logic where practical.

## Error Handling

- Return actionable errors with context.
- Avoid swallowing exceptions silently.
- Preserve original error causes when wrapping.

## API and Interface Stability

- Version breaking API changes.
- Document payload and response shape changes.
- Keep defaults safe and unsurprising.

## Testing Quality Bar

- Test observable behavior, not private implementation details.
- Add regression tests for each confirmed bug fix.
- Use deterministic assertions; avoid time-based flakiness.

## Review Feedback Style

- Prioritize correctness and security over style.
- Tie each finding to impact.
- Provide a concrete, minimal fix suggestion.
