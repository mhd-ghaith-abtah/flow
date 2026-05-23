# Changelog

All notable changes to Flow are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **`--ecc-scope <user|project>` CLI flag** — explicit override on top of the profile default for `flow plan` and `flow install`. Lets users pick a non-default scope without authoring a new profile (e.g. `flow install --profile team --ecc-scope user` or `flow plan --profile mini --ecc-scope project`). Throws on invalid value so typos like `--ecc-scope=projet` fail loud instead of silently falling through to the profile default. 4 new tests covering override directions + typo guard.
- **E7-002 — Catalog `ecc_install_scope` plumbing** — `upstreams.ecc.install_scope_default` (defaults to `user`) and per-profile `ecc_install_scope` (`user|project`) flow through `resolveProfile` so the resolved profile exposes the scope to downstream consumers. `team` profile now declares `ecc_install_scope: project`; `minimal`/`mini`/`standard` inherit `user`. `flow plan` surfaces the scope next to the ECC subset (e.g. `ECC:  flow-essentials-plus-tdd  (scope: project)`). Schema + JSDoc updated. Data plumbing only — E7-003 will consume the field to swap `--target claude` → `--target claude-project` at install time. 3 new tests (54/54 pass).

### Changed
- **ECC installer pinned to post-merge github commit** — `catalog.yaml` ECC `cmd_fallback` now `npx -y -p "github:affaan-m/ECC#98bd5174" ecc-install` (was a broken `npx @everything-claude-code/ecc install` reference — wrong package name, returned 404). The pin targets the merge commit of affaan-m/ECC#2006 (`claude-project` install target) so Flow can route the team profile to project-scope ECC. ECC npm `latest` is currently `ecc-universal@1.10.0` (2026-04-15), which predates the merge by ~36 days, so the npm package would NOT have the target. New catalog fields: `upstream_npm_package`, `upstream_npm_latest`, `upstream_npm_status`, `pinned_commit`. Will swap back to `npx ecc-universal install` once affaan-m cuts a `2.x` release. Also fixed stale `installer_path_candidates` entries (removed a global-npm path that referenced the bogus package name; added `~/development/personal/ecc-fork/install.sh` for contributors with a local clone). README FAQ updated with the distribution caveat.
- **Caveman installer swapped to a temporary fork pin** — `catalog.yaml` Caveman `installer.cmd` now `npx -y "github:mhd-ghaith-abtah/caveman#flow-pin-v0.1"` (was upstream curl-pipe-bash). The fork carries the project-scope gating patches from JuliusBrussee/caveman#407 applied on top of upstream `main`. Reason: upstream Caveman has a ~134-PR backlog with ~5 merges/month, so waiting for #407 to land would block Flow's team profile for months. The fork is documented as temporary in `catalog.yaml` (new fields: `upstream_repo`, `upstream_pr`, `fork_status`) with an explicit swap-back plan. Doctor probe shows the fork status so users know when upstream merges. README updates the FAQ + "Upstream contributions" section to reflect the conditional compose-vs-fork strategy.

### Added
- **Upstream ECC PR merged** — [affaan-m/ECC#2006](https://github.com/affaan-m/ECC/pull/2006) adds a `claude-project` install target (project-scope ECC), symmetric with the existing user-scope `claude` target. Closes the install-target matrix for Claude Code (now 7 project-scope + 4 home-scope adapters) and removes the need for Flow's `HOME=$PROJECT/.flow-vendor` shim. Closes E7-001. Unblocks E7-002 → E7-005 (catalog scope flag, init wiring, doctor probe, docs).
- **Flow published to npm** as [`@mhd-ghaith-abtah/flow@0.7.2-beta.0`](https://www.npmjs.com/package/@mhd-ghaith-abtah/flow). End-to-end smoke clean: local install, global install (`flow` on PATH), `npx -y @mhd-ghaith-abtah/flow@beta`, all four profiles resolve, `flow doctor` probes catalog + state + adapters + upstreams. 78 transitive deps, 81 kB tarball. Closes E1-002 (the last open BLOCKING story from the v0.6.1 review handoff).

### Changed
- README gained an FAQ entry on per-project ECC installs (via the merged `claude-project` target) and a new "Upstream contributions" subsection under Credits listing ECC #2006 (merged) and Caveman #407 (in review).
- README Install section refreshed for the npm publish — now shows four paths (`/flow-init` slash command, `npm install -g @mhd-ghaith-abtah/flow@beta`, `npx -y @mhd-ghaith-abtah/flow@beta`, clone for development). Status block updated from "not yet published" to "published as beta, soaking before latest promotion".

### Added
- `ROADMAP.md` — multi-epic arc through v0.7.x (stabilize) → v0.8 (npx-first + ECC project-scope) → v0.9 (multi-agent) → v1.0 (stable). Explicit out-of-scope guardrails (no multi-repo orchestration, no SaaS, no LLM provider abstraction, etc.). Decision log appended as design calls land. Linked from README FAQ.
- Sprint backlog gained 24 forward-looking stories under new epics E6 (npx-first install), E7 (ECC project-scope), E8 (multi-agent, demand-gated), E9 (beta soak). E7-001 (ECC upstream PR) is marked `ready` — next actionable item.

## [0.7.2-beta.0] — 2026-05-19

### Changed
- `package.json` `files` block tightened for first npm publish: exclude `*.test.js` (internal unit tests, not user examples) and `docs/flow/` (Flow's internal dogfood backlog — sprint.yaml, scope-reviews, deferred ledger). Tarball drops from 61 → 53 files, 91.2 kB → 80.8 kB packed. User-runnable utilities (`tools/lint-changelog.js`, `tools/fix-caveman-shrink.sh`) added to the allowlist.

## [0.7.1] — 2026-05-19

### Added
- `/flow-init` now drops a `.caveman-enable` zero-byte marker in the project root. Pairs with the upstream Caveman PR ([JuliusBrussee/caveman#407](https://github.com/JuliusBrussee/caveman/pull/407)) that adds project-scope gating via `.caveman-enable` / `.caveman-disable` markers + env var + config allow/deny lists. Flow's own repo carries the marker so contributors keep Caveman active here even with global default flipped to off. Fully closes #9 + #25 once the upstream PR merges.
- `docs/flow/scope-reviews/2026-05-19.md` — first scope-review dogfood run on Flow's own backlog. Spawned background general-purpose agent against `docs/flow/sprint.yaml` + reference docs + git log. Output: 3 merges + 3 drops + 3 splits + 7 adds + 3 epic-reconsiderations proposed; all 3 merges / drops / splits and all 7 adds applied; light epic change (E5 renamed CLI + release-hardening; full re-cut deferred to v0.8). `sprint.yaml` grew 32 → 46 stories with retroactive attribution for hidden CHANGELOG work. Honest postmortem flagged E5 as scope creep and E3-007 docs story as too coarse. Closes #14.

### Fixed
- Upstream Caveman PR #407 hot-fix: project-scope check now precedes the global `off` branch so `.caveman-enable` actually activates caveman when the user has flipped global default to `off` (allowlist mode). Original logic order silently broke the canonical workflow. Pushed as commit `5602309` to the PR branch with 2 new test cases. Local install also patched. `~/.config/caveman/config.json` now set to `{"defaultMode":"off"}` so non-Flow projects stay silent; Flow projects activate via `.caveman-enable` marker that `/flow-init` drops.
- E5-009 — stripped the false `/flow-sprint scope-review --apply-from <path>` promise from the workflow. Text now points at same-day re-run for resumed interactive apply.

### Added
- `flow doctor --repair-upstream <bmad|ecc|caveman>` — prints the exact commands to reinstall an upstream at its pinned version after drift. Does NOT auto-run (upstream installers touch user-scope state and curl-pipe-bash should never be implicit). Closes E5-005.
- `tools/lint-changelog.js` + `changelog-format` CI job — enforces CONTRIBUTING.md's "one-line entries" rule. Flags wrapped CHANGELOG entries with line numbers. Honors fenced code blocks and indented continuation. Closes E5-006.
- `lib/commands/doctor.test.js`, `install.test.js`, `add.test.js`, `remove.test.js`, `tools/lint-changelog.test.js` — coverage for the previously-untested CLI command modules plus the new linter. Suite now 51/51 (was 18 before this batch).

### Changed
- README refreshed for v0.7.0: install status block now states the truth (clone + dev-link works; npm publish pending as E1-002), "three skills" → four (flow-doctor added), install bullets mention Caveman installer + SHA-256 inspection + `.caveman-enable` marker + BMad migration backup. The Caveman scope FAQ entry now links to [JuliusBrussee/caveman#407](https://github.com/JuliusBrussee/caveman/pull/407) and documents the `{"defaultMode": "off"}` + allowlist mode you can apply today.
- E5-007 — stripped the team-profile `features` block (`multi_repo: true`, `multi_llm_review: true`, `audit_log: true`) from catalog.yaml. All three had zero implementation; `multi_llm_review` was a renamed duplicate of `review.use_separate_model` which is real. README + `docs/profiles.md` team-profile descriptions rewritten to ship-as-stated. Read-only multi-repo awareness tracked as deferred E5-010 (build on real demand, not speculatively).
- `flow.config.yaml` + `docs/flow/sprint.yaml` + `docs/flow/deferred.md` — Flow now dogfoods Flow. Sprint state maps the 28-issue v0.6.1 review backlog to 5 epics. `/flow-sprint scope-review` can now be run on Flow's own backlog (closes prep for #14).
- `lib/commands/doctor.js` — `flow doctor` headless health check. Probes catalog parse + schema, install-state at each scope, flow.config.yaml shape, adapter file presence + symlink kind (mixed-state warning), required CLIs in $PATH, upstream pin status. Exit code 0/1/2 for ok/warn/fail. JSON output via `--json`. LLM-dependent probes (MCP responsiveness, severity-label scan) remain in `/flow-doctor` skill.
- `lib/commands/install.js` — `flow install` headless install path. Runs catalog operations (copy components, ensure dirs, touch state) but intentionally does NOT invoke BMad/ECC/Caveman/MCP installers (those need interactive auth + curl-pipe-bash confirmations). Surfaces clear "next steps" hand-off to `/flow-init` for the remainder.
- `lib/commands/add.js` + `lib/commands/remove.js` — single-adapter swap via CLI. `flow add adapter:e2e-playwright-mcp --yes` copies adapter files AND updates `flow.config.yaml.adapters.<family>`. `flow remove` flips the family back to its `none` variant (Flow expects SOME adapter per family) without deleting adapter files from disk.
- `lib/commands/plan.test.js` + `lib/commands/uninstall.test.js` — coverage for the CLI command modules. Suite now 18 tests, all green.

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
