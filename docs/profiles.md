# Profiles

Profiles are named bundles that pick the right adapters + upstream subsets + MCPs for your situation. All three are mode flags on the same skills — there is no different codepath per profile.

## At a glance

| Profile | Best for | Tokens/story | Review | E2E | PR | Issue tracker | ECC scope |
|---|---|---:|---|---|---|---|---|
| `mini` | Solo, one repo, light review | ~20k | `code-review` only | none | GitHub | GitHub Issues | user |
| `standard` | Solo/small team, formal review | ~40k | `code-review` + language reviewer + security on risk tags | Playwright MCP | GitHub | GitHub Issues | user |
| `team` | Multi-repo, multi-LLM review | ~60k | + adversarial + edge-case + separate-model reviewer | Playwright MCP | GitHub (sibling PRs) | Linear | **project** |
| `minimal` | Bare Flow, no upstreams | <10k | none | none | none | none | user |

## What each profile changes

### `minimal`

- **Adapters:** `issue-tracker-none`, `pr-none`, `e2e-none`, `verify-custom`
- **MCPs:** none
- **BMad subset:** `none`
- **ECC subset:** `none`
- **ECC install scope:** `user` (inherits the catalog default — no scope-relevant ECC content is installed at `none` anyway)
- **Caveman:** `full`

Just `sprint.yaml` + story files. No upstream integration. Useful when you want Flow's state model without any of the per-story machinery.

### `mini`

Extends `minimal`. Adds:

- **Adapters:** `issue-tracker-github-issues`, `pr-github`, `verify-make`
- **MCPs:** `context7`
- **ECC subset:** `flow-essentials` (just `/plan`, `/prp-implement`, `/code-review`, `/update-docs`)
- **ECC install scope:** `user` (lands under `~/.claude/{rules,skills}/ecc` — shared across all your projects)

What you get: full per-story orchestration through `/flow-story` with the lightest possible review. No E2E, no language-specific reviewers, no adversarial reviewers.

### `standard`

Extends `mini`. Adds:

- **Adapters:** `e2e-playwright-mcp`
- **MCPs:** + `playwright`
- **BMad subset:** `planning-only` (PRD, architecture, epic generation; no per-story BMad re-reads)
- **ECC subset:** `flow-essentials-plus-tdd` (adds `/tdd` and TDD harness)
- **ECC install scope:** `user` (inherited from `mini` — same `~/.claude/{rules,skills}/ecc` mount)

What you get: full orchestration + E2E coverage for tagged stories + BMad planning artifacts on demand.

### `team`

Extends `standard`. Adds:

- **Adapters:** overrides `issue-tracker-github-issues` → `issue-tracker-linear`
- **MCPs:** + `linear`
- **BMad subset:** `full`
- **ECC install scope:** `project` (lands under `<projectRoot>/.claude/{rules,skills}/ecc` so each Flow-managed repo keeps its own ECC selection; nothing bleeds into the developer's global `~/.claude/`)
- **Review:** `use_separate_model: true` — spawns one reviewer with a different model (e.g., Sonnet alongside Opus) for cross-model perspective on tagged-risky stories

What you get: full orchestration + Linear-driven sprint sync + cross-model code review on high-risk stories.

> **What you don't get (despite earlier docs promising it):** multi-repo coordinated sibling PRs and per-adapter-call audit logs. Those were aspirational features in the team-profile description through v0.7.0 with zero implementation behind them. Stripped on 2026-05-19 (sprint story E5-007). Read-only multi-repo awareness (story-id touches N repos → aggregate PR status) is tracked as a deferred backlog item; surface a real use case and we'll design it properly.

## ECC install scope

Where ECC's rules + skills land on disk. Two values:

| Scope | Install root | Use case |
|---|---|---|
| `user` | `~/.claude/rules/ecc` + `~/.claude/skills/ecc` | Solo dev or single primary project — ECC is shared across every Claude Code session on the machine |
| `project` | `<projectRoot>/.claude/rules/ecc` + `<projectRoot>/.claude/skills/ecc` | Multi-project, polyglot, or team setups — each Flow-managed repo keeps its own ECC selection without bleeding into `~/.claude/` |

Resolved scope per layer (later wins):

1. **Catalog default** — `upstreams.ecc.install_scope_default: user` in `catalog.yaml`. Fallback when nothing else applies.
2. **Profile** — each profile's `ecc_install_scope` field. `team` is the only stock profile that overrides to `project`; the rest inherit `user`.
3. **CLI flag** — `--ecc-scope <user|project>` on `flow plan` and `flow install`. Highest priority. Typos like `--ecc-scope=projet` fail loud.

```
flow plan --profile team                  # team default → project
flow plan --profile team --ecc-scope user # explicit override → user
flow plan --profile mini --ecc-scope project # explicit override → project
```

Under the hood, the scope picks the ECC installer's `--target` flag: `user` → `--target claude`, `project` → `--target claude-project`. The `claude-project` target merged into ECC via [affaan-m/ECC#2006](https://github.com/affaan-m/ECC/pull/2006) on 2026-05-19; Flow's catalog pins to that commit (`npx -y -p "github:affaan-m/ECC#98bd5174" ecc-install`) until ECC publishes `ecc-universal@2.x` to npm (current latest is `1.10.0`, which predates the merge).

`/flow-doctor --repair-upstream ecc` reads the recorded scope from `install-state.json` and emits the right rules-dir + `--target` arg in its repair instructions — no manual translation needed.

## Swapping profiles

```
/flow-init --update --profile <name>
```

The installer diffs your current state against the new profile and applies only the deltas: removes obsolete adapter files, installs new ones, updates `flow.config.yaml`, re-registers MCPs.

## Custom adjustments

You don't have to pick a stock profile. Use `--with` / `--without` to layer on top:

```
flow init --profile mini --with adapter:e2e-playwright-mcp --yes
flow plan --profile team --without adapter:issue-tracker-linear --json
```

`flow plan` prints the resolved bundle without executing — useful for previewing what `/flow-init` will install.

## Inheritance

Profiles inherit via the `extends:` key in `catalog.yaml`. The merge rule for adapters is **family override** — `team` says `adapter:issue-tracker-linear`, and that replaces `mini`'s `adapter:issue-tracker-github-issues` because both belong to the `issue-tracker` family. Other lists (MCPs, components) union.
