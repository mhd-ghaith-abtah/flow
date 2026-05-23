# Flow

> Token-light per-story workflow for Claude Code. Delegates to BMad + ECC + Caveman instead of duplicating them.

Flow is a thin orchestration layer. It owns three things:
- Per-story state (`sprint.yaml` + tiny story files)
- Pluggable adapters (issue tracker, PR platform, E2E, verify)
- An installer that **invokes BMad, ECC, and Caveman's own installers** so you choose exactly which upstream pieces land in your project

Everything else is delegated:
- `/plan`, `/prp-implement`, `/code-review`, `/update-docs` etc. come from [ECC](https://github.com/affaan-m/everything-claude-code)
- PRD + architecture + epics + retros come from [BMad](https://github.com/bmad-code-org/BMAD-METHOD) when you want them
- Response-token compression comes from [Caveman](https://github.com/JuliusBrussee/caveman) (default `full` mode, ~46% input / ~75% output savings, auto-installed by `/flow-init`)

Flow stitches them together.

## Why

Existing per-story workflows are token-heavy. BMad's create-story re-reads epics + architecture + UX + previous story + git log every iteration. GSD spawns parallel 200k-context subagents. spec-kit ships 8 artifact files per feature. A ~30-line story stub plus delegation to ECC's existing primitives lands at **~20k tokens per story in mini mode** vs **~95k in BMad full**.

## Install

> **Status (v0.7.2-beta.0, published 2026-05-19):** Flow is live on npm as a **beta channel**. Stable `latest` will be promoted from beta after a soak period. Expect minor breaking changes between beta releases until then.

```bash
# Inside Claude Code (recommended for first install — interactive)
/flow-init

# Headless install via npm — beta channel (no Claude Code required)
npm install -g @mhd-ghaith-abtah/flow@beta
flow init --profile standard --yes              # chains detect → upstreams → MCPs → scaffold
flow plan --profile standard                    # preview without executing
flow doctor                                     # health check

# One-shot via npx — no install
npx -y @mhd-ghaith-abtah/flow@beta init --profile mini --yes

# Or from a clone (development / contributing)
git clone https://github.com/mhd-ghaith-abtah/flow.git
cd flow && npm install && tools/dev-link.sh
flow plan --profile standard
```

Two paths, same end state. `/flow-init` is interactive — Claude Code drives the Q&A, error recovery, and multi-step ceremony. `flow init --yes` is headless — pre-populates every answer from the profile defaults so it runs end-to-end without prompts (override individual knobs via `--ecc-scope`, `--bmad-subset`, `--ecc-subset`). Both invoke the same upstream installers and scaffold the same files.

The installer detects your project shape, then:
- Installs Flow's four skills (`flow-init`, `flow-sprint`, `flow-story`, `flow-doctor`)
- Optionally invokes `npx bmad-method install` with a curated module list
- Optionally invokes ECC's `install.sh` with a curated profile
- Optionally invokes Caveman's installer (curl-pipe-bash, with SHA-256 inspection support via `FLOW_INSPECT_INSTALL_SCRIPTS=1`)
- Sets up MCP servers needed by your selected adapters (`context7`, `playwright`, `linear`, …)
- Writes `flow.config.yaml` + scaffolds `docs/flow/`
- Drops a `.caveman-enable` marker so Caveman activates here even if the user's global default is `off` (see Caveman FAQ entry below)
- Optionally migrates an existing BMad `sprint-status.yaml` (with backup + rollback)

## Quickstart

> **Want every option in one place?** See the long-form [Usage Guide](docs/usage.md) — installation paths, daily workflow, sprint commands, profiles, ECC scope, maintenance, uninstall, full CLI reference, common scenarios (recipe book), and troubleshooting. The block below is the 30-second version.

```bash
$ /flow-init                                              # one time per project
$ /flow-sprint add "First story" --epic E1 --tags ui      # add a story
$ /flow-sprint next                                       # start work
$ /flow-story                                             # implement → review → verify → commit → PR
$ /flow-sprint done E1-001                                # close out
```

## Profiles

| Profile | When | Tokens/story |
|---|---|---|
| `mini` | Solo, single repo, light review | ~20k |
| `standard` | Solo or small team, formal review, PRs | ~40k |
| `team` | Small team, Linear sprints, separate-model review | ~60k |

All three are mode flags on the same skills, not different code paths.

## Adapters

Pick one per category in `flow.config.yaml`:

| Category | Available |
|---|---|
| Issue tracker | `linear`, `github-issues`, `none` |
| PR platform | `github`, `none` |
| E2E | `playwright-mcp`, `none` |
| Verify | `make`, `pnpm`, `custom` |

Additional adapters (Jira, Notion, Plain, GitLab, Bitbucket, Cypress, Slack, Discord, etc.) land when a real user surfaces a concrete use case — see Flow's [validate-demand-before-building principle](ROADMAP.md#guiding-principles). The adapter contract in `adapters/<family>/<name>/_interface.md` is small (one YAML manifest + a handful of skill workflows) so PRs are welcome.

## Architecture

```
flow install
├── Phase A: detect (BMad? ECC? which MCPs? which CLIs?)
├── Phase B: install Flow's own skills + adapters + templates
├── Phase C: delegate to upstream installers
│   ├── npx bmad-method install --modules <curated subset>
│   └── ECC ./install.sh --profile <curated subset>
├── Phase D: install MCP servers (context7, playwright, linear, …)
├── Phase E: scaffold flow.config.yaml + docs/flow/
└── Phase F: smoke test (flow doctor)
```

Flow does not re-implement BMad or ECC. It calls them with the right flags and records what it did in `~/.claude/flow/install-state.json`.

## When to use which command

After `/flow-init` you'll have slash commands from all three projects active. Use this table when you're not sure which to invoke:

| Goal | Command | Owner |
|---|---|---|
| Write a PRD, architecture doc, or epic list | `/bmad-create-prd`, `/bmad-create-architecture`, `/bmad-create-epic` | BMad |
| Generate a fresh story from a BMad epic | `/bmad-create-story` (then `/flow-sprint import-bmad`) | BMad → Flow |
| Add a story to the current sprint | `/flow-sprint add "<title>" --epic E1` | Flow |
| Pick the next story to work on | `/flow-sprint next` | Flow |
| **Implement → review → verify → commit → PR** | `/flow-story` | Flow (orchestrates ECC) |
| Just write code with a plan gate | `/plan` then `/prp-implement` | ECC |
| Just run a code review | `/code-review` | ECC |
| Just run the documentation updater | `/update-docs` | ECC |
| Health-check the whole install | `/flow-doctor` | Flow |
| End-of-sprint retro | `/flow-sprint retro` | Flow |

**Rule of thumb:** if you're moving a story through its lifecycle (plan → code → review → ship), use `/flow-story` — it dispatches to the right ECC primitive at the right phase. If you want to invoke an ECC primitive directly (e.g., to re-review uncommitted code without advancing the story), call it by name; Flow won't get in the way.

**Don't mix:** `/bmad-create-story` and `/flow-sprint add` both create story files. Pick one per project — Flow's import-bmad subcommand bridges the two if you start with BMad and want Flow to take over.

## FAQ

**Why not just use BMad on its own?**
BMad re-reads epics + architecture + UX + previous story + git log every iteration. That lands at ~95k tokens per story in full mode. Flow keeps the planning artifacts but skips the re-reads on every cycle — a story stub plus delegation to ECC's `/prp-implement` lands at ~20k in mini mode.

**Why not just use ECC?**
ECC owns the per-story primitives (`/plan`, `/prp-implement`, `/code-review`, `/update-docs`). What it doesn't own is the *between-stories* state: which story is next, which is in review, which is deferred, which adapter handles PRs in this repo. Flow's `sprint.yaml` + `flow-story` skill is that thin layer.

**Do I need Caveman?**
Yes for now — Flow expects it. Caveman compresses Claude's responses ~75% in `full` mode, which is what makes mini-profile's 20k-tokens-per-story claim realistic. `/flow-init` installs it automatically with the right registration (see `tools/fix-caveman-shrink.sh` if the MCP proxy gets mis-registered).

**Caveman is now active in every Claude Code session, even my non-Flow projects. Can I scope it?**
Yes, in Flow-managed projects this works out of the box. Flow installs Caveman from a **temporary fork** ([mhd-ghaith-abtah/caveman @ `flow-pin-v0.1`](https://github.com/mhd-ghaith-abtah/caveman/tree/flow-pin-v0.1)) that carries the project-scope gating patches from [JuliusBrussee/caveman#407](https://github.com/JuliusBrussee/caveman/pull/407) on top of upstream `main`. The fork exists because upstream Caveman has a ~134-PR review backlog with ~5 merges/month — waiting for #407 to merge would block Flow for months. **When #407 merges upstream, Flow swaps the catalog back to `JuliusBrussee/caveman` and deletes the fork.** The `.caveman-enable` marker Flow drops in your project root works identically against upstream and the fork, so the swap is a no-op at the project level. To opt into project-scope gating in non-Flow projects today, you can either install Caveman from the same fork tag or set `~/.config/caveman/config.json` to `{"defaultMode": "off"}` and rely on the markers globally. `/flow-doctor` surfaces a probe for "Caveman fork in use — track upstream PR #407" so you know when to expect the swap.

**Can I install ECC per-project instead of into `~/.claude/`?**
Yes — the `claude-project` install target merged into ECC's `main` via [affaan-m/ECC#2006](https://github.com/affaan-m/ECC/pull/2006) on 2026-05-19 (filed and merged same-day by Flow's maintainer). Pass `--target claude-project` and ECC lands under `<projectRoot>/.claude/rules/ecc` + `<projectRoot>/.claude/skills/ecc` instead of `~/.claude/`. Symmetric with `--target claude` (home-scope) — same namespacing, same locale handling, no breaking change. **Profile defaults (shipped 2026-05-20):** `team` defaults to project-scope; `mini`/`standard`/`minimal` default to user-scope. Override via `flow plan --profile <name> --ecc-scope <user|project>` or `flow install --profile <name> --ecc-scope <user|project>` — typos like `--ecc-scope=projet` fail loud instead of silently falling through to the profile default. **Distribution caveat:** the current ECC npm `latest` is `ecc-universal@1.10.0` (2026-04-15), which predates the merge by ~36 days, so `npx ecc-universal` will NOT have the target yet. Flow's catalog pins to the post-merge commit via `npx -y -p "github:affaan-m/ECC#98bd5174" ecc-install` until affaan-m cuts the next ECC release (`2.0.0`) — at which point we swap back to the npm package. Useful for monorepos, polyglot workspaces, or teams that want ECC scoped per-repo without contaminating the developer's global Claude Code config.

**Which profile should I pick?**
- `mini` — solo, single repo, light review, no formal PR process → ~20k/story
- `standard` — solo or small team, formal review, GitHub PRs, Playwright E2E → ~40k/story
- `team` — small team, issue tracker (Linear default), separate-model code review (spawns one reviewer with a different model for fresh perspective) → ~60k/story

You can swap profiles with `/flow-init --update --profile <name>` — it's just a different bundle, not a different codepath.

**What if I don't use GitHub?**
Pick `adapter:pr-none` during `/flow-init` and configure `verify` + `e2e` to whatever you do use. GitLab and Bitbucket PR adapters are unscheduled — the adapter contract is small enough to ship one in a weekend, and PRs are welcome (see `adapters/pr/<name>/_interface.md`).

**How do I upgrade Flow?**
`/flow-init --update` is idempotent. It re-detects project shape, diffs against `install-state.json`, and applies only the deltas. Upstream installers (BMad / ECC / Caveman) are re-invoked only when their pinned subset changes.

**What happens if I uninstall?**
`/flow uninstall` removes Flow's own skills and adapters. It does NOT remove BMad, ECC, or Caveman — those were installed by their own installers and Flow recorded that, not owned it. Your `sprint.yaml` + stories stay on disk.

**Is my `flow.config.yaml` safe to commit?**
Yes — it's intentionally team-shared (adapter choices, review policy, verify command). Secrets live in `~/.claude/.env.flow` (chmod 600, never committed). Per-developer overrides go in `flow.config.local.yaml` (gitignored) which Flow merges over the base config.

**Where do I report bugs?**
[github.com/mhd-ghaith-abtah/flow/issues](https://github.com/mhd-ghaith-abtah/flow/issues). Run `/flow-doctor` first — it surfaces known-bug patterns automatically.

**What's the roadmap?**
See [ROADMAP.md](ROADMAP.md). v0.7.x is stabilization, v0.8 is npx-first install + ECC project-scope, v0.9 is multi-agent (Codex / Cline / Cursor / 30+ others). Explicit out-of-scope list there too.

## Credits

Flow stands on:
- **[BMad-Method](https://github.com/bmad-code-org/BMAD-METHOD)** by bmad-code-org — planning workflow (PRD, architecture, epics)
- **[Everything Claude Code (ECC)](https://github.com/affaan-m/everything-claude-code)** by affaan-m — per-story primitives (`/plan`, `/prp-*`, `/code-review`, `/update-docs`)
- **[Get Shit Done (GSD)](https://github.com/gsd-build/get-shit-done)** by TÂCHES — concept inspiration
- **[spec-kit](https://github.com/github/spec-kit)** by GitHub — spec-driven development pattern
- **[AI Dev Tasks](https://github.com/snarktank/ai-dev-tasks)** by snarktank — lean PRD + tasks pattern

### Upstream strategy

Flow's preference is to send features upstream rather than fork. When upstream is responsive, we contribute. When upstream is bandwidth-constrained, we maintain a **transparent temporary fork with an explicit deprecation plan**.

Active and historical contributions:

- **[affaan-m/ECC#2006](https://github.com/affaan-m/ECC/pull/2006)** — `claude-project` install target (project-scope ECC). **Merged 2026-05-19.** Closes the install-target matrix for Claude Code and removes the need for `HOME=$PROJECT/...` shims. Same-day review and merge by maintainer.
- **[JuliusBrussee/caveman#407](https://github.com/JuliusBrussee/caveman/pull/407)** — project-scope gating via marker files, env var, and allow/deny lists. *Filed 2026-05-19. Sitting in a ~134-PR backlog at ~5 merges/month, so Flow ships a **temporary fork** ([mhd-ghaith-abtah/caveman @ `flow-pin-v0.1`](https://github.com/mhd-ghaith-abtah/caveman/tree/flow-pin-v0.1)) with the patches applied. Catalog will swap back to upstream the day #407 merges.*

This is the rule: **compose over reinvention, contribute when accepted, fork transparently with a swap-back plan when contribution is blocked.** Forks are documented in `catalog.yaml` with `upstream_repo` + `upstream_pr` + `fork_status` fields so the deprecation path is auditable.

## License

MIT
