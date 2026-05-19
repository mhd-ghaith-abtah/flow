# Quickstart

A 10-minute path from zero to first shipped story.

## Prerequisites

- [Claude Code](https://claude.com/claude-code) installed (`claude` on PATH)
- Node 20+ (for the `flow` CLI; not strictly required if you only use slash commands)
- Git repo, with `origin` set if you want PRs

## Install

Inside Claude Code, in your project root:

```
/flow-init
```

This launches an interactive installer. It will:

1. **Detect project shape** — package manager, framework, existing BMad/ECC install, CLAUDE.md presence
2. **Ask ~8 questions** — profile (mini/standard/team), adapters (issue tracker, PR platform, E2E, verify), upstream subsets (BMad, ECC, Caveman)
3. **Delegate to upstream installers** — `npx bmad-method install --modules <curated>`, `ECC ./install.sh --profile <curated>`, plus Caveman
4. **Set up MCP servers** — context7, playwright, linear (if selected)
5. **Scaffold docs/flow/ + flow.config.yaml** — sprint.yaml, stories/, journeys/, retros/, deferred.md
6. **Optionally migrate** an existing BMad `sprint-status.yaml`

Re-running is idempotent — `/flow-init --update` will diff against the recorded state and apply only deltas.

## First story

```
/flow-sprint add "Wire up Stripe webhook handler" --epic E1 --tags payments,auth
/flow-sprint next
/flow-story
```

`/flow-story` auto-detects the current phase (plan / implement / review / verify / e2e / docs / commit / pr) from `sprint.yaml` + git branch + commit state, and invokes the right ECC primitive at each step. It chains phases automatically until it hits a destructive boundary (commit, PR) or a CRITICAL/HIGH review finding, then pauses for your CONFIRM.

**Useful flags:**

| Flag | Effect |
|---|---|
| `--auto` | No CONFIRM gates. Use for low-risk stories. |
| `--auto-merge` | After PR opens, poll `gh pr merge --auto` until CI passes (15-min cap). |
| `--hard-review` | Force adversarial + edge-case reviewers regardless of tags. |
| `--no-review` | Skip code review. Risky. Use for trivial config tweaks. |
| `--no-verify` | Skip the verify command. Risky. |
| `--no-e2e` | Skip the E2E adapter. |
| `--strict-plan` | Block on plan CONFIRM even with `--auto`. |
| `--skip-plan` | Treat the story as pre-planned. |
| `--advise-only` | Print phase + suggested next action; don't execute. |

## Closing out a story

After a PR merges, `/flow-story` auto-detects the `merge-done` phase and asks for CONFIRM to flip the story to `done`. Or you can do it manually:

```
/flow-sprint done E1-001
```

## End-of-sprint

```
/flow-sprint retro
```

Generates `docs/flow/retros/<date>.md` from your last sprint's stories: what shipped, what got deferred, review-finding rollup, verify failure rate.

## Health check

```
/flow-doctor
```

Verifies catalog / state / adapter files / MCP registration / required CLIs / upstream installations. Probes for known bugs (caveman-shrink mis-registered, severity-label stripping, loose marker matches). Add `--fix` for safe auto-repairs (prints the commands; doesn't auto-run anything destructive).

## Next

- [profiles.md](profiles.md) — choosing mini vs standard vs team
- [adapters.md](adapters.md) — picking + swapping integrations
- [migrate-from-bmad.md](migrate-from-bmad.md) — porting an existing BMad project
