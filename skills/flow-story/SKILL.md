---
name: flow-story
description: 'Per-story orchestrator. Auto-detects phase (plan / implement / review / verify / e2e / docs / commit / pr / done) from sprint.yaml + git branch + commits + PR state, then delegates to the right ECC primitive (/plan, /prp-implement, /code-review, /update-docs, /prp-commit, /prp-pr) or to the active adapters. Accepts no args (continues active story) or a story id. Use when the user runs /flow-story or /flow-story <id>.'
argument-hint: '[<story-id>] [--skip-plan] [--tdd] [--hard-review] [--no-e2e] [--docs] [--dry-run]'
version: 0.0.1
---

Follow the instructions in ./workflow.md.

The skill is a thin orchestrator. It delegates the actual work to ECC's commands and to the adapters loaded from `flow.config.yaml`. It never re-implements review, planning, or implementation logic — those belong upstream.

The golden rule: every phase ends with a clear re-entry instruction. The skill never spans a user confirmation gate in one turn.
