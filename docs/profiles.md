# Profiles

Profiles are named bundles that pick the right adapters + upstream subsets + MCPs for your situation. All three are mode flags on the same skills — there is no different codepath per profile.

## At a glance

| Profile | Best for | Tokens/story | Review | E2E | PR | Issue tracker |
|---|---|---:|---|---|---|---|
| `mini` | Solo, one repo, light review | ~20k | `code-review` only | none | GitHub | GitHub Issues |
| `standard` | Solo/small team, formal review | ~40k | `code-review` + language reviewer + security on risk tags | Playwright MCP | GitHub | GitHub Issues |
| `team` | Multi-repo, multi-LLM review | ~60k | + adversarial + edge-case + separate-model reviewer | Playwright MCP | GitHub (sibling PRs) | Linear |
| `minimal` | Bare Flow, no upstreams | <10k | none | none | none | none |

## What each profile changes

### `minimal`

- **Adapters:** `issue-tracker-none`, `pr-none`, `e2e-none`, `verify-custom`
- **MCPs:** none
- **BMad subset:** `none`
- **ECC subset:** `none`
- **Caveman:** `full`

Just `sprint.yaml` + story files. No upstream integration. Useful when you want Flow's state model without any of the per-story machinery.

### `mini`

Extends `minimal`. Adds:

- **Adapters:** `issue-tracker-github-issues`, `pr-github`, `verify-make`
- **MCPs:** `context7`
- **ECC subset:** `flow-essentials` (just `/plan`, `/prp-implement`, `/code-review`, `/update-docs`)

What you get: full per-story orchestration through `/flow-story` with the lightest possible review. No E2E, no language-specific reviewers, no adversarial reviewers.

### `standard`

Extends `mini`. Adds:

- **Adapters:** `e2e-playwright-mcp`
- **MCPs:** + `playwright`
- **BMad subset:** `planning-only` (PRD, architecture, epic generation; no per-story BMad re-reads)
- **ECC subset:** `flow-essentials-plus-tdd` (adds `/tdd` and TDD harness)

What you get: full orchestration + E2E coverage for tagged stories + BMad planning artifacts on demand.

### `team`

Extends `standard`. Adds:

- **Adapters:** overrides `issue-tracker-github-issues` → `issue-tracker-linear`
- **MCPs:** + `linear`
- **BMad subset:** `full`
- **Features:** `multi_repo: true`, `multi_llm_review: true`, `audit_log: true`

What you get: Linear-driven sprint sync, sibling PRs across multiple repos for cross-cutting stories, multi-LLM adversarial review (spawn one reviewer with a different model for fresh perspective), audit log of every adapter call.

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
