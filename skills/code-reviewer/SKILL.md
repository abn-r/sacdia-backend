---
name: code-reviewer
description: Comprehensive pull request and code review workflow for TypeScript, JavaScript, Python, Go, Swift, and Kotlin. Use when reviewing pull requests, giving actionable code feedback, identifying regressions or security risks, generating review checklists, or producing structured review reports with prioritized findings.
---

# Code Reviewer

Use this skill to run a consistent, evidence-based code review workflow.

## Quick Start

1. Analyze the PR scope.

```bash
python scripts/pr_analyzer.py --repo <repo-path> --base <base-ref> --head <head-ref> --format json --output /tmp/pr-analysis.json
```

2. Scan code quality and security signals.

```bash
python scripts/code_quality_checker.py <target-path> --format json --output /tmp/quality-report.json
```

3. Generate a markdown review report.

```bash
python scripts/review_report_generator.py --pr /tmp/pr-analysis.json --quality /tmp/quality-report.json --output review-report.md
```

## Workflow

### 1) Scope the change

- Run `scripts/pr_analyzer.py`.
- Inspect file type distribution, churn, and risk signals.
- Prioritize high-risk areas first (auth, permissions, secrets, migrations, dependency updates).

### 2) Run static quality checks

- Run `scripts/code_quality_checker.py` on changed modules or the full repo.
- Focus on high and medium severity findings before style-only feedback.
- Treat findings as leads; confirm with code context before reporting.

### 3) Apply review checklist

- Use `references/code_review_checklist.md` for the default review flow.
- Use `references/coding_standards.md` when you need cross-language consistency guidance.
- Use `references/common_antipatterns.md` when you suspect recurring architectural or reliability issues.

### 4) Produce final feedback

- Run `scripts/review_report_generator.py` to draft a shareable report.
- Present findings ordered by severity, each with path and line references when possible.
- Separate confirmed defects from suggestions.

## Script Inputs

### `scripts/pr_analyzer.py`

- Use when comparing branches, commits, or PR ranges.
- Accepts `--base` and `--head` refs.
- Emits summary metrics and risk signals.

### `scripts/code_quality_checker.py`

- Use when scanning source trees for risky patterns.
- Supports TypeScript, JavaScript, Python, Go, Swift, and Kotlin.
- Emits findings with severity and evidence.

### `scripts/review_report_generator.py`

- Use when converting analyzer outputs into a final markdown report.
- Combines PR scope + quality findings into one prioritized summary.

## Output Contract

When using this skill for human-facing review feedback:

1. List findings first, sorted by severity.
2. Include precise file references.
3. Explain impact and suggested fix in one short paragraph per finding.
4. Call out assumptions and unknowns explicitly.
