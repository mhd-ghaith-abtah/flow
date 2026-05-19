---
name: flow-story
description: 'Per-story orchestrator. Auto-detects phase (plan / implement / review / verify / e2e / docs / commit / pr / merge-done) from sprint.yaml + git branch + commits + PR state, then invokes the right ECC primitive (/plan, /prp-implement, /code-review, /update-docs, /prp-commit, /prp-pr) or active adapter, and chains to the next phase. Auto-scaffolds a minimal story-file stub from sprint.yaml + conventions when missing. Accepts no args (continues active story) or a story id. Use when the user runs /flow-story or /flow-story <id>.'
argument-hint: '[<story-id>] [--advise-only] [--auto] [--auto-merge] [--skip-plan] [--strict-plan] [--no-verify] [--no-e2e] [--no-tests] [--no-review] [--hard-review]'
version: 0.6.1
---

Follow the instructions in ./workflow.md.

**Execution model (v0.3+):** the workflow defaults to **execute mode** — each phase invokes the next ECC primitive or adapter and chains to the following phase. Hard halts (plan's CONFIRM, CRITICAL findings, verify failure, e2e failure, PR open) are unconditional. The pre-commit confirm is the only soft halt that `--auto` can skip.

Pass `--advise-only` to revert to the pre-v0.3 behavior where each phase prints the next command and ends the turn.
