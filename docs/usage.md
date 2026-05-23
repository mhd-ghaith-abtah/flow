# Using Flow — the complete guide

How to install, configure, run, maintain, and uninstall Flow in every supported scenario.

This is the long-form reference. For the 10-minute first-install path, see [quickstart.md](quickstart.md). For per-profile details, see [profiles.md](profiles.md). For adapter mechanics, see [adapters.md](adapters.md). For BMad → Flow migration, see [migrate-from-bmad.md](migrate-from-bmad.md).

> **Heads up on availability.** Some flags described here (`flow init --yes`, `--update`, `--repair`, `--remove-project-ecc`, MCP secrets collection) require **v0.8.0-beta.0 or later**. Earlier versions on the `latest` dist-tag have the slash-command path only. Install the beta with `npm install -g @mhd-ghaith-abtah/flow@beta` until `latest` catches up.

---

## Table of contents

- [1. Installation paths](#1-installation-paths)
- [2. First-time install](#2-first-time-install)
- [3. Daily story workflow](#3-daily-story-workflow)
- [4. Sprint state management](#4-sprint-state-management)
- [5. Profiles and customization](#5-profiles-and-customization)
- [6. ECC install scope](#6-ecc-install-scope)
- [7. Health checks and maintenance](#7-health-checks-and-maintenance)
- [8. Updating an existing install](#8-updating-an-existing-install)
- [9. Repairing a broken install](#9-repairing-a-broken-install)
- [10. Uninstalling](#10-uninstalling)
- [11. Inside Claude Code — slash command reference](#11-inside-claude-code--slash-command-reference)
- [12. Complete CLI flag reference](#12-complete-cli-flag-reference)
- [13. Common scenarios (recipe book)](#13-common-scenarios-recipe-book)
- [14. Environment variables](#14-environment-variables)
- [15. Files Flow writes](#15-files-flow-writes)
- [16. Troubleshooting](#16-troubleshooting)
- [17. How Caveman enhances Flow](#17-how-caveman-enhances-flow)

---

## 1. Installation paths

Flow ships in two surfaces: a Claude Code skill bundle (interactive) and a Node CLI (`flow`, headless). Both invoke the same underlying installers and write the same files.

**Bootstrap order matters.** Claude Code discovers slash commands by scanning `~/.claude/skills/<name>/`. The npm package puts skill files in the install location (typically `~/.npm-global/lib/node_modules/...`), NOT in `~/.claude/skills/`. So `/flow-init` does NOT work after a bare `npm install -g`. You need to run `flow install-skills` once to symlink the four skills into Claude Code's discovery path.

### a. From npm (recommended)

```bash
# 1. Install the Node CLI
npm install -g @mhd-ghaith-abtah/flow@beta
flow --version

# 2. Bootstrap Claude Code surface (links 4 skills into ~/.claude/skills/)
flow install-skills

# 3. Now both paths work — pick one per project:
flow init --profile mini --yes              # headless
# OR, inside Claude Code:
/flow-init                                  # interactive
```

`flow install-skills` is idempotent — re-run safely after every upgrade to refresh the symlinks. It refuses to clobber existing real directories at the target without `--force`.

### b. install-skills scope flag

By default `flow install-skills` writes to `~/.claude/skills/` (home scope). Override:

```bash
flow install-skills                            # default: --scope home
flow install-skills --scope home               # user-wide ~/.claude/skills/
flow install-skills --scope project            # team-commit: <cwd>/.claude/skills/
flow install-skills --scope both               # both
flow install-skills --dry-run                  # preview
flow install-skills --force                    # replace existing real dirs
```

The `--scope project` mode is for teams that want every contributor to get Flow's slash commands the moment they `git clone` the repo — commit `<project>/.claude/skills/flow-*` so Claude Code picks them up automatically when the session is opened inside the project. The user still needs the npm package installed because the symlinks point at it.

### c. `npx` — no install

```bash
npx -y @mhd-ghaith-abtah/flow@beta install-skills     # one-time bootstrap
npx -y @mhd-ghaith-abtah/flow@beta init --profile mini --yes
```

`npx` works but the symlink targets the npx cache path, which can disappear when the cache rotates. For ongoing use, prefer `npm install -g`.

### d. Development clone

```bash
git clone https://github.com/mhd-ghaith-abtah/flow.git
cd flow && npm install && tools/dev-link.sh
```

`tools/dev-link.sh` is the dev-mode equivalent of `flow install-skills --scope home` — symlinks the four `skills/flow-*` dirs into `~/.claude/skills/` AND puts `flow` on `$PATH` from your clone. Use when you're contributing so changes to skill workflows take effect immediately.

`tools/dev-link.sh` symlinks your clone into `$HOME/.claude/skills/flow-*` and onto `$PATH` as `flow`. Use when you're contributing.

### e. Verifying the install

```bash
flow --version                   # → 0.8.0-beta.0 (or newer)
flow doctor                      # health check
flow help                        # subcommand list
```

---

## 2. First-time install

### a. Interactive (inside Claude Code)

```
/flow-init
```

The skill walks through Q1–Q9:

| Q | Asks about |
|---|---|
| Q1 | **Profile** — minimal / mini / standard / team (recommended option auto-detected from project shape) |
| Q2 | **Issue tracker adapter** — linear / github-issues / none |
| Q3 | **PR adapter** — github / none |
| Q4 | **E2E adapter** — playwright-mcp / none |
| Q5 | **Verify adapter** — make / pnpm / custom |
| Q6 | **BMad subset** — none / planning-only / full / etc. |
| Q7 | **ECC subset** — none / flow-essentials / flow-essentials-plus-tdd / etc. |
| Q7c | **ECC install scope** — user / project (asked only when ECC subset ≠ none) |
| Q7b | **Caveman compression mode** — none / lite / full / ultra / wenyan |
| Q8 | **Migrate existing BMad state?** — only asked if BMad is detected |
| Q9 | **Secrets store** — env-file / shell / 1password (only env-file persists; the others print instructions) |

Each answer pre-populates from the chosen profile's default. Hit Enter to accept; type to override.

### b. Headless (via the CLI)

```bash
flow init --profile mini --yes
```

Pre-fills every answer from the profile's defaults — no prompts. Useful for scripted setup, fresh-machine bootstrap, and CI.

Override individual knobs without leaving the profile:

```bash
flow init --profile team --yes \
  --ecc-scope user \
  --bmad-subset planning-only \
  --ecc-subset flow-essentials
```

CLI flag → answer mapping:

| Flag | Maps to |
|---|---|
| `--profile <name>` | Q1 |
| `--bmad-subset <name>` | Q6 |
| `--ecc-subset <name>` | Q7 |
| `--ecc-scope user\|project` | Q7c |
| `--with adapter:<id>` | Adds to Q2–Q5 picks |
| `--without adapter:<id>` | Removes a profile-default adapter |

Q2–Q5 adapter picks aren't exposed as single flags yet — use the profile default or `--with`/`--without` to compose.

### c. Preview only (no execution)

```bash
flow init --profile standard --dry-run            # plan only
flow init --profile standard --yes --dry-run      # exercise full chain in dry-run mode
```

The first form prints the resolved bundle from `catalog.yaml`. The second runs the entire orchestrator (detect → upstreams → MCPs → scaffold) without actually writing or shelling out — useful for verifying a fresh setup before committing to it.

### d. What gets installed

Regardless of path, a fresh install produces:

```
<project>/
├── .claude/
│   ├── flow.config.yaml         # team-shared config (COMMIT THIS)
│   └── flow/
│       └── install-state.json   # what Flow did, when
└── docs/
    └── flow/
        ├── sprint.yaml          # SOURCE OF TRUTH for stories (COMMIT THIS)
        ├── deferred.md          # one-line backlog items
        ├── stories/             # active story markdown files
        ├── archive/             # completed story files
        ├── journeys/            # E2E journey definitions
        └── retros/              # epic retros
```

Plus, depending on profile:
- Skills under `~/.claude/skills/{flow-init,flow-sprint,flow-story,flow-doctor}/`
- ECC content under `~/.claude/rules/ecc/` + `~/.claude/skills/ecc/` (user scope) OR `<project>/.claude/rules/ecc/` + `skills/ecc/` (project scope — team profile default)
- BMad in `_bmad/` if BMad subset ≠ none
- Caveman in `~/.claude/plugins/cache/caveman/` if Caveman subset ≠ none
- MCPs registered with Claude Code via `claude mcp add`
- Secrets in `~/.claude/.env.flow` (chmod 600) if any `api_token` MCP was selected

### 2c. Starting from zero (greenfield + BMad planning)

If you have only an idea and no code yet, Flow uses BMad's planning workflow to get you from concept → PRD → architecture → stories → first execution, then takes over per-story orchestration.

**Setup:**

```bash
mkdir my-idea && cd my-idea
git init && echo "# My idea" > README.md

npm install -g @mhd-ghaith-abtah/flow@beta
flow install-skills

# Pick a profile that ships BMad full. `standard` is enough for solo dev:
flow init --profile standard --yes --bmad-subset full
```

`--bmad-subset full` installs BMad's `bmm` module (Project Manager, Architect, Product Owner, dev workflows) plus its planning-artifacts directory under `docs/_bmad-output/planning-artifacts/`.

**The planning loop (inside Claude Code):**

Once Flow finishes installing, BMad's slash commands become available. Exact names depend on your BMad version — BMad 6+ uses a `/bmad:bmm:<step>` namespace:

```
/bmad:bmm:1-analysis          # Optional — competitive research / scope scan
/bmad:bmm:2-plan-workflow     # PRD (Project Manager agent)
/bmad:bmm:3-solutioning       # Architecture + tech stack (Architect)
/bmad:bmm:4-implementation    # Story decomposition (Scrum Master + PO)
```

Each step writes to `docs/_bmad-output/planning-artifacts/`:
- `prd.md` — product requirements
- `architecture.md` — system design
- `epics.md` — high-level work breakdown
- `stories/E1-S1-*.md` etc. — individual story files

**Convert BMad's plan into Flow's sprint:**

After BMad produces stories, import them:

```bash
flow sprint import-bmad
# OR inside Claude Code:
/flow-sprint import-bmad
```

The migrator reads `docs/_bmad-output/implementation-artifacts/sprint-status.yaml`, maps BMad statuses → Flow statuses, and writes `docs/flow/sprint.yaml` with backup-first / rollback-on-failure semantics. BMad's content stays in place — Flow doesn't delete `_bmad/`. See [migrate-from-bmad.md](migrate-from-bmad.md) for the migration mechanics.

**Run the first story through Flow:**

```
/flow-story E1-S1
```

Flow takes BMad's story file, runs plan → implement → review → ship on it. BMad gave you the **why** (PRD/architecture); Flow drives the **how** (per-story execution, lighter ceremony, ~5× fewer tokens than BMad's own per-story workflow).

**The whole greenfield arc in one diagram:**

```
Idea
 │
 ▼
flow init --profile standard --yes --bmad-subset full
 │
 ▼
/bmad:bmm:2-plan-workflow      ── PRD
 │
 ▼
/bmad:bmm:3-solutioning        ── architecture, tech stack
 │
 ▼
/bmad:bmm:4-implementation     ── stories + sprint-status.yaml
 │
 ▼
flow sprint import-bmad        ── stories now live in docs/flow/sprint.yaml
 │
 ▼
/flow-story E1-S1              ── per-story chain
/flow-story (no args)          ── advance whatever's active
```

You can also stay in BMad's per-story workflow if you prefer its ceremony. Flow's `/flow-story` is the lighter alternative — same outcome, fewer tokens, slightly less hand-holding.

---

## 3. Daily story workflow

The per-story phase chain is **Claude Code only** — it's LLM-driven and the CLI doesn't have an equivalent. Inside Claude Code:

```
/flow-story          # advance the active story to its next phase
/flow-story E1-001   # advance a specific story
/flow-story status   # show the current story-id without advancing
```

Phases chain automatically:

```
plan → /prp-implement → /code-review → /update-docs → /prp-commit → /prp-pr
```

The chain stops on hard halts: CRITICAL review findings, verify failures, e2e failures, PR open (waiting for merge).

To run a specific phase manually without going through `/flow-story`:

```
/plan
/prp-implement
/code-review
/update-docs
/prp-commit
/prp-pr
```

Most users never call these directly — `/flow-story` dispatches to the right one.

---

## 4. Sprint state management

Sprint state lives in `docs/flow/sprint.yaml`. Mutate via either surface:

### a. Inside Claude Code (slash)

```
/flow-sprint add "Story title" --epic E1
/flow-sprint next
/flow-sprint status
/flow-sprint done E1-001
/flow-sprint done E1-001 --note "PR auto-merged"
/flow-sprint deferred
/flow-sprint retro E1
/flow-sprint scope-review
/flow-sprint import-bmad
```

### b. Headless CLI (pure-YAML ops, no LLM)

```bash
flow sprint status
flow sprint status --json

flow sprint next                                   # pick first backlog story
flow sprint next --epic E2                         # restrict to one epic

flow sprint add --id E1-003 --title "New thing" --epic E1
flow sprint add --id E1-004 --title "Tagged work" --epic E1 \
  --tags cli,ux --why "Closes the X gap"

flow sprint done E1-002
flow sprint done E1-002 --note "PR auto-merged"
flow sprint done E1-002 --force                    # bypass review-only gate

flow sprint deferred
flow sprint deferred --json

flow sprint import-bmad                            # one-shot BMad migration
```

### c. What stays slash-only

LLM-driven subcommands (`retro`, `scope-review`) live in `skills/flow-sprint/workflow.md` and don't have a CLI equivalent. They synthesize across multiple inputs (story files, git history, deferred items) using the LLM. A CLI stub would inevitably drift from the skill behavior — see [ROADMAP.md](../ROADMAP.md) principle #6.

### d. Sprint YAML round-trip preservation

Flow uses the `yaml` library's Document API rather than parse-then-stringify, so your hand-edited comments, blank lines, and key ordering in `sprint.yaml` survive every mutation. You can confidently put load-bearing notes in the file.

---

## 5. Profiles and customization

Profiles are pre-built bundles. Pick one based on your situation. Full reference: [profiles.md](profiles.md).

| Profile | Best for | Tokens/story | Default ECC scope |
|---|---|---:|---|
| `minimal` | Bare Flow, no upstreams | <10k | user |
| `mini` | Solo dev, one repo | ~20k | user |
| `standard` | Solo/small team, formal review | ~40k | user |
| `team` | Multi-LLM review, Linear-driven | ~60k | **project** |

### a. Inspect a profile without installing

```bash
flow plan --profile team
flow plan --profile team --json
```

### b. Override individual adapters

```bash
# Add an adapter on top of a profile's defaults:
flow init --profile mini --with adapter:e2e-playwright-mcp --yes

# Remove a profile-default adapter:
flow init --profile standard --without adapter:issue-tracker-github-issues --yes
```

### c. Swap profile mid-life

```bash
flow init --update --profile team                  # mini → team
flow init --update --profile team --dry-run        # preview deltas first
```

`--update` reads recorded answers from `install-state.json`, applies the new profile's defaults for any answer the user didn't pin via CLI, and re-runs the chain. See [Section 8](#8-updating-an-existing-install).

### d. Add or remove single components

```bash
flow add adapter:e2e-playwright-mcp                # adds + installs
flow add adapter:issue-tracker-linear              # swaps issue-tracker family
flow remove adapter:pr-github                      # removes
```

`flow add` and `flow remove` are the canonical adapter-swap mechanism. `flow.config.yaml` hand-edit also works — both routes update install-state.

---

## 6. ECC install scope

ECC content can land at two locations:

- **user scope:** `~/.claude/rules/ecc` + `~/.claude/skills/ecc` (shared across all your projects)
- **project scope:** `<projectRoot>/.claude/rules/ecc` + `<projectRoot>/.claude/skills/ecc` (per-repo isolation)

The team profile defaults to **project** scope so each Flow-managed repo keeps its own ECC selection. All other stock profiles default to **user** scope.

### a. Override at install time

```bash
flow init --profile team --ecc-scope user --yes        # team but user-scope
flow init --profile mini --ecc-scope project --yes     # mini but project-scope
flow plan --profile mini --ecc-scope project           # preview
```

Typos like `--ecc-scope=projet` fail loud with a clear error — silent fallback to the profile default would be a confusing UX.

### b. Distribution caveat

ECC's `claude-project` install target merged into ECC's `main` branch via [affaan-m/ECC#2006](https://github.com/affaan-m/ECC/pull/2006) on 2026-05-19, but the current `ecc-universal@latest` is `1.10.0` (from 2026-04-15), which predates the merge. Flow's `catalog.yaml` pins to a post-merge github commit (`npx -y -p "github:affaan-m/ECC#98bd5174" ecc-install`) until ECC publishes a 2.x release.

You don't have to do anything — Flow's installer handles this transparently. The catalog's `cmd_fallback` field will get swapped back to `npx ecc-universal install` the day ECC 2.x publishes.

### c. Detect scope drift

```bash
flow doctor                                        # reports both scopes if present
```

The doctor probe surfaces a `Collisions` section when ECC content exists at BOTH `~/.claude/rules/ecc` AND `<cwd>/.claude/rules/ecc`. Common cause: a user switched `--ecc-scope` between installs without uninstalling first. The probe reads `install-state.json` to identify the active scope and suggests `rm -rf <stale_dir>`.

---

## 7. Health checks and maintenance

### a. `flow doctor` — health check

```bash
flow doctor                       # human-readable
flow doctor --json                # scriptable
flow doctor --verbose             # extra detail
```

Reports:
- Catalog: parse + schema validation
- Install state: home + project-scope `install-state.json` presence/validity
- Config: `flow.config.yaml` presence, required keys
- Adapters: files present at expected paths (symlink-vs-regular-file detection)
- CLIs: required CLIs in `$PATH` for the active adapters
- Upstreams: BMad/ECC/Caveman version pins vs recorded values
- Collisions: ECC dual-scope content (E7-004)

Exit codes:
- `0` — all OK or only informational
- `1` — at least one warning
- `2` — at least one failure

### b. Repair upstream installer pins

```bash
flow doctor --repair-upstream bmad
flow doctor --repair-upstream ecc
flow doctor --repair-upstream caveman
```

Prints (does NOT auto-run) the exact reinstall commands for one upstream, parameterized by the pinned version recorded in `install-state.json`. For ECC, output is scope-aware — user-scope vs project-scope produces different commands.

### c. Re-register MCPs that drifted

There's no dedicated `flow mcp` command; running `flow init --update` re-registers any MCPs missing from `claude mcp list`. The `mcp.js` dispatcher is idempotent — already-registered MCPs are skipped.

---

## 8. Updating an existing install

`flow init --update` re-runs the chain against an existing install with the same — or overridden — answers.

### a. No-op check

```bash
flow init --update
```

Reads `install-state.json`, computes the delta against the resolved profile, and reports "No changes — install matches the requested state." Useful as a sanity check.

### b. Swap profile

```bash
flow init --update --profile team
flow init --update --profile team --dry-run        # preview deltas first
```

Output shows per-key deltas before applying:

```
━━━ flow init (update) ━━━
  was: profile=mini  →  now: profile=team  cwd=...  dry-run=false

Changes:
  Δ profile: mini → team
  Δ issueTracker: github-issues → linear
  Δ bmadSubset: none → full
  Δ eccSubset: flow-essentials → flow-essentials-plus-tdd
  Δ eccScope: user → project
```

### c. Bump individual knobs

```bash
flow init --update --bmad-subset full
flow init --update --ecc-subset security
```

### d. Force-rewrite flow.config.yaml

```bash
flow init --update --force
```

Useful when the catalog template logic changed between Flow versions and you want your `flow.config.yaml` regenerated even though nothing in your answers changed.

### e. What `--update` refuses

`--update` halts with an explicit uninstall+reinstall recipe when:

- **install_scope changes** (user → project or vice versa). Scope swaps need filesystem cleanup at the old location. The error message includes the exact `flow uninstall` command including `--remove-project-ecc` when applicable.

```
✗ flow init --update: install_scope change (user → project) is not supported mid-flight
  Suggested:
    flow uninstall --execute --yes
    flow init --profile team --ecc-scope project --yes
```

### f. What `--update` does NOT do

- Doesn't *remove* MCPs you've unselected (destructive; explicit `claude mcp remove` needed)
- Doesn't *uninstall* upstreams whose subset changed to `none` (manual cleanup)
- Doesn't run `git pull` on `_bmad/` or `~/.claude/rules/ecc/` — version pinning stays whatever the upstream installer wrote

---

## 9. Repairing a broken install

Use `flow init --repair` when scaffold files have been deleted but the install otherwise looks intact:

```bash
flow init --repair                 # restore missing docs/flow/sprint.yaml etc.
flow init --repair --dry-run       # preview
```

### a. What `--repair` does

- Loads `profile` + `answers` from `install-state.json`
- Runs `scaffold()` with `force: false` so existing files are preserved
- Recreates ONLY the missing scaffold files (sprint.yaml, deferred.md, install-state.json, etc.)
- Skips upstream installers, MCP registration, BMad migration entirely

### b. What `--repair` refuses

- No `install-state.json` present → exit 1 with hint to run `flow init --profile <name> --yes` for a fresh install
- Corrupt `install-state.json` → exit 2 with parse error

### c. When to use `--repair` vs `--update`

| Symptom | Command |
|---|---|
| `docs/flow/sprint.yaml` deleted | `flow init --repair` |
| `flow.config.yaml` deleted | `flow init --repair` |
| Want to swap profile | `flow init --update --profile <new>` |
| Want to change ECC scope | `flow uninstall ... && flow init ...` |
| Want to rotate MCP api_token | `flow init --update` (re-prompts) |
| Recorded answers look right but `flow doctor` reports drift | `flow init --repair` first; if not enough, `--update` |

---

## 10. Uninstalling

### a. Project-scope (default)

```bash
flow uninstall                                     # dry-run by default
flow uninstall --execute --yes                     # actually remove
```

Removes:
- `<project>/.claude/flow/` (install-state, runtime state)
- `<project>/flow.config.yaml` + `flow.config.local.yaml`
- (with `--remove-stories`) `<project>/docs/flow/`
- (with `--remove-project-ecc`) `<project>/.claude/rules/ecc/` + `<project>/.claude/skills/ecc/`

Keeps:
- `<project>/docs/flow/` (your stories — your content) unless `--remove-stories`
- `<project>/.claude/rules/ecc/` and `skills/ecc/` unless `--remove-project-ecc`
- BMad, user-scope ECC, Caveman (owned by their respective installers)

### b. Home-scope

```bash
flow uninstall --scope home --execute --yes
```

Removes:
- `~/.claude/skills/{flow-init,flow-sprint,flow-story,flow-doctor}/`
- `~/.claude/flow/`

### c. Both scopes

```bash
flow uninstall --scope both --execute --yes --remove-stories --remove-project-ecc
```

### d. Removing the upstream installers themselves

Flow does NOT remove BMad, ECC, or Caveman because they were installed by their own installers. `flow uninstall` prints the manual commands at the end:

```
BMad:    rm -rf _bmad/ docs/_bmad-output/ (or `npx bmad-method uninstall`)
ECC:     ~/.claude/rules/uninstall.sh (or rm -rf ~/.claude/rules/)
Caveman: rm -rf ~/.claude/plugins/cache/caveman/ and `claude mcp remove caveman-shrink`
```

### e. Refused without `--yes`

`--execute` without `--yes` shows the plan + asks for explicit confirmation:

```
⚠ About to remove the above. Re-run with --execute --yes to confirm.
```

This is intentional — `--execute` alone won't accidentally delete files.

---

## 11. Inside Claude Code — slash command reference

The slash commands have CLI equivalents for the LLM-free operations:

| Slash (Claude Code) | Headless CLI | LLM dependency |
|---|---|---|
| `/flow-init` | `flow init --yes` | None |
| `/flow-init --update` | `flow init --update` | None |
| `/flow-init --repair` | `flow init --repair` | None |
| `/flow-sprint add` | `flow sprint add` | None |
| `/flow-sprint next` | `flow sprint next` | None |
| `/flow-sprint status` | `flow sprint status` | None |
| `/flow-sprint done` | `flow sprint done` | None |
| `/flow-sprint deferred` | `flow sprint deferred` | None |
| `/flow-sprint import-bmad` | `flow sprint import-bmad` | None |
| `/flow-sprint retro` | — | **Yes** (synthesizes archive + git log + retros) |
| `/flow-sprint scope-review` | — | **Yes** (audits scope creep across the sprint) |
| `/flow-doctor` | `flow doctor` | Some (probes MCP responsiveness) |
| `/flow-story` | — | **Yes** (per-story phase chain) |

Inside Claude Code, default to slash. Outside Claude Code, the CLI covers everything except `/flow-story`, `retro`, and `scope-review`.

---

## 12. Complete CLI flag reference

### Global flags (work on every command)

| Flag | Meaning |
|---|---|
| `--yes`, `-y` | Skip confirmation prompts (CI mode) |
| `--dry-run` | Print plan, don't execute |
| `--json` | Machine-readable output |
| `--force` | Overwrite existing files |
| `--verbose` | Show extra detail |
| `--scope home\|project\|both` | Install/uninstall scope |

### `flow init` flags

| Flag | Meaning |
|---|---|
| `--profile <name>` | minimal / mini / standard / team |
| `--update` | Re-run chain against existing install |
| `--repair` | Recreate missing scaffold (no upstreams) |
| `--ecc-scope user\|project` | Override profile's ECC scope |
| `--bmad-subset <name>` | Override BMad subset |
| `--ecc-subset <name>` | Override ECC subset |
| `--with adapter:<id>` | Add an adapter to the profile bundle |
| `--without adapter:<id>` | Remove a profile-default adapter |
| `--continue-on-error` | Don't halt at first upstream failure |
| `--migrate-bmad` | Run BMad migration (if BMad detected) |

### `flow sprint <subcommand>` flags

| Subcommand | Required / common flags |
|---|---|
| `status` | `--json` |
| `next` | `--epic <id>` (optional) |
| `add` | `--id <id> --title <t> --epic <E?>`, plus `--tags`, `--why`, `--issue`, `--status` |
| `done <id>` | `--note <s>`, `--force` |
| `deferred` | `--json` |
| `import-bmad` | `--project <name>` |

### `flow uninstall` flags

| Flag | Meaning |
|---|---|
| `--scope project\|home\|both` | Default: project |
| `--execute` | Required to actually remove (otherwise dry-run) |
| `--yes` | Required with `--execute` |
| `--remove-stories` | Also remove `docs/flow/` (user content) |
| `--remove-project-ecc` | Also remove `<project>/.claude/{rules,skills}/ecc` |
| `--remove-backups` | Also remove `*.flow-backup-*` files |

### `flow doctor` flags

| Flag | Meaning |
|---|---|
| `--repair-upstream <bmad\|ecc\|caveman>` | Print reinstall commands for one upstream |
| `--mcp <id>` | Probe a specific MCP only |

### `flow plan` flags

| Flag | Meaning |
|---|---|
| `--profile <name>` | Profile to resolve |
| `--with`, `--without`, `--ecc-scope` | Same as `flow init` |
| `--json` | Machine-readable plan |

---

## 13. Common scenarios (recipe book)

### a. Solo dev, single repo, light review

```bash
flow init --profile mini --yes
```

### b. Solo dev with several side projects, want ECC isolation per repo

```bash
flow init --profile mini --yes --ecc-scope project
```

### c. Small team using Linear + Playwright + cross-model code review

```bash
flow init --profile team --yes
# team defaults to project-scope ECC + Linear adapter + Playwright MCP
```

### d. Just want Flow's state model, no upstreams

```bash
flow init --profile minimal --yes
```

### e. Existing BMad project, want to migrate

```bash
flow init --profile standard --yes --migrate-bmad
# Or, after a first install:
flow sprint import-bmad
```

### f. Try before you commit

```bash
flow plan --profile team                            # preview profile
flow init --profile team --yes --dry-run            # exercise full chain in dry-run
```

### g. Rotate an MCP API token

```bash
flow init --update                                  # re-prompts for any required env vars
```

### h. Profile bump

```bash
flow init --update --profile team                   # mini → team
flow init --update --profile team --dry-run         # preview first
```

### i. Wrong ECC scope at install time, want to swap

```bash
flow uninstall --execute --yes --remove-project-ecc
flow init --profile team --ecc-scope user --yes
```

### j. Forgot what's installed

```bash
flow doctor
flow doctor --json | jq .
cat .claude/flow/install-state.json | jq .
```

### k. Build a fresh project from scratch in CI

```bash
# .github/workflows/setup-flow.yml
- run: npm install -g @mhd-ghaith-abtah/flow@beta
- run: flow init --profile mini --yes --dry-run    # smoke first
- run: flow init --profile mini --yes              # real install
- run: flow doctor                                  # gate
```

### l. Replace Caveman fork once upstream merges

When [JuliusBrussee/caveman#407](https://github.com/JuliusBrussee/caveman/pull/407) merges, Flow's `catalog.yaml` will be updated to point at upstream Caveman instead of `mhd-ghaith-abtah/caveman#flow-pin-v0.1`. Users get the swap automatically on the next Flow release. No action required on your end.

### m. Inspect Flow's install scripts before they run

```bash
export FLOW_INSPECT_INSTALL_SCRIPTS=1
flow init --profile mini --yes
# Each upstream halts before exec and prints the command + a hint at
# how to review the source (e.g. `gh repo view ...` for the Caveman fork).
```

### n. Re-run the full install chain after a major version bump

```bash
npm install -g @mhd-ghaith-abtah/flow@beta         # get the new version
flow init --update --force                          # rewrite flow.config.yaml + re-run
```

### o. Open a fresh `/flow-story` cycle from the CLI

You can't — `/flow-story` is LLM-driven. But you can prep the state from the CLI:

```bash
flow sprint add --id E1-001 --title "Bootstrap" --epic E1 --tags ci,setup
flow sprint next                                    # flip to doing
# Then inside Claude Code:
/flow-story E1-001
```

### p. Headless story bookkeeping during a marathon session

If you're driving multiple stories from one Claude Code session, the slash command updates sprint.yaml automatically. If you're driving from a script (CI, shell loop), use the CLI:

```bash
for id in E1-001 E1-002 E1-003; do
  flow sprint done "$id" --note "scripted close"
done
flow sprint status
```

---

## 14. Environment variables

| Variable | Meaning |
|---|---|
| `FLOW_REPO_ROOT` | Override catalog/templates location. Used internally when the slash command dispatches to the CLI. |
| `FLOW_INSPECT_INSTALL_SCRIPTS=1` | Don't auto-run upstream installers. Each dispatcher halts before exec, prints the command + a hint, and returns `inspect_only: true` in the state record. |
| `FLOW_DEBUG=1` | Show stack traces on CLI errors. |
| `HOME` | Standard. Used for user-scope paths (`~/.claude/...`) and the secrets file. |
| `CLAUDECODE` / `CLAUDE_CODE` | Auto-detected. Outside Claude Code, `flow init` falls through to the headless path. Inside, it nudges to the slash command. |

---

## 15. Files Flow writes

### a. Project tree (committed)

```
<project>/
├── .claude/
│   ├── flow.config.yaml           # team-shared, COMMIT THIS
│   ├── flow/
│   │   └── install-state.json     # what Flow did, COMMIT IT (helps `--repair`, `--update`)
│   ├── rules/ecc/                 # team profile only — owned by ECC, gitignore optional
│   └── skills/ecc/                # team profile only — owned by ECC, gitignore optional
└── docs/
    └── flow/
        ├── sprint.yaml            # SOURCE OF TRUTH for stories, COMMIT THIS
        ├── deferred.md            # open one-liners, COMMIT THIS
        ├── stories/               # active story files, COMMIT THIS
        ├── archive/               # completed stories, COMMIT THIS
        ├── journeys/              # E2E journey definitions, COMMIT THIS
        └── retros/                # epic retros, COMMIT THIS
```

### b. Gitignored

```
flow.config.local.yaml             # per-developer overrides
```

### c. User-scope (never committed)

```
~/.claude/
├── skills/{flow-init,flow-sprint,flow-story,flow-doctor}/
├── flow/install-state.json        # if you installed user-scope
├── .env.flow                      # secrets, chmod 600
├── rules/ecc/                     # mini/standard profile only
└── skills/ecc/                    # mini/standard profile only
```

### d. Backup files from BMad migration

```
docs/_bmad-output/implementation-artifacts/sprint-status.yaml.flow-backup-<ts>
docs/_bmad-output/implementation-artifacts/deferred-work.md.flow-backup-<ts>
```

These get created by `flow sprint import-bmad` (or `/flow-init --migrate-bmad`) before any write. Delete them after you're confident the migration is correct, or pass `--remove-backups` to `flow uninstall`.

---

## 16. Troubleshooting

### a. `flow: command not found`

`npm install -g @mhd-ghaith-abtah/flow@beta` didn't put `flow` on `$PATH`. Check `npm config get prefix` — that directory's `bin/` needs to be on your shell `$PATH`. Or use `npx`:

```bash
npx -y @mhd-ghaith-abtah/flow@beta --version
```

### b. `flow init --yes` exits with "ECC upstream failed"

The github-pinned ECC fallback can fail if:

1. **No network during install.** `npx -y -p "github:..."` needs to clone. Retry with network access.
2. **GitHub rate-limited.** Wait 5 min and retry.
3. **The pinned commit was force-pushed away.** Open an issue — Flow needs to re-pin.

Workaround: pass `--continue-on-error` to skip past upstream failures and inspect the resulting state with `flow doctor`.

### c. `flow doctor` shows "ECC scope collision"

Both `~/.claude/rules/ecc/` and `<project>/.claude/rules/ecc/` exist. Cause: you changed `--ecc-scope` between installs without uninstalling first. The doctor probe reads `install-state.json` to identify the active scope and prints the exact `rm -rf` command for the stale one.

### d. Caveman not active in this session

Caveman activates via `~/.claude/hooks/caveman-config.js` on `SessionStart`. Both the slash `/flow-init` and the headless `flow init --yes` (since v0.8.0-beta.2) drop a `.caveman-enable` marker file in your project root when you pick a non-`none` Caveman subset, so allowlist-mode users (`~/.config/caveman/config.json` = `{"defaultMode": "off"}`) get Caveman activated here automatically.

If you're on an older Flow version OR you picked `--caveman-subset none` at install time and changed your mind:

```bash
touch .caveman-enable
```

Then restart your Claude Code session for the hook to re-fire.

If the marker exists and Caveman still doesn't activate, run `flow doctor` and look at the Caveman row — `version=not pinned` plus an `installed=false` state record means the upstream installer never ran. Re-run `flow init --update` to fix.

### e. `flow sprint done E1-002` says "expects 'review' or 'doing'"

Story is in a state Flow won't auto-flip to done. Either:

- Move it to `review` first (typical when the PR is open and waiting)
- Pass `--force` to skip the gate (typical for backfilled offline stories)

```bash
flow sprint done E1-002 --force
```

### f. `flow init --repair` says "no install-state.json found"

Repair needs an authoritative install to read from. If you never ran `flow init`, run it first:

```bash
flow init --profile mini --yes
```

### g. `flow init --update` says "install_scope change is not supported mid-flight"

Scope swaps need filesystem cleanup at the old location. Follow the printed recipe:

```bash
flow uninstall --execute --yes --remove-project-ecc    # cleanup
flow init --profile team --ecc-scope user --yes        # reinstall with new scope
```

### h. `npm publish` fails with `EOTP` / `E401`

Authentication or 2FA issue. Run `npm login` to refresh auth, then retry the publish with `--otp=<code>`:

```bash
npm publish --tag beta --access public --otp=123456
```

### i. CI fails with `actions/checkout@v4` auth error

Transient GitHub Actions infrastructure flake. Rerun the failed jobs:

```bash
gh run rerun <run-id> --failed
```

This has hit us 3+ times in 2026-05; consistently resolves on rerun.

### j. Want to start over completely

```bash
flow uninstall --scope both --execute --yes --remove-stories --remove-project-ecc
flow init --profile <name> --yes
```

This blows away Flow + Flow's project content + project-scope ECC. Does NOT remove BMad, user-scope ECC, or Caveman — those need their own uninstall commands (printed at the end of `flow uninstall`).

---

## 17. How Caveman enhances Flow

[Caveman](https://github.com/JuliusBrussee/caveman) is an output-compression layer that runs at the Claude Code session level. It rewrites Claude's responses to use dense prose patterns while preserving full technical content. Code, error messages, commits, and security-relevant text stay normal. Filler — pleasantries, hedging, articles, restating the question — gets dropped.

Flow expects Caveman to be active. The token budgets advertised throughout these docs assume Caveman is on. Without it, the realistic numbers are roughly 3–4× higher.

### a. The concrete numbers

- **~46% input token savings** — Caveman compresses your conversation history before sending it to Claude
- **~75% output token savings** — Caveman post-processes Claude's responses on the way out

### b. Why Flow needs it specifically

Flow's per-story phase chain runs many small phases (plan → implement → review → docs → commit → PR). Each phase reads context (story file, code diff, review notes) and generates output. Without compression:

- One `/flow-story` invocation pulls ~30–50k of context per phase
- Chained across phases, a single story costs ~100k input + ~50k output ≈ **~150k tokens**
- A 10-story sprint ≈ **~1.5M tokens**

With Caveman in `full` mode:

- Per-story cost drops to ~30k tokens
- 10-story sprint ≈ **~300k tokens**

Flow's "token-light per-story workflow" tagline only works because Caveman compresses both directions.

### c. What it looks like in practice

Without Caveman, a typical assistant response:

> Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by a race condition in the authentication middleware where the token expiry check uses a strict less-than comparison instead of less-than-or-equal-to.

With Caveman in `full` mode:

> Bug in auth middleware. Token expiry check use `<` not `<=`. Fix:

Same technical content, ~75% fewer tokens. Code blocks render normally — Caveman doesn't touch them.

### d. Modes Flow ships

| Mode | Compression | Use when |
|---|---|---|
| `none` | 0 | Disabled. Only if you have a specific reason. |
| `lite` | ~20% | Most readable. Demo / pairing sessions. |
| `full` | ~75% | **Default for every stock profile.** Recommended baseline. |
| `ultra` | ~85% | Aggressive — occasionally harder to skim. |
| `wenyan-*` | varies | Classical Chinese variants (experimental). |

The chosen mode lives in `flow.config.yaml > upstreams.caveman.subset` (the catalog uses the `caveman_subset` field name for the same setting). Override during install via the interactive Q7b prompt; override per-session via Caveman's own `/caveman <mode>` slash command (if installed).

### e. Project-scope gating — the fork story

Caveman's default install activates it **globally** — every Claude Code session on your machine gets compressed output, including unrelated projects. Most users want Caveman only in Flow-managed projects.

Caveman's `.caveman-enable` / `.caveman-disable` marker files solve this, but the feature is in [JuliusBrussee/caveman#407](https://github.com/JuliusBrussee/caveman/pull/407) — filed 2026-05-19 and still waiting in an upstream queue with ~134 open PRs and ~5 merges/month, so months of wait.

Flow's catalog pins Caveman to a **temporary fork** ([mhd-ghaith-abtah/caveman @ `flow-pin-v0.1`](https://github.com/mhd-ghaith-abtah/caveman/tree/flow-pin-v0.1)) with the patches applied. The bootstrap order in Flow-managed projects:

1. Flow installs Caveman from the fork (transparent — happens during `/flow-init` or `flow init --yes`).
2. Flow's `/flow-init` drops a `.caveman-enable` marker file in the project root.
3. If the user has set `~/.config/caveman/config.json` to `{"defaultMode": "off"}` (allowlist mode), Caveman stays silent everywhere EXCEPT projects with the marker.

You don't have to do anything — Flow's installer handles all of this. The marker file works identically against upstream Caveman and the fork, so when upstream #407 merges, the catalog swap is a no-op at the project level.

### f. How to turn Caveman off in one project

```bash
touch .caveman-disable          # in the project root
```

Restart your Claude Code session. Caveman ignores this project. Remove the file to re-enable.

### g. How to opt OUT entirely on this machine

Caveman's CLI (`caveman` on your $PATH after install):

```bash
caveman off                     # global default off
caveman on                      # global default on
caveman <mode>                  # switch active mode
```

If you want zero Caveman exposure but still want Flow, install with `--caveman-subset none` (interactive Q7b → `none`) and Flow won't invoke the Caveman installer at all. Flow still works — your tokens-per-story figures go up ~3–4×.

### h. Trade-offs Flow accepts

| Pro | Con |
|---|---|
| 3–5× lower token bill for the same outcome | Dense responses can be harder to skim for new users |
| Phase-chain orchestration becomes affordable | Caveman has its own bug surface; `/flow-doctor` probes for known issues |
| Caveman skill bundle is small (~kB-scale) | Adds another dependency the catalog tracks + Flow has to keep current |
| The marker-file gating means Caveman doesn't leak into non-Flow projects | The fork pin is temporary — adds a swap-back step when upstream merges #407 |

### i. Tracking the upstream merge

Flow's catalog comments mark Caveman as a temporary fork explicitly. To check upstream merge status yourself:

```bash
gh pr view 407 --repo JuliusBrussee/caveman --json state,mergedAt
```

When `state` flips to `MERGED`, Flow's next release will swap `catalog.yaml > upstreams.caveman.installer.cmd` back to the upstream npx command and remove the SWAP PLAN comment block.

---

## See also

- [Quickstart](quickstart.md) — 10-minute first-install path
- [Profiles](profiles.md) — per-profile details and ECC scope mechanics
- [Adapters](adapters.md) — adapter contract and how to add new ones
- [BMad migration](migrate-from-bmad.md) — specifics on the BMad → Flow state migration
- [ROADMAP](../ROADMAP.md) — the multi-epic arc + guiding principles
- [CHANGELOG](../CHANGELOG.md) — what shipped when
