#!/usr/bin/env python3
"""Print deterministic validation commands for files changed in this repository."""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


def changed_files(repo: Path, mode: str, base: str | None) -> list[str]:
    if base:
        command = ["git", "diff", "--name-only", f"{base}...HEAD"]
    elif mode == "staged":
        command = ["git", "diff", "--cached", "--name-only"]
    else:
        command = ["git", "status", "--short", "--untracked-files=all"]

    result = subprocess.run(command, cwd=repo, check=True, capture_output=True, text=True)
    if base or mode == "staged":
        return [line.strip() for line in result.stdout.splitlines() if line.strip()]

    files = []
    for line in result.stdout.splitlines():
        path = line[3:].strip()
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        if path:
            files.append(path)
    return files


def select(files: list[str]) -> list[str]:
    checks: list[str] = []

    def add(command: str) -> None:
        if command not in checks:
            checks.append(command)

    if any(path.endswith(".py") for path in files):
        add("python3 -m compileall -q .")
    if any(path in {"core/indicators.py", "core/vp_multitf.py"} for path in files):
        add("pytest tests/test_indicators.py tests/test_vp_multitf.py")
    if any(path.startswith("regime/") for path in files):
        add("pytest tests/test_regime.py")
    if "strategies/vp_signals.py" in files:
        add("pytest tests/test_strategies.py tests/test_vp_multitf.py")
        add("python backtest_multi.py")
    if "strategies/vwap_signals.py" in files:
        add("pytest tests/test_vwap_strategy.py")
        add("python backtest_multi.py")
    if any(path in {"strategies/trend_signals.py", "strategies/inst_trend.py"} for path in files):
        add("pytest tests/test_trend_strategy.py tests/test_strategies.py")
        add("python backtest_multi.py")
    if any(path.startswith("strategies/accumulation/") or path == "accumulation.py" for path in files):
        add("pytest tests/test_accumulation_tracker.py tests/test_accumulation_detector.py tests/test_phase_classifier.py tests/test_entry_triggers.py tests/test_accumulation_notifications.py")
    if any(path.startswith("scoring/") for path in files):
        add("pytest tests/test_scoring.py")
        add("python backtest_multi.py")
    if "config.py" in files:
        add("pytest tests/")
        add("python backtest_multi.py")
    if any("notification" in path for path in files):
        add("pytest tests/test_accumulation_notifications.py")
    if any(path.startswith("services/frontend/") for path in files):
        add("cd services/frontend && npm run lint")
        add("cd services/frontend && npm run build")
    if any(path.startswith(".github/workflows/") for path in files):
        add("python3 -c 'import pathlib, yaml; [yaml.safe_load(p.read_text()) for p in pathlib.Path(\".github/workflows\").glob(\"*.yml\")]'")

    behavior = any(
        path.endswith(".py") and not path.startswith("tests/")
        for path in files
    )
    if behavior:
        add("pytest tests/")
    return checks


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--staged", action="store_true", help="inspect the staged diff")
    parser.add_argument("--base", help="inspect changes from BASE...HEAD")
    args = parser.parse_args()

    repo = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
    files = changed_files(repo, "staged" if args.staged else "worktree", args.base)
    print("Changed files:")
    for path in files:
        print(f"  - {path}")
    print("Recommended checks:")
    commands = select(files)
    if not commands:
        print("  - Review-only: no automated project check selected.")
    else:
        for command in commands:
            print(f"  - {command}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
