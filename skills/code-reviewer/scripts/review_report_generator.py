#!/usr/bin/env python3
"""Generate a markdown code review report from analyzer outputs."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional


def load_json(path: Optional[str]) -> Dict[str, object]:
    if not path:
        return {}
    return json.loads(Path(path).read_text(encoding="utf-8"))


def decide_recommendation(pr_data: Dict[str, object], quality_data: Dict[str, object]) -> str:
    high_quality = quality_data.get("summary", {}).get("severity_counts", {}).get("high", 0)
    medium_quality = quality_data.get("summary", {}).get("severity_counts", {}).get("medium", 0)
    high_risk = len([
        s for s in pr_data.get("risk_signals", []) if s.get("severity") == "high"
    ])
    medium_risk = len([
        s for s in pr_data.get("risk_signals", []) if s.get("severity") == "medium"
    ])

    if high_quality > 0 or high_risk > 0:
        return "Request changes"
    if medium_quality > 0 or medium_risk > 0:
        return "Approve with comments"
    return "Approve"


def top_findings(quality_data: Dict[str, object], limit: int = 12) -> List[Dict[str, object]]:
    findings = quality_data.get("findings", [])
    severity_rank = {"high": 0, "medium": 1, "low": 2, "info": 3}
    ordered = sorted(findings, key=lambda f: (severity_rank.get(f.get("severity"), 99), f.get("path", ""), f.get("line", 0)))
    return ordered[:limit]


def build_markdown(title: str, pr_data: Dict[str, object], quality_data: Dict[str, object]) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    recommendation = decide_recommendation(pr_data, quality_data)

    pr_summary = pr_data.get("summary", {})
    quality_summary = quality_data.get("summary", {})

    lines: List[str] = []
    lines.append(f"# {title}")
    lines.append("")
    lines.append(f"Generated: {now}")
    lines.append("")
    lines.append("## Recommendation")
    lines.append("")
    lines.append(f"**{recommendation}**")
    lines.append("")

    lines.append("## Executive Summary")
    lines.append("")
    if pr_summary:
        lines.append(
            f"- PR scope: {pr_summary.get('files_changed', 0)} files, +{pr_summary.get('additions', 0)} / -{pr_summary.get('deletions', 0)}, {pr_summary.get('commits', 0)} commits"
        )
    if quality_summary:
        counts = quality_summary.get("severity_counts", {})
        lines.append(
            f"- Quality scan: {quality_summary.get('total_findings', 0)} findings (high={counts.get('high', 0)}, medium={counts.get('medium', 0)}, low={counts.get('low', 0)}, info={counts.get('info', 0)})"
        )
        lines.append(f"- Quality score: {quality_summary.get('quality_score', 0)}/100")
    if not pr_summary and not quality_summary:
        lines.append("- No input datasets provided.")
    lines.append("")

    lines.append("## Priority Findings")
    lines.append("")
    selected_findings = top_findings(quality_data)
    if not selected_findings:
        lines.append("- No static findings detected.")
    else:
        for finding in selected_findings:
            lines.append(
                f"- [{finding.get('severity', 'unknown').upper()}] `{finding.get('path', 'unknown')}:{finding.get('line', '?')}` {finding.get('message', 'No message')}"
            )
    lines.append("")

    lines.append("## PR Risk Signals")
    lines.append("")
    risk_signals = pr_data.get("risk_signals", [])
    if not risk_signals:
        lines.append("- No PR risk signals detected.")
    else:
        for signal in risk_signals:
            paths = signal.get("paths", [])
            lines.append(
                f"- [{signal.get('severity', 'unknown').upper()}] {signal.get('title', 'Risk')} ({len(paths)} path(s))"
            )
            lines.append(f"  Impact: {signal.get('details', 'No details provided.')}" )
    lines.append("")

    lines.append("## Reviewer Checklist")
    lines.append("")
    lines.append("- [ ] Confirm correctness against requirements")
    lines.append("- [ ] Confirm authz/authn boundaries")
    lines.append("- [ ] Confirm migration or schema safety")
    lines.append("- [ ] Confirm test coverage for changed logic")
    lines.append("- [ ] Confirm observability and error handling")
    lines.append("")

    lines.append("## Suggested Next Actions")
    lines.append("")
    if recommendation == "Request changes":
        lines.append("1. Resolve all high-severity findings and re-run analysis.")
        lines.append("2. Add or update tests covering critical changed paths.")
        lines.append("3. Re-review auth, dependency, and data migration changes.")
    elif recommendation == "Approve with comments":
        lines.append("1. Address medium-severity items before merge if feasible.")
        lines.append("2. Create follow-up issues for non-blocking improvements.")
    else:
        lines.append("1. Merge after a final sanity check and CI pass.")
        lines.append("2. Track low-priority improvements in backlog if needed.")

    return "\n".join(lines) + "\n"


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate markdown review report from JSON inputs.")
    parser.add_argument("--pr", help="Path to pr_analyzer JSON output.")
    parser.add_argument("--quality", help="Path to code_quality_checker JSON output.")
    parser.add_argument("--title", default="Code Review Report", help="Report title.")
    parser.add_argument("--format", choices=("markdown", "json"), default="markdown", help="Output format.")
    parser.add_argument("--output", help="Optional output file path.")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    pr_data = load_json(args.pr)
    quality_data = load_json(args.quality)

    if args.format == "json":
        output_obj = {
            "recommendation": decide_recommendation(pr_data, quality_data),
            "pr_summary": pr_data.get("summary", {}),
            "quality_summary": quality_data.get("summary", {}),
            "top_findings": top_findings(quality_data),
            "risk_signals": pr_data.get("risk_signals", []),
        }
        output = json.dumps(output_obj, indent=2)
    else:
        output = build_markdown(args.title, pr_data, quality_data)

    if args.output:
        Path(args.output).write_text(output + ("" if output.endswith("\n") else "\n"), encoding="utf-8")
    else:
        print(output)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
