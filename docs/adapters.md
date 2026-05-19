# Adapters

Flow's per-category adapter system lets you swap integrations without changing any skill code. There are four adapter families today; additional adapters and families land when there's a concrete use case (see Flow's [validate-demand-before-building principle](../ROADMAP.md#guiding-principles)).

## Families + available picks

| Family | Picks | What it does |
|---|---|---|
| `issue-tracker` | `linear`, `github-issues`, `none` | External issue mirror — create, transition, close issues from `/flow-story` |
| `pr` | `github`, `none` | Pull-request platform — open + monitor + auto-merge PRs |
| `e2e` | `playwright-mcp`, `none` | End-to-end test driver — run journeys, capture artifacts |
| `verify` | `make`, `pnpm`, `custom` | Verify command — typecheck + lint + unit tests in one |

**Likely-but-unscheduled** (PRs welcome — the adapter contract is small): Jira, Notion, Plain (issue-tracker); GitLab, Bitbucket (pr); Cypress (e2e); Slack, Discord (notification — would be a new family). None of these are on the roadmap today; the adapter contract in `adapters/<family>/<name>/_interface.md` is small enough that a contributor can ship one in a weekend.

## Picking adapters

`/flow-init` asks during install. You can also pre-pick via the CLI:

```
flow init --profile standard \
  --with adapter:issue-tracker-linear \
  --without adapter:issue-tracker-github-issues \
  --yes
```

Each family allows exactly one active adapter at a time. The catalog enforces this — picking a second adapter for the same family overrides the first.

## Where adapters live

```
adapters/
├── issue-tracker/
│   ├── _interface.md       # the contract every issue-tracker adapter implements
│   ├── linear.md
│   ├── github-issues.md
│   └── none.md
├── pr/
│   ├── _interface.md
│   ├── github.md
│   └── none.md
├── e2e/
│   ├── _interface.md
│   ├── playwright-mcp.md
│   └── none.md
└── verify/
    ├── _interface.md
    ├── make.md
    ├── pnpm.md
    └── custom.md
```

Each adapter is a markdown file with sections for each operation in the family's `_interface.md`. `/flow-story` reads the active adapter at each phase and follows its instructions.

## Swapping after install

Two supported paths:

```
flow add adapter:pr-github-issues
flow remove adapter:pr-github
```

Or hand-edit `flow.config.yaml`:

```yaml
adapters:
  issue_tracker: linear
  pr: github
  e2e: playwright-mcp
  verify: make
```

Then re-run `/flow-doctor` to verify the new adapter file is symlinked and any new MCPs / CLIs needed are installed.

## Writing a custom adapter

1. Read `adapters/<family>/_interface.md` — that's the contract.
2. Copy the closest existing adapter (e.g., `pr/github.md`) to `pr/my-platform.md`.
3. Replace each operation block with your platform's equivalent. Operations are markdown — they describe what `/flow-story` should do, not literal code.
4. Add a `mcps:` and `requires_cli:` block at the top if your adapter needs external infra.
5. Register the adapter in `catalog.yaml` under the right family.
6. Add the catalog entry to your active profile via `--with adapter:pr-my-platform`.

## The `none` adapter

Every family has a `none` adapter. It's not a no-op — it tells `/flow-story` to **not** invoke that phase at all. E.g., `pr-none` means commit the story directly to the current branch without opening a PR. Useful for solo work or for stories that just update docs.

## Adapter inventory

| Adapter | Requires | MCPs | Notes |
|---|---|---|---|
| `issue-tracker-linear` | — | `linear` | Needs `LINEAR_API_KEY` in `~/.claude/.env.flow` |
| `issue-tracker-github-issues` | `gh` CLI | — | Uses `gh issue` commands |
| `issue-tracker-none` | — | — | Stories live only in `sprint.yaml` |
| `pr-github` | `gh` CLI | — | Uses `gh pr create / merge --auto` |
| `pr-none` | — | — | Commits directly to current branch |
| `e2e-playwright-mcp` | — | `playwright` | Reads `## E2E Journey` blocks from stories |
| `e2e-none` | — | — | E2E phase is skipped |
| `verify-make` | `make` | — | Runs `make verify` (you define the target) |
| `verify-pnpm` | `pnpm` | — | Runs configured script (default `verify`) |
| `verify-custom` | — | — | Runs the literal command from `integrations.verify.command` |
