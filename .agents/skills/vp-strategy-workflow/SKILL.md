---
name: vp-strategy-workflow
description: Run the end-to-end software development workflow for the vp-strategy repository. Use when Codex plans, implements, fixes, refactors, reviews, tests, or prepares delivery of changes to VP Scanner, Accumulation Tracker, strategies, scoring, notifications, Next.js frontend, deployment, or CI. Enforce repository architecture, test-first changes, affected-test selection, backtest gates, evidence-based review, and safe Git handoff. Do not use for market/trading advice or read-only questions unrelated to changing this codebase.
---

# VP Strategy Development Workflow

Treat `AGENTS.md` and any closer nested `AGENTS.md` as authoritative. Keep Scanner and Accumulation independent, preserve file-based state, and make the smallest change that satisfies the request.

## Choose the path

- For explanation, audit, or diagnosis: inspect and report evidence; do not edit unless asked.
- For a trivial documentation-only edit: state intent, edit surgically, review the diff, and run formatting or link checks if available.
- For a bug: reproduce with a failing test, isolate the root cause, implement the smallest fix, and prove the regression test passes.
- For a feature or behavior change: clarify success criteria, inspect the affected data flow, present a compact design when choices materially differ, then use red-green-refactor.
- For config, weights, thresholds, schemas, scheduled workflows, or external notifications: apply the additional gates below before claiming completion.

## Execute the workflow

1. **Orient**
   - Read root `AGENTS.md`; read the nearest nested `AGENTS.md` for files in scope.
   - Inspect the working tree and preserve unrelated user changes.
   - Identify the affected subsystem, public contracts, data flow direction, and external side effects.

2. **Define done**
   - Restate the requested outcome as observable acceptance criteria.
   - Surface assumptions and material tradeoffs. Ask only when a choice would materially change behavior or risk.
   - For non-trivial work, record a short plan with a verification step for every implementation step.

3. **Design minimally**
   - Prefer existing modules and dependencies.
   - Preserve `StrategySignal`, JSON schemas, synchronous execution, import boundaries, cron schedules, and backtest semantics.
   - Reject look-ahead bias and tests that call live market or notification APIs.
   - Read [references/change-gates.md](references/change-gates.md) for exact subsystem constraints and validation gates.

4. **Implement test-first**
   - Add or change a focused test and run it to observe the expected failure.
   - Implement only enough production code to pass.
   - Refactor only code introduced or directly affected by the change; rerun the focused test after each meaningful step.
   - Use synthetic market data and mock yfinance, Telegram, Teams, Stripe, Supabase, and other external systems.

5. **Verify proportionally**
   - Run `python3 .agents/skills/vp-strategy-workflow/scripts/select_checks.py` to derive checks from the current diff.
   - Run every applicable focused check, then run `pytest tests/` for non-trivial Python behavior changes.
   - Run backtests when changing tuned defaults, weights, thresholds, signal behavior, or strategy logic. Compare before/after metrics and disclose regressions.
   - Use dry-run modes for scanner, accumulation, pre-market, intraday, and notifications. Never send a real notification as a test.
   - For frontend changes, read `services/frontend/AGENTS.md`, use the checked-in package manager, and run its available lint/type/test/build checks.

6. **Review before delivery**
   - Review the complete diff against the request, `AGENTS.md`, architecture direction, schema compatibility, test coverage, performance, secrets, and accidental generated/state changes.
   - For every bug fix or feature addition, confirm the root `README.md` was updated in the same change and matches the implemented behavior, usage, or limitations.
   - If subagents are available and a commit is requested, obtain the mandatory independent review required by `AGENTS.md`. Fix findings and re-review until PASS.
   - Do not commit, push, open a PR, deploy, or mutate production unless the user explicitly requests that action.

7. **Hand off with evidence**
   - Lead with the outcome. List changed files, checks run and results, and any skipped gate with its reason.
   - Mention residual risks and operational follow-up. Never say “done” based only on code inspection when executable verification was available.
   - Deliver human or agent-authored repository changes through a pull request: push only the working branch, create the PR, and report its target and URL. Never push development changes directly to `main`; the existing CI bot state-persistence commit is the only exception.

## Git and delivery gates

- Before editing repository files, branch from the latest local `main` using `feat/`, `fix/`, `refactor/`, or `chore/`.
- Keep one concern per commit and use `type: 簡短描述`.
- Never stage `data/accum_state.json` from manual development.
- Before any commit, run the repository pre-commit checks and complete the independent review protocol from `AGENTS.md`.
- Never push human or agent-authored commits directly to `main`, even when the user says only “push”; interpret that as push the working branch and create or prepare a pull request. Do not alter the existing CI bot exception for automatic state persistence.
- Before push and PR, verify the working branch, `origin/main` target, commit range, and clean worktree. Push the working branch, then open a PR targeting `main`.

## Working examples

- “修正 accumulation decay 在缺資料日的計算” → reproduce in an accumulation test, fix tracker behavior, run the accumulation suite and full tests.
- “新增一個 VP signal” → design contract, test `StrategySignal`, update `TRACK_MAP`, run strategy tests, backtest, review performance and look-ahead risk.
- “調整 Telegram 格式” → unit-test formatting and truncation, use dry-run only, verify the 4096-character limit.
- “修改 frontend dashboard” → load the nested frontend rules, inspect local Next.js docs, run package checks, and keep backend JSON contracts unchanged.
