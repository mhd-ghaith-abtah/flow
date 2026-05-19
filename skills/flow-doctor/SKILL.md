---
name: flow-doctor
description: 'Health check for a Flow installation. Verifies catalog, install-state, flow.config.yaml, adapters, MCPs, required CLIs, upstream installers (BMad / ECC / Caveman), and known-bug probes (e.g., caveman-shrink standalone-vs-wrapper). Use when the user runs `/flow-doctor` or `flow doctor`. Read-only by default. With `--fix`, attempts safe auto-repairs (re-register caveman-shrink wrapper, regenerate adapter symlinks, recreate missing state files).'
argument-hint: '[--mcp <id>] [--fix] [--json] [--verbose]'
version: 0.0.1
---

Follow the instructions in ./workflow.md.

Resolves `{repo-root}` the same way `flow-init` does (`$FLOW_REPO_ROOT` env, then walk up from `~/.claude/skills/flow-doctor/`, then CWD). Runs the doctor checklist from `flow-init` step 13 as a standalone, plus extra probes for known bugs (e.g., caveman-shrink mis-registered as standalone instead of wrapping context7).

Exit codes (when invoked from `bin/flow.js doctor`):
- `0` — all checks pass or only ℹ findings
- `1` — at least one ⚠ warning
- `2` — at least one ✗ failure
