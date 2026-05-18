---
name: flow-init
description: 'Interactive first-time installer for Flow. Detects project shape, asks for profile + adapters + upstream choices, delegates to BMad / ECC installers, configures MCP servers, scaffolds docs/flow/, and writes install-state.json. Use when the user runs `/flow init` or `/flow-init`. Idempotent — safe to re-run with --update.'
argument-hint: '[--profile mini|standard|team] [--update] [--repair] [--dry-run] [--yes] [--catalog-source <path|url>]'
version: 0.0.1
---

Follow the instructions in ./workflow.md.

Loads the catalog from `{repo-root}/catalog.yaml` (resolved via `$FLOW_REPO_ROOT` env or by walking up from `~/.claude/skills/flow-init/`). When invoked with `--update` or `--repair`, reads the existing install-state.json and runs in delta mode. Otherwise runs the full first-install flow.
