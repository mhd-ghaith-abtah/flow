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

```bash
# Recommended — works in any terminal
npx @mhd-ghaith-abtah/flow-init

# Inside Claude Code
/flow-init
```

Either route runs the same interactive installer. It detects your project shape, asks ~8 questions, then:
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

## Credits

Flow stands on:
- **[BMad-Method](https://github.com/bmad-code-org/BMAD-METHOD)** by bmad-code-org — planning workflow (PRD, architecture, epics)
- **[Everything Claude Code (ECC)](https://github.com/affaan-m/everything-claude-code)** by affaan-m — per-story primitives (`/plan`, `/prp-*`, `/code-review`, `/update-docs`)
- **[Get Shit Done (GSD)](https://github.com/gsd-build/get-shit-done)** by TÂCHES — concept inspiration
- **[spec-kit](https://github.com/github/spec-kit)** by GitHub — spec-driven development pattern
- **[AI Dev Tasks](https://github.com/snarktank/ai-dev-tasks)** by snarktank — lean PRD + tasks pattern

## License

MIT
