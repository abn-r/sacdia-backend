#!/usr/bin/env python3
"""Run lightweight, language-aware code quality checks."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Pattern

SUPPORTED_EXTENSIONS = {
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".go",
    ".swift",
    ".kt",
    ".kts",
}

SKIP_DIRS = {
    ".git",
    ".next",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "venv",
    ".venv",
    "__pycache__",
}

SEVERITY_WEIGHT = {
    "high": 5,
    "medium": 3,
    "low": 1,
    "info": 0,
}


@dataclass
class Rule:
    rule_id: str
    severity: str
    message: str
    pattern: Pattern[str]
    languages: Optional[Iterable[str]] = None


def extension_language(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".ts", ".tsx"}:
        return "typescript"
    if suffix in {".js", ".jsx"}:
        return "javascript"
    if suffix == ".py":
        return "python"
    if suffix == ".go":
        return "go"
    if suffix == ".swift":
        return "swift"
    if suffix in {".kt", ".kts"}:
        return "kotlin"
    return "other"


def build_rules() -> List[Rule]:
    return [
        Rule(
            "possible-secret",
            "high",
            "Possible hardcoded secret detected.",
            re.compile(r"(?i)(password|secret|api[_-]?key|token)\s*[:=]\s*['\"][^'\"]{6,}['\"]"),
        ),
        Rule(
            "dynamic-code-eval",
            "high",
            "Dynamic code execution found (eval/exec).",
            re.compile(r"\b(eval|exec)\s*\("),
            languages=("javascript", "typescript", "python"),
        ),
        Rule(
            "subprocess-shell-true",
            "high",
            "subprocess call with shell=True can be unsafe.",
            re.compile(r"subprocess\.[A-Za-z_]+\(.*shell\s*=\s*True"),
            languages=("python",),
        ),
        Rule(
            "bare-except",
            "medium",
            "Bare except found; catch specific exceptions.",
            re.compile(r"^\s*except\s*:\s*$"),
            languages=("python",),
        ),
        Rule(
            "except-pass",
            "medium",
            "Exception is swallowed with pass.",
            re.compile(r"^\s*except\b.*:\s*(#.*)?$"),
            languages=("python",),
        ),
        Rule(
            "console-log",
            "low",
            "Debug logging left in code (console.log).",
            re.compile(r"\bconsole\.log\s*\("),
            languages=("javascript", "typescript"),
        ),
        Rule(
            "print-debug",
            "low",
            "Debug print statement found.",
            re.compile(r"\bprint\s*\("),
            languages=("python",),
        ),
        Rule(
            "todo-marker",
            "info",
            "TODO/FIXME marker found; verify tracking issue exists.",
            re.compile(r"\b(TODO|FIXME|HACK)\b"),
        ),
        Rule(
            "http-url",
            "medium",
            "Insecure http URL detected.",
            re.compile(r"http://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+"),
        ),
        Rule(
            "wildcard-import",
            "medium",
            "Wildcard import reduces clarity and safety.",
            re.compile(r"^\s*from\s+\S+\s+import\s+\*"),
            languages=("python",),
        ),
        Rule(
            "force-unwrap-swift",
            "medium",
            "Force unwrap (!) found; verify nil safety.",
            re.compile(r"\w+!"),
            languages=("swift",),
        ),
    ]


def should_scan(path: Path, max_file_size_kb: int) -> bool:
    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        return False
    if any(part in SKIP_DIRS for part in path.parts):
        return False
    try:
        if path.stat().st_size > max_file_size_kb * 1024:
            return False
    except OSError:
        return False
    return True


def iter_files(target: Path, max_file_size_kb: int) -> Iterable[Path]:
    if target.is_file():
        if should_scan(target, max_file_size_kb):
            yield target
        return

    for path in target.rglob("*"):
        if not path.is_file():
            continue
        if should_scan(path, max_file_size_kb):
            yield path


def run_scan(target: Path, max_file_size_kb: int, verbose: bool) -> Dict[str, object]:
    rules = build_rules()

    findings: List[Dict[str, object]] = []
    files_scanned = 0
    lines_scanned = 0

    for file_path in iter_files(target, max_file_size_kb):
        files_scanned += 1
        language = extension_language(file_path)
        if verbose:
            print(f"scanning {file_path}", file=sys.stderr)

        try:
            content = file_path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        for idx, line in enumerate(content.splitlines(), start=1):
            lines_scanned += 1

            if len(line) > 120:
                findings.append(
                    {
                        "rule_id": "line-too-long",
                        "severity": "low",
                        "message": "Line exceeds 120 characters.",
                        "path": str(file_path),
                        "line": idx,
                        "evidence": line[:160].strip(),
                    }
                )

            for rule in rules:
                if rule.languages and language not in rule.languages:
                    continue
                if not rule.pattern.search(line):
                    continue

                # Reduce false positives for bare except/pass pair by checking next line.
                if rule.rule_id == "except-pass":
                    next_line = ""
                    lines = content.splitlines()
                    if idx < len(lines):
                        next_line = lines[idx].strip()
                    if next_line != "pass":
                        continue

                findings.append(
                    {
                        "rule_id": rule.rule_id,
                        "severity": rule.severity,
                        "message": rule.message,
                        "path": str(file_path),
                        "line": idx,
                        "evidence": line[:160].strip(),
                    }
                )

    severity_counts: Dict[str, int] = {"high": 0, "medium": 0, "low": 0, "info": 0}
    for finding in findings:
        severity_counts[finding["severity"]] += 1

    weighted_penalty = sum(SEVERITY_WEIGHT[f["severity"]] for f in findings)
    score = max(0, 100 - weighted_penalty)

    return {
        "summary": {
            "target": str(target),
            "files_scanned": files_scanned,
            "lines_scanned": lines_scanned,
            "total_findings": len(findings),
            "severity_counts": severity_counts,
            "quality_score": score,
        },
        "findings": findings,
    }


def format_text(result: Dict[str, object], max_printed: int = 120) -> str:
    summary = result["summary"]
    lines: List[str] = []
    lines.append("CODE QUALITY REPORT")
    lines.append(f"Target: {summary['target']}")
    lines.append(
        f"Files: {summary['files_scanned']} | Lines: {summary['lines_scanned']} | Findings: {summary['total_findings']} | Score: {summary['quality_score']}/100"
    )

    counts = summary["severity_counts"]
    lines.append(
        f"Severity: high={counts['high']} medium={counts['medium']} low={counts['low']} info={counts['info']}"
    )

    lines.append("\nFindings:")
    findings = result["findings"]
    if not findings:
        lines.append("- none")
    else:
        for finding in findings[:max_printed]:
            lines.append(
                f"- [{finding['severity'].upper()}] {finding['path']}:{finding['line']} {finding['rule_id']} - {finding['message']}"
            )
        if len(findings) > max_printed:
            lines.append(f"- ... and {len(findings) - max_printed} more")

    return "\n".join(lines)


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run lightweight quality checks for source code.")
    parser.add_argument("target", nargs="?", default=".", help="File or directory to scan (default: current directory).")
    parser.add_argument("--max-file-size-kb", type=int, default=512, help="Skip files larger than this size (KB).")
    parser.add_argument("--verbose", action="store_true", help="Print scanning progress to stderr.")
    parser.add_argument("--format", choices=("text", "json"), default="text", help="Output format.")
    parser.add_argument("--output", help="Optional output file path.")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    target = Path(args.target).resolve()

    if not target.exists():
        print(f"target does not exist: {target}", file=sys.stderr)
        return 1

    result = run_scan(target, args.max_file_size_kb, args.verbose)
    output = json.dumps(result, indent=2) if args.format == "json" else format_text(result)

    if args.output:
        Path(args.output).write_text(output + ("\n" if not output.endswith("\n") else ""), encoding="utf-8")
    else:
        print(output)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
