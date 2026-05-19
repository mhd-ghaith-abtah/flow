# Changelog

All notable changes to Flow are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0] — 2026-05-19

### Added
- `flow-doctor` skill — health check for catalog / state / adapters / MCPs / CLIs / upstreams + probes for known bugs (caveman-shrink standalone vs wrapper, stripped severity labels, loose `## Plan` markers, upstream version drift, Caveman global scope, adapter symlink drift). Supports `--fix` for safe auto-repairs. Closes #7.
- `lib/catalog.js` + `lib/repo-root.js` + `lib/commands/plan.js` + `lib/commands/init.js` + `lib/commands/uninstall.js` — first real implementation of the `flow` CLI commands (replaces stub dispatch). `flow plan` resolves profiles with `extends:` inheritance and adapter family-override; `--json` emits machine-readable plan. `flow uninstall` defaults to `--scope project` (safe), dry-runs by default, requires `--execute --yes` to actually remove. Does NOT touch BMad / ECC / Caveman. Closes #1 (code path), #8.
- `lib/catalog.test.js` — first test file. 7 tests pass under `npm test` (`node --test`). Closes second half of #3.
- `.github/workflows/ci.yml` — GitHub Actions CI on push + PR. Matrix Node 20 + 22. Runs `npm test`, smoke-tests all four profiles, shellchecks `tools/`, enforces the CHANGELOG-touched rule from CONTRIBUTING.md. Closes second half of #3.
- `.github/PULL_REQUEST_TEMPLATE.md` — PR checklist matching CONTRIBUTING.md.
- `schemas/catalog.schema.json`, `schemas/install-state.schema.json`, `schemas/flow-config.schema.json` — JSON Schema (draft-07) for the three hand-editable surfaces. `loadCatalog` runs ajv validation when the schema is present; throws with grouped error messages on violation. New test asserts the shipped `catalog.yaml` passes its own schema. Closes #11.
- `tools/fix-caveman-shrink.sh` — print-only repair for the caveman-shrink standalone-vs-wrapper MCP registration bug. Does NOT auto-run `claude mcp` (modifying MCP registration affects every session). Closes #5.
- `tools/release.sh` — release-cutting script. Sanity-checks (clean tree, on main, up to date), runs tests + smoke, moves `[Unreleased]` to dated heading, bumps `package.json`, commits + tags + pushes. Supports `patch | minor | major | <explicit-version>` + `--dry-run` + `--no-push`. Closes #22.
- `CONTRIBUTING.md` — setup, branch conventions, CHANGELOG-on-every-PR rule, versioning + release flow, PR checklist. Closes #23.
- `docs/quickstart.md`, `docs/profiles.md`, `docs/adapters.md`, `docs/migrate-from-bmad.md` — first real documentation pass. Covers 10-min path to first shipped story, profile selection rationale, adapter contract + inventory, BMad → Flow migration including rollback. Closes #17.
- README FAQ section (8 questions: BMad/ECC/Flow split, profile selection, Caveman, GitHub-free workflows, upgrade, uninstall, config-commit safety, bug reports) + "When to use which command" precedence table (BMad / Flow / ECC mapping per lifecycle phase). Closes #20 + #27.
- Curl-pipe-bash inspection (when `FLOW_INSPECT_INSTALL_SCRIPTS=1`) now prints the downloaded script's SHA-256 alongside path + line count. Closes #21.

### Changed
- README: stripped premature `npx @mhd-ghaith-abtah/flow-init` claim; documented current state as slash-command only until v0.7 npm publish lands.
- `flow.config.yaml` is now explicitly committed (team-share); per-developer overrides go in `flow.config.local.yaml` (gitignored). `flow-story` deep-merges local on top of base. Template comment + `flow-init` gitignore additions cover the new convention.
- `caveman-commit` now receives raw inputs (story.id, title, tags, changed_files, severity counts, verify command, e2e status) instead of the caveman-compressed `## Review Notes` block — eliminates double-compression that was degrading commit-message quality.
- `--auto-merge` no longer polls 30s × 15min (≈30 `gh pr view` calls eating main-context). Single 90s wait, then either continue to merge-done (fast-CI case) or end turn with a handoff. Next `/flow-story` invocation re-checks. Configurable via `config.pr.auto_merge_wait_seconds`.
- `flow-story` review barrier: 15-min wall-clock timeout (configurable via `config.review.barrier_timeout_seconds`). Timed-out reviewers no longer deadlock the commit phase — they halt with explicit options instead of waiting forever.
- `flow-story` severity gate: hardened against caveman-review label stripping. Raw severity counts (from un-compressed reviewer output) are now the single source of truth; compressed `## Review Notes` get a `Findings: X critical · Y high · …` header prepended if all severity tokens are stripped.

### Fixed
- Cycle-detection in profile inheritance (`resolveProfile` throws on cycles instead of stack-overflowing).
- `flow-story` plan phase decision tree restructured. Six lettered paths (A–F) collapsed into four numbered branches, ordered from most-specific (flag-driven) to default. Comments now explicitly state when each branch fires (e.g., "Caveman not installed AND --auto"). Resolves the "unreachable paths E + F when Caveman installed" confusion. Closes #15.
- `/flow-init --migrate-bmad` now stages backups (`*.flow-backup-<timestamp>`) of `sprint-status.yaml`, `deferred-work.md`, and any pre-existing `docs/flow/sprint.yaml` BEFORE any migration write. Validates produced `sprint.yaml` after write; if parse fails or story count drops to zero, restores from backups and halts with the parse error. Backup paths recorded in `install-state.json.migrations.bmad.backups`. Documented in `docs/migrate-from-bmad.md` was previously aspirational — now implemented. Closes #19.
- `/flow-init` now records the installed version of every upstream (BMad / ECC / Caveman) at install time in `install-state.json.upstreams.<name>.version`. `flow-doctor` adds a version-drift probe that warns when the currently-installed version differs from the pinned version — catches silent BMad/ECC/Caveman interface changes. Closes #12.
- `/flow-sprint add` story-id detection now supports `tracker-style` (e.g. `PLA-42`, `ENG-100`), `kebab` (e.g. `setup-auth`), and `custom` formats alongside `bmad` and `flow-native`. Free-form formats prompt for the next id instead of HALTing on "unrecognized format". Closes #26.
- `/flow-doctor` adapter probe now distinguishes `symlink → <target>`, `regular_file` (mixed-state drift warning), and `missing` for each adapter file. Resolves the previously-undefined behavior when a project mixes real adapter files with Flow's symlinks. Closes #28.
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
