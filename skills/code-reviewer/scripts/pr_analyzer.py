#!/usr/bin/env python3
"""Analyze a git range and surface review risk signals."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

STATUS_MAP = {
    "A": "added",
    "M": "modified",
    "D": "deleted",
    "R": "renamed",
    "C": "copied",
    "T": "type_changed",
}

EXTENSION_MAP = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".go": "go",
    ".swift": "swift",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".json": "config",
    ".yaml": "config",
    ".yml": "config",
    ".toml": "config",
    ".md": "docs",
}

DEPENDENCY_FILES = {
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "requirements.txt",
    "poetry.lock",
    "Pipfile.lock",
    "go.mod",
    "go.sum",
    "Cargo.lock",
}


@dataclass
class FileChange:
    path: str
    status: str
    additions: int = 0
    deletions: int = 0
    previous_path: Optional[str] = None


class GitCommandError(RuntimeError):
    pass


def run_git(repo_path: Path, args: List[str]) -> str:
    cmd = ["git", "-C", str(repo_path), *args]
    try:
        result = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        raise GitCommandError(exc.stderr.strip() or exc.stdout.strip()) from exc
    return result.stdout


def parse_name_status(output: str) -> Dict[str, FileChange]:
    changes: Dict[str, FileChange] = {}
    for raw_line in output.splitlines():
        if not raw_line.strip():
            continue
        parts = raw_line.split("\t")
        status_token = parts[0]
        status_key = status_token[0]
        status = STATUS_MAP.get(status_key, "modified")

        if status_key in {"R", "C"} and len(parts) >= 3:
            previous_path = parts[1]
            path = parts[2]
        elif len(parts) >= 2:
            previous_path = None
            path = parts[1]
        else:
            continue

        changes[path] = FileChange(path=path, status=status, previous_path=previous_path)
    return changes


def parse_numstat(output: str, changes: Dict[str, FileChange]) -> None:
    for raw_line in output.splitlines():
        if not raw_line.strip():
            continue
        parts = raw_line.split("\t", 2)
        if len(parts) != 3:
            continue
        added_raw, deleted_raw, path = parts
        additions = int(added_raw) if added_raw.isdigit() else 0
        deletions = int(deleted_raw) if deleted_raw.isdigit() else 0

        if path not in changes:
            changes[path] = FileChange(path=path, status="modified")

        changes[path].additions = additions
        changes[path].deletions = deletions


def language_for(path: str) -> str:
    suffix = Path(path).suffix.lower()
    if "/test" in path or "/tests" in path or path.endswith("_test.py"):
        return "tests"
    return EXTENSION_MAP.get(suffix, "other")


def collect_risk_signals(file_changes: List[FileChange]) -> List[Dict[str, object]]:
    signals: List[Dict[str, object]] = []

    source_paths = [
        fc.path
        for fc in file_changes
        if language_for(fc.path) in {"typescript", "javascript", "python", "go", "swift", "kotlin"}
    ]
    test_paths = [fc.path for fc in file_changes if language_for(fc.path) == "tests"]

    auth_paths = [
        fc.path
        for fc in file_changes
        if any(token in fc.path.lower() for token in ("auth", "permission", "rbac", "acl", "policy"))
    ]
    if auth_paths:
        signals.append(
            {
                "severity": "high",
                "title": "Authentication/authorization paths changed",
                "details": "Review access control logic, privilege escalation paths, and default policies.",
                "paths": auth_paths,
            }
        )

    migration_paths = [
        fc.path
        for fc in file_changes
        if any(token in fc.path.lower() for token in ("migration", "schema", "ddl", "seed"))
    ]
    if migration_paths:
        signals.append(
            {
                "severity": "medium",
                "title": "Database schema or migration files changed",
                "details": "Confirm backward compatibility, rollbacks, and data safety.",
                "paths": migration_paths,
            }
        )

    dependency_paths = [fc.path for fc in file_changes if Path(fc.path).name in DEPENDENCY_FILES]
    if dependency_paths:
        signals.append(
            {
                "severity": "medium",
                "title": "Dependency manifest changes detected",
                "details": "Review new packages, major version bumps, and supply-chain risk.",
                "paths": dependency_paths,
            }
        )

    if source_paths and not test_paths:
        signals.append(
            {
                "severity": "medium",
                "title": "Source changed without obvious test updates",
                "details": "Confirm whether regression coverage is sufficient.",
                "paths": source_paths[:20],
            }
        )

    large_churn_paths = [
        fc.path for fc in file_changes if (fc.additions + fc.deletions) >= 400
    ]
    if large_churn_paths:
        signals.append(
            {
                "severity": "medium",
                "title": "Large file churn detected",
                "details": "Large diffs increase review blind spots; split or review carefully.",
                "paths": large_churn_paths,
            }
        )

    return signals


def gather_branch_data(repo_path: Path, base: str, head: str) -> Dict[str, object]:
    name_status_out = run_git(repo_path, ["diff", "--name-status", f"{base}...{head}"])
    numstat_out = run_git(repo_path, ["diff", "--numstat", f"{base}...{head}"])
    commits_out = run_git(repo_path, ["log", "--oneline", f"{base}..{head}"])

    changes = parse_name_status(name_status_out)
    parse_numstat(numstat_out, changes)

    file_changes = list(changes.values())
    language_counts = Counter(language_for(fc.path) for fc in file_changes)
    status_counts = Counter(fc.status for fc in file_changes)

    total_additions = sum(fc.additions for fc in file_changes)
    total_deletions = sum(fc.deletions for fc in file_changes)
    risk_signals = collect_risk_signals(file_changes)

    payload = {
        "scope": {
            "repo": str(repo_path),
            "base": base,
            "head": head,
        },
        "summary": {
            "files_changed": len(file_changes),
            "additions": total_additions,
            "deletions": total_deletions,
            "net": total_additions - total_deletions,
            "commits": len([line for line in commits_out.splitlines() if line.strip()]),
        },
        "language_breakdown": dict(language_counts),
        "status_breakdown": dict(status_counts),
        "risk_signals": risk_signals,
        "changes": [
            {
                "path": fc.path,
                "previous_path": fc.previous_path,
                "status": fc.status,
                "additions": fc.additions,
                "deletions": fc.deletions,
                "churn": fc.additions + fc.deletions,
            }
            for fc in sorted(file_changes, key=lambda x: (x.additions + x.deletions), reverse=True)
        ],
    }
    return payload


def format_text(result: Dict[str, object]) -> str:
    summary = result["summary"]
    lines: List[str] = []
    lines.append("PR ANALYSIS")
    lines.append(f"Range: {result['scope']['base']}...{result['scope']['head']}")
    lines.append(
        f"Files: {summary['files_changed']} | +{summary['additions']} / -{summary['deletions']} | Commits: {summary['commits']}"
    )

    lines.append("\nLanguage breakdown:")
    for language, count in sorted(result["language_breakdown"].items(), key=lambda x: x[0]):
        lines.append(f"- {language}: {count}")

    lines.append("\nStatus breakdown:")
    for status, count in sorted(result["status_breakdown"].items(), key=lambda x: x[0]):
        lines.append(f"- {status}: {count}")

    risk_signals = result.get("risk_signals", [])
    lines.append("\nRisk signals:")
    if not risk_signals:
        lines.append("- none")
    else:
        for signal in risk_signals:
            lines.append(
                f"- [{signal['severity'].upper()}] {signal['title']} ({len(signal['paths'])} path(s))"
            )

    lines.append("\nTop changed files:")
    top_changes = result.get("changes", [])[:20]
    if not top_changes:
        lines.append("- none")
    else:
        for change in top_changes:
            lines.append(
                f"- {change['path']} ({change['status']}, +{change['additions']}/-{change['deletions']})"
            )

    return "\n".join(lines)


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze a git diff range for review planning.")
    parser.add_argument("--repo", default=".", help="Path to git repository (default: current directory).")
    parser.add_argument("--base", default="origin/main", help="Base git ref (default: origin/main).")
    parser.add_argument("--head", default="HEAD", help="Head git ref (default: HEAD).")
    parser.add_argument("--format", choices=("text", "json"), default="text", help="Output format.")
    parser.add_argument("--output", help="Optional output file path.")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    repo_path = Path(args.repo).resolve()

    try:
        result = gather_branch_data(repo_path, args.base, args.head)
    except GitCommandError as exc:
        print(f"git command failed: {exc}", file=sys.stderr)
        return 1

    output = json.dumps(result, indent=2) if args.format == "json" else format_text(result)

    if args.output:
        Path(args.output).write_text(output + ("\n" if not output.endswith("\n") else ""), encoding="utf-8")
    else:
        print(output)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
