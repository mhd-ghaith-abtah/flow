# Quickstart

A 10-minute path from zero to first shipped story.

## Prerequisites

- [Claude Code](https://claude.com/claude-code) installed (`claude` on PATH) — only required if you want the `/flow-*` slash commands. The headless CLI works without it.
- Node 20+
- Git repo, with `origin` set if you want PRs

## Install

```bash
# 1. Install the Node CLI (once per machine)
npm install -g @mhd-ghaith-abtah/flow@beta
flow --version                                # → 0.8.0-beta.2 (or newer)

# 2. Per project — symlink the 4 skills into THIS project's .claude/skills/
cd /path/to/your/project
flow install-skills --scope project --force   # ← recommended for slash commands

# 3. Pick a path:
flow init --profile mini --yes                # headless (no Claude Code needed)
# OR, inside Claude Code opened in this project:
/flow-init                                    # interactive Q&A
```

`flow install-skills --scope project` is the bridge — npm puts Flow in `/opt/homebrew/lib/node_modules/...` but Claude Code only resolves slash commands from a scanned path (`~/.claude/skills/` for home scope, `<project>/.claude/skills/` for project scope). Per-project scope is the recommended default because:

- Symlinks point at a stable path that survives until you `npm uninstall`
- Slash commands only appear inside this project, not in every unrelated Claude Code session

Re-run `flow install-skills --scope project --force` after every Flow upgrade (`npm install -g @mhd-ghaith-abtah/flow@beta`) to refresh the symlinks. It's idempotent.

If you'd rather have `/flow-*` available globally on your machine instead of per-project, omit the `--scope` flag — `flow install-skills` defaults to `home` scope (`~/.claude/skills/`). See [usage.md §1](usage.md#1-installation-paths) for the full breakdown.

## What the installer does

Either path (slash or headless `--yes`) walks the same chain:

1. **Detect project shape** — package manager, framework, existing BMad/ECC install, CLAUDE.md presence
2. **Ask ~9 questions** (interactive only — `--yes` pre-fills from profile defaults):
   - Q1 profile · Q2–Q5 adapters (issue tracker, PR, E2E, verify) · Q6 BMad subset · Q7 ECC subset · Q7c ECC install scope (user/project) · Q7b Caveman mode · Q8 BMad migration (if detected) · Q9 secrets store
3. **Delegate to upstream installers** — `npx bmad-method install --modules <curated>`, `npx -y -p "github:affaan-m/ECC#<commit>" ecc-install --target <user|project>`, Caveman from a Flow-maintained fork pinned at `flow-pin-v0.1` (see [usage.md §6](usage.md#6-ecc-install-scope) for the fork-pin story)
4. **Register MCPs** — context7, playwright, linear, etc. (per profile)
5. **Scaffold `docs/flow/` + `flow.config.yaml` + `install-state.json`**
6. **Optionally migrate** an existing BMad `sprint-status.yaml`

Re-running is idempotent. To re-resolve against an existing install, see [`flow init --update`](usage.md#8-updating-an-existing-install). To restore deleted scaffold files, see [`flow init --repair`](usage.md#9-repairing-a-broken-install).

## First story

```
/flow-sprint add "Wire up Stripe webhook handler" --epic E1 --tags payments,auth
/flow-sprint next
/flow-story
```

`/flow-story` auto-detects the current phase (plan / implement / review / verify / e2e / docs / commit / pr) from `sprint.yaml` + git branch + commit state, and invokes the right ECC primitive at each step. It chains phases automatically until it hits a destructive boundary (commit, PR) or a CRITICAL/HIGH review finding, then pauses for your CONFIRM.

**Useful `/flow-story` flags:**

| Flag | Effect |
|---|---|
| `--auto` | No CONFIRM gates. Use for low-risk stories. |
| `--auto-merge` | After PR opens, poll `gh pr merge --auto` until CI passes (90-second wait cap per attempt; longer CI ends the turn + handoff). |
| `--hard-review` | Force adversarial + edge-case reviewers regardless of tags. |
| `--no-review` | Skip code review. Risky. Use for trivial config tweaks. |
| `--no-verify` | Skip the verify command. Risky. |
| `--no-e2e` | Skip the E2E adapter. |
| `--strict-plan` | Block on plan CONFIRM even with `--auto`. |
| `--skip-plan` | Treat the story as pre-planned. |
| `--advise-only` | Print phase + suggested next action; don't execute. |

## Closing out a story

After a PR merges, `/flow-story` auto-detects the `merge-done` phase and asks for CONFIRM to flip the story to `done`. Or do it manually:

```bash
# Inside Claude Code:
/flow-sprint done E1-001

# Or headless:
flow sprint done E1-001 --note "Merged via auto-merge"
```

## End-of-sprint

```
/flow-sprint retro E1
```

Generates `docs/flow/retros/E1-retro.md` (one file per epic, not per date) from the epic's archived story files: shipped count, cycle time, deferred carry-forward, plus blank "What worked / What didn't / Carry into next epic" sections for you to edit.

## Health check

```bash
# Inside Claude Code:
/flow-doctor

# Headless:
flow doctor
flow doctor --json
flow doctor --verbose
```

Verifies catalog / state / adapter files / MCP registration / required CLIs / upstream installations. Surfaces an ECC scope-collision section when both user-scope and project-scope ECC content exist.

To get repair commands for a specific upstream (BMad / ECC / Caveman pin drift):

```bash
flow doctor --repair-upstream ecc          # prints the reinstall command
flow doctor --repair-upstream bmad
flow doctor --repair-upstream caveman
```

The `--repair-upstream` path prints commands but does NOT auto-run them — upstream installs touch user-scope state, so the user runs them deliberately.

## Where to go next

| Goal | Link |
|---|---|
| Comprehensive how-to (every flag, every scenario) | [usage.md](usage.md) |
| Choosing a profile (mini vs standard vs team) | [profiles.md](profiles.md) |
| Picking + swapping integrations | [adapters.md](adapters.md) |
| Porting an existing BMad project | [migrate-from-bmad.md](migrate-from-bmad.md) |
| Starting from zero with planning (PRD → architecture → stories) | [usage.md §2c](usage.md#2c-starting-from-zero-greenfield--bmad-planning) |
