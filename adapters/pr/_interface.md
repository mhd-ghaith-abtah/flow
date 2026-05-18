# PR Platform Adapter Interface

Every pr adapter MUST implement these operations.

## Required operations

### `open_pr(title, body, base, head) → { pr_id, pr_number, url }`

Called by `/flow-story` at the commit-pr phase. Open a PR from `head` (current branch) to `base` (default `main`).

### `get_pr_state(pr_id) → { state, mergedAt, reviewDecision }`

- `state` ∈ `{open, closed, merged}`
- `mergedAt` ISO timestamp or null
- `reviewDecision` ∈ `{approved, changes_requested, review_required, null}`

### `merge_pr(pr_id, method) → ok | { error }`

Method ∈ `{squash, merge, rebase}`. flow-sprint done uses `squash` by default.

## Optional operations

### `branch_name(story_id, slug) → string`

Convention for branch naming. Default: `flow/<story_id>-<slug>`. Adapters can override (e.g., Linear-style `PLA-42-feature-name`).

### `pr_template(story) → string`

Return the body template for a new PR. Default reads `templates/pr.md.tmpl`. Adapters can substitute platform-specific tokens.
