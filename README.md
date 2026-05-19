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

> **Status (v0.6.1):** the `npx` path is not yet published. Use the Claude Code slash-command path below. Tracking [issue #1](https://github.com/mhd-ghaith-abtah/flow/issues) — `npx @mhd-ghaith-abtah/flow init` lands in v0.7.

```bash
# Inside Claude Code (current — works today)
/flow-init

# Coming in v0.7 — works in any terminal
# npx @mhd-ghaith-abtah/flow init
```

The slash-command path runs the same interactive installer. It detects your project shape, asks ~8 questions, then:
- Installs Flow's three skills (`flow-init`, `flow-sprint`, `flow-story`)
- Optionally invokes `npx bmad-method install` with a curated module list
- Optionally invokes ECC's `install.sh` with a curated profile
- Sets up MCP servers needed by your selected adapters (`context7`, `playwright`, `linear`, …)
- Writes `flow.config.yaml` + scaffolds `docs/flow/`
- Optionally migrates an existing BMad `sprint-status.yaml`

## Quickstart

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
| `team` | Multi-repo, issue tracker, sibling PRs | ~60k |

All three are mode flags on the same skills, not different code paths.

## Adapters

Pick one per category in `flow.config.yaml`:

| Category | v0.1 adapters |
|---|---|
| Issue tracker | `linear`, `github-issues`, `none` |
| PR platform | `github`, `none` |
| E2E | `playwright-mcp`, `none` |
| Verify | `make`, `pnpm`, `custom` |

More coming in v0.2: `jira`, `notion`, `plain`, `gitlab`, `bitbucket`, `cypress`, `slack`, `discord`.

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

**Which profile should I pick?**
- `mini` — solo, single repo, light review, no formal PR process → ~20k/story
- `standard` — solo or small team, formal review, GitHub PRs, Playwright E2E → ~40k/story
- `team` — multi-repo, issue tracker (Linear default), sibling PRs, multi-LLM review → ~60k/story

You can swap profiles with `/flow-init --update --profile <name>` — it's just a different bundle, not a different codepath.

**What if I don't use GitHub?**
Pick `adapter:pr-none` during `/flow-init` and configure `verify` + `e2e` to whatever you do use. GitLab + Bitbucket adapters are planned for v0.2.

**How do I upgrade Flow?**
`/flow-init --update` is idempotent. It re-detects project shape, diffs against `install-state.json`, and applies only the deltas. Upstream installers (BMad / ECC / Caveman) are re-invoked only when their pinned subset changes.

**What happens if I uninstall?**
`/flow uninstall` removes Flow's own skills and adapters. It does NOT remove BMad, ECC, or Caveman — those were installed by their own installers and Flow recorded that, not owned it. Your `sprint.yaml` + stories stay on disk.

**Is my `flow.config.yaml` safe to commit?**
Yes — it's intentionally team-shared (adapter choices, review policy, verify command). Secrets live in `~/.claude/.env.flow` (chmod 600, never committed). Per-developer overrides go in `flow.config.local.yaml` (gitignored) which Flow merges over the base config.

**Where do I report bugs?**
[github.com/mhd-ghaith-abtah/flow/issues](https://github.com/mhd-ghaith-abtah/flow/issues). Run `/flow-doctor` first — it surfaces known-bug patterns automatically.

## Credits

Flow stands on:
- **[BMad-Method](https://github.com/bmad-code-org/BMAD-METHOD)** by bmad-code-org — planning workflow (PRD, architecture, epics)
- **[Everything Claude Code (ECC)](https://github.com/affaan-m/everything-claude-code)** by affaan-m — per-story primitives (`/plan`, `/prp-*`, `/code-review`, `/update-docs`)
- **[Get Shit Done (GSD)](https://github.com/gsd-build/get-shit-done)** by TÂCHES — concept inspiration
- **[spec-kit](https://github.com/github/spec-kit)** by GitHub — spec-driven development pattern
- **[AI Dev Tasks](https://github.com/snarktank/ai-dev-tasks)** by snarktank — lean PRD + tasks pattern

## License

MIT
