---
name: flow-sprint
description: 'Sprint state manager for Flow. Maintains docs/flow/sprint.yaml: add epics, add stories, mark next, flip status, run retros, list deferred items, scope-review (audit + adjust scope mid-flight). Subcommands: init | add-epic | add | next | status | done | deferred | retro | import-bmad | scope-review. Use when the user runs /flow-sprint, /flow-sprint <subcommand>, or asks to track sprint state.'
argument-hint: '<add-epic|add|next|status|done|deferred|retro|import-bmad|scope-review> [args]'
version: 0.5.0
---

Follow the instructions in ./workflow.md.

`sprint.yaml` lives at `docs/flow/sprint.yaml` (configurable via `flow.config.yaml > sprint_file`). All operations are read-modify-write — never lose comments or formatting. Every status flip also calls the active `issue-tracker` adapter (loaded from `flow.config.yaml > adapters.issue_tracker`) so external state stays in sync.
