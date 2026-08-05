#!/usr/bin/env python3
"""Reject broad or protected Pi-generated diffs before publishing artifacts."""

from __future__ import annotations

import fnmatch
import subprocess
from pathlib import Path

MAX_FILES = 12
MAX_CHANGED_LINES = 800
DENY = (
    ".github/**",
    "deploy/**",
    ".piops-runtime/**",
    ".env",
    ".env.*",
    "**/.env",
    "**/.env.*",
    "**/*secret*",
    "backend/migrations/versions/**",
    "backend/uv.lock",
    "frontend/package-lock.json",
)


def run(*args: str) -> str:
    return subprocess.check_output(args, text=True).strip()


def denied(path: str) -> bool:
    return any(fnmatch.fnmatch(path, pattern) for pattern in DENY)


def main() -> None:
    subprocess.run(["git", "add", "-N", "."], check=True)
    paths = [line for line in run("git", "diff", "--name-only").splitlines() if line]
    source_paths = [path for path in paths if not path.startswith(".piops-runtime/")]

    if not source_paths:
        raise SystemExit("Pi produced no source changes")
    if len(source_paths) > MAX_FILES:
        raise SystemExit(f"too many changed files: {len(source_paths)} > {MAX_FILES}")

    blocked = [path for path in source_paths if denied(path)]
    if blocked:
        raise SystemExit("protected paths changed: " + ", ".join(blocked))

    numstat = run("git", "diff", "--numstat")
    changed_lines = 0
    for line in numstat.splitlines():
        added, deleted, path = line.split("\t", 2)
        if path.startswith(".piops-runtime/"):
            continue
        if added == "-" or deleted == "-":
            raise SystemExit(f"binary change is not allowed: {path}")
        changed_lines += int(added) + int(deleted)

    if changed_lines > MAX_CHANGED_LINES:
        raise SystemExit(f"diff too large: {changed_lines} > {MAX_CHANGED_LINES} lines")

    report = Path(".piops-runtime/pi-report.md")
    if not report.exists() or report.stat().st_size < 80:
        raise SystemExit("Pi did not produce a useful .piops-runtime/pi-report.md")

    print(f"PiOps diff accepted: {len(source_paths)} files, {changed_lines} changed lines")


if __name__ == "__main__":
    main()
