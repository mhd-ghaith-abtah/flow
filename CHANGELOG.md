# Changelog

All notable changes to Flow are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `flow-doctor` skill — health check for catalog / state / adapters / MCPs / CLIs / upstreams + probes for known bugs (caveman-shrink standalone vs wrapper, stripped severity labels, loose `## Plan` markers). Supports `--fix` for safe auto-repairs.
- `lib/catalog.js` + `lib/commands/plan.js` + `lib/commands/init.js` — first real implementation of `flow plan` and `flow init` (replaces stub dispatch). `flow plan` resolves profiles with `extends:` inheritance and adapter family-override; `--json` emits machine-readable plan.
- `lib/catalog.test.js` — first test file. 6 tests pass under `npm test` (`node --test`).
- `CONTRIBUTING.md` — setup, branch conventions, CHANGELOG-on-every-PR rule, versioning + release flow, PR checklist.
- README FAQ section — eight common questions (BMad vs ECC vs Flow, profile selection, Caveman, GitHub-free workflows, upgrade path, uninstall, config commit safety, bug reports).
- README "When to use which command" precedence table — explicit mapping of BMad / Flow / ECC commands for each lifecycle phase, removing ambiguity when all three are installed side-by-side.
- `docs/quickstart.md`, `docs/profiles.md`, `docs/adapters.md`, `docs/migrate-from-bmad.md` — first real documentation pass (was a known gap). Covers 10-min path to first shipped story, profile selection rationale, adapter contract + inventory, and BMad → Flow migration including rollback.

### Changed
- README: stripped premature `npx @mhd-ghaith-abtah/flow-init` claim; documented current state as slash-command only until v0.7 npm publish lands.
- `flow.config.yaml` is now explicitly committed (team-share); per-developer overrides go in `flow.config.local.yaml` (gitignored). `flow-story` deep-merges local on top of base. Template comment + `flow-init` gitignore additions cover the new convention.
- `caveman-commit` now receives raw inputs (story.id, title, tags, changed_files, severity counts, verify command, e2e status) instead of the caveman-compressed `## Review Notes` block — eliminates double-compression that was degrading commit-message quality.
- `--auto-merge` no longer polls 30s × 15min (≈30 `gh pr view` calls eating main-context). Single 90s wait, then either continue to merge-done (fast-CI case) or end turn with a handoff. Next `/flow-story` invocation re-checks. Configurable via `config.pr.auto_merge_wait_seconds`.
- `flow-story` review barrier: 15-min wall-clock timeout (configurable via `config.review.barrier_timeout_seconds`). Timed-out reviewers no longer deadlock the commit phase — they halt with explicit options instead of waiting forever.
- `flow-story` severity gate: hardened against caveman-review label stripping. Raw severity counts (from un-compressed reviewer output) are now the single source of truth; compressed `## Review Notes` get a `Findings: X critical · Y high · …` header prepended if all severity tokens are stripped.

### Fixed
- Cycle-detection in profile inheritance (`resolveProfile` throws on cycles instead of stack-overflowing).
- Anchored `## Plan` / `## Review Notes` / `## Verified` / `## E2E` marker detection in `flow-story` phase decision. Previous loose match (`grep -c '^## Plan'`) false-matched `## Plan B` or `## Planning`. Now requires exact heading.
- `flow-doctor` caveman-shrink probe corrected: caveman-shrink is an MCP proxy (not a skill). Probe now reads `claude mcp get caveman-shrink` and flags standalone registrations that cause `-32000` errors. `tools/fix-caveman-shrink.sh` prints the exact remove + re-add commands (does NOT auto-run — MCP registration affects every Claude Code session).


## [0.0.1] — 2026-05-18

### Added
- Initial scaffold: `flow-init`, `flow-sprint`, `flow-story` skills
- Catalog (`catalog.yaml`) with profiles `mini`, `standard`, `team`
- Adapter interfaces for `issue-tracker`, `pr`, `e2e`, `verify`
- v0.1 adapters: `linear`, `github-issues`, `none` (issue-tracker);
  `github`, `none` (pr); `playwright-mcp`, `none` (e2e); `make`, `pnpm`, `custom` (verify)
- BMad delegation: invokes `npx bmad-method install --modules <curated>`
- ECC delegation: invokes `./install.sh --profile <curated> --with --without`
- MCP integration: `context7`, `playwright`, `linear`, `github-mcp` (optional)
- Node CLI binary (`bin/flow.js`) with subcommands `install`, `plan`, `status`, `doctor`, `add`, `remove`, `uninstall`
- Slash command parity inside Claude Code
- Migration from BMad `sprint-status.yaml`
- State store at `~/.claude/flow/install-state.json` and `<project>/.claude/flow/install-state.json`
