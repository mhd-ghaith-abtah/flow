# Issue Tracker Adapter Interface

Every issue-tracker adapter MUST implement these operations. flow-story and flow-sprint invoke them by name.

## Required operations

### `create_issue(title, body, labels) → { issue_id, url } | { skipped: true }`

Called by `/flow-sprint add` when a new story is created. Return:
- `issue_id` — string used as `story.issue` in sprint.yaml
- `url` — string for user reference

If the adapter is `none`, return `{ skipped: true }` and Flow uses an internal id (`local-001`).

### `transition_to_doing(issue_id) → ok | { error }`

Called by `/flow-sprint next`. Mark the external issue as "in progress" / "started" / whichever the platform calls it.

### `transition_to_review(issue_id, pr_url) → ok | { error }`

Called by `/flow-story` after `/prp-pr` opens a PR. Link the PR to the issue and move to "in review".

### `transition_to_done(issue_id) → ok | { error }`

Called by `/flow-sprint done`. Close the issue.

### `get_state(issue_id) → state_string`

Read-only. Used by `flow doctor` and parity checks. Returns the external platform's state name.

## Optional operations

### `verify_merged(issue_id) → boolean`

Called before `transition_to_done`. Confirm the linked PR is actually merged so we don't close prematurely.

## Config keys

Adapters declare the keys they need in `flow.config.yaml > integrations.issue_tracker.*`. The Flow installer prompts for these at first install or when the adapter is swapped via `flow add adapter:issue-tracker-<id>` (or a hand-edit of `flow.config.yaml`).

## Failure handling

If any operation fails:
- Log the error to `docs/flow/audit-log.md` (if `mode: team`) or to stderr.
- Do NOT silently swallow — Flow halts and surfaces the error so the user can decide.
- The adapter SHOULD be retryable: re-running the same op should be idempotent.
