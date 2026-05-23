# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Flow is

A workflow orchestrator for Claude Code that delegates to **BMad** (planning), **ECC** (per-story primitives), and **Caveman** (output compression) instead of reimplementing them. The value Flow adds is a thin layer: profile resolution, sprint state, adapter routing, and a per-story phase chain. Token-light by design (~20k/story in mini vs ~95k in BMad full).

Flow ships two execution surfaces that share all underlying logic:

1. **Slash commands inside Claude Code** (skills/flow-*/) — interactive Q&A, error recovery, LLM-driven phase chain. The skill workflow files (`workflow.md`) are markdown DSLs Claude Code reads and executes.
2. **Headless CLI** (`bin/flow.js`) — same install + sprint ops as the skills, without LLM dependency. Used in CI scripts and `npx`-first installs. LLM-driven operations (`/flow-story`, `scope-review`, `retro`) intentionally stay slash-only — ROADMAP principle #6: "one source of truth per behavior".

When changing behavior, decide which surface owns it. Don't duplicate.

## Architectural rules that matter

1. **`catalog.yaml` is the source of truth.** Everything Flow can install — profiles, adapters, MCPs, upstream dispatchers, curated subsets — is declared there. Adding a new adapter or MCP usually means editing the YAML + dropping a markdown file under `adapters/<family>/` or referencing an MCP install command. No new code paths needed for the common case.

2. **Upstream installers are dispatched, never wrapped.** `lib/init/upstreams/{bmad,ecc,caveman}.js` build commands from catalog fields and exec them via `execa`. We never re-implement what an upstream installer does. When an upstream changes its install command, edit catalog.yaml — not Flow's code.

3. **`install-state.json` is the only authoritative record of what was installed.** Lives at `.claude/flow/install-state.json` (project scope) and/or `~/.claude/flow/install-state.json` (home scope). Doctor reads it for repair commands; `--update` reads it for diffs; `--repair` reads it for the recorded profile. Don't introduce parallel state.

4. **YAML round-trip preservation matters.** `lib/sprint/store.js` uses `yaml`'s Document API (not parse+stringify) so user comments and ordering in `docs/flow/sprint.yaml` survive each sprint mutation. The skill mutates sprint.yaml dozens of times per sprint — lossy round-trips would shred user annotations.

5. **Tests stub via `dryRun`, not by mocking `execa`.** Upstream dispatchers (`lib/init/upstreams/*`) take `opts.dryRun` and short-circuit `runCommand`. Integration tests in `lib/init/orchestrate.test.js` pass `dryRun: true` to exercise the whole chain without network installs. Earlier in this codebase a `dryRun: false` test hung CI in 4 dead `npm test` processes because each upstream actually shelled out to `npx`-fetch its package. **Never write a test that does real upstream installs.**

6. **`force: false` is the scaffold default.** `lib/init/scaffold.js` skips existing files unless `--force` is passed. This is what enables `flow init --repair` to recreate ONLY the missing scaffold without touching the user's hand-edited config.

7. **Two-scope ECC requires care.** ECC can install user-scope (`~/.claude/`) or project-scope (`<projectRoot>/.claude/`). The `--ecc-scope` CLI flag overrides the profile default. `flow init --update` refuses scope swaps mid-flight — they require uninstall + reinstall because filesystem layout differs. `flow doctor` has a collision probe for "both scopes have content".

8. **Aspirational copy is a bug.** ROADMAP principle #2: any "in v0.X", "coming soon", "planned for" copy in README / docs / CLI help / catalog needs a matching sprint.yaml story with status `ready` or `in_progress`. Otherwise default to "unscheduled — PRs welcome" or "lands when demand surfaces". CONTRIBUTING.md codifies this as a pre-PR habit.

## Repository layout (the parts that aren't obvious)

```
bin/flow.js              # CLI dispatcher — subcommand routing only
lib/
├── catalog.js           # catalog.yaml loader + profile resolver (extends-chain merge)
├── commands/            # Headless CLI commands (init, install, plan, doctor, sprint, etc.)
├── init/                # Orchestrator chain components
│   ├── detect.js         # Project shape detection (git/pkg manager/upstream presence)
│   ├── questions.js      # @inquirer/prompts wrappers for Q1–Q9
│   ├── recommendation.js # Profile recommendation from detection
│   ├── orchestrate.js    # The CHAIN: detect → ask → upstreams → mcp → migrate → scaffold
│   ├── scaffold.js       # File-writer (flow.config.yaml, sprint.yaml, install-state.json)
│   ├── migrate-bmad.js   # Backup-first BMad → Flow state migration with rollback
│   ├── secrets.js        # MCP api_token env var collection + persistence
│   ├── mcp.js            # claude mcp add dispatcher
│   └── upstreams/        # bmad / ecc / caveman + common.js (tokenizeCommand, runCommand)
├── sprint/              # Pure-YAML sprint ops (store + operations)
└── repo-root.js         # Resolves catalog location from runtime context

skills/                  # Claude Code slash command workflows (markdown DSL)
├── flow-init/            # /flow-init — interactive installer
├── flow-sprint/          # /flow-sprint — sprint subcommands
├── flow-story/           # /flow-story — per-story phase chain (CC-only)
└── flow-doctor/          # /flow-doctor — health check (slash version)

adapters/                # One markdown file per adapter; routed by family
├── e2e/, issue-tracker/, pr/, verify/

templates/               # flow.config.yaml.tmpl, sprint.yaml.tmpl, story.md.tmpl, etc.
schemas/                 # JSON Schema for catalog + install-state + flow-config
catalog.yaml             # SOURCE OF TRUTH — every adapter, MCP, profile, upstream
docs/flow/sprint.yaml    # Working sprint state — live source for what to do next
```

## Common commands

```bash
# Tests — Node's built-in test runner
npm test                                # all tests (~25s)
node --test lib/init/orchestrate.test.js  # single file
node --test lib/init/                   # whole directory

# Smoke (no network, no upstream installs)
node bin/flow.js plan --profile minimal --json
node bin/flow.js init --profile minimal --yes --dry-run

# Test the headless install end-to-end in a tmp dir
TMP=$(mktemp -d) && cd $TMP && node $REPO/bin/flow.js init --profile minimal --yes

# CHANGELOG linter (CI gate)
node tools/lint-changelog.js CHANGELOG.md

# Release
tools/release.sh 0.8.0-beta.0           # cut tag (no publish)
tools/release.sh 0.8.0-beta.0 --dry-run # preview
# Then manually: npm publish --tag beta --access public
```

## CHANGELOG gate

CI enforces: any PR that touches `lib/`, `bin/`, `skills/`, `adapters/`, `templates/`, `catalog.yaml`, or `package.json` must also touch `CHANGELOG.md`. Append to `## [Unreleased]`. Entries must be one line (the `tools/lint-changelog.js` linter enforces this; wrapped entries fail CI).

## Test discipline

- 179+ tests as of v0.8.0-beta.0. Adding code without a test is unusual.
- Integration tests (`orchestrate.test.js`, the CI smoke job in `.github/workflows/ci.yml`) deliberately run with `dryRun: true` on upstream dispatchers. Don't change this.
- The `captureOutput` helper pattern in test files varies. Most use a try/finally that restores `console.log` synchronously — that's fine for commands that print all output before the first `await`. `lib/commands/init.test.js` uses a promise-`.finally` variant because `--repair`/`--update` dynamically import scaffold and so print across an await boundary. Match the pattern to the command's shape.

## Release channels

- `npm install -g @mhd-ghaith-abtah/flow@beta` → newest beta
- `npm install -g @mhd-ghaith-abtah/flow` → `latest` dist-tag (lags behind beta during soak windows)
- `npx -y @mhd-ghaith-abtah/flow@beta init --profile mini --yes` → one-shot install

When publishing a new beta: `npm publish --tag beta --access public`. The `--tag beta` is critical — without it, `latest` moves and the soak discipline breaks.

## Where to put which kind of change

| Change kind | File(s) |
|---|---|
| New profile bundle | `catalog.yaml > profiles` |
| New adapter | `adapters/<family>/<id>.md` + register in `catalog.yaml > adapters` |
| New MCP | `catalog.yaml > mcps` (install_cmd + auth + env vars) |
| Behavior change to existing slash command | `skills/<name>/workflow.md` |
| Behavior change to existing headless CLI command | `lib/commands/<name>.js` |
| New upstream installer | `lib/init/upstreams/<name>.js` + entry in `catalog.yaml > upstreams` |
| New CLI flag | `bin/flow.js` yargs string/boolean list + the consuming command + USAGE help |
| Breaking change to install-state | `schemas/install-state.schema.json` + migration in `lib/init/orchestrate.js` |
| Cross-cutting principle / convention | `ROADMAP.md` (decision log) + `CONTRIBUTING.md` (write-time discipline) |

## Things to read before non-trivial changes

- `ROADMAP.md` — multi-epic arc + 7 guiding principles + decision log
- `CONTRIBUTING.md` — pre-PR habits (CHANGELOG, no version promises, etc.)
- `docs/flow/sprint.yaml` — what's actually open / in-progress / monitored
- The skill workflow file relevant to the surface you're changing (`skills/<name>/workflow.md`) — the source of truth for the interactive path's behavior
