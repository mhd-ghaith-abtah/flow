# Linear adapter

Uses the Linear MCP server (`@tacticlaunch/mcp-linear`). Requires OAuth auth (browser flow).

**Config keys:**
- `team_key` — Linear team prefix, e.g. `PLA` (issues become `PLA-42`)
- `state_map` — optional override for state name → Flow status mapping (defaults below)

**Dependencies:**
- Linear MCP server installed (`claude mcp list | grep linear`)
- OAuth completed (`mcp__plugin_linear_linear__list_teams` returns successfully)

---

## create_issue(title, body, labels)

1. Resolve team id:
   - `mcp__plugin_linear_linear__list_teams` → find team where `key == config.team_key`
2. Create:
   - `mcp__plugin_linear_linear__create_issue` with `{ teamId, title, description: body }`
3. Apply labels:
   - For each label string, `mcp__plugin_linear_linear__list_issue_labels` and find matching name. If missing, create it. Then add to issue.
4. Return `{ issue_id: response.identifier, url: response.url }`.

## transition_to_doing(issue_id)

1. `mcp__plugin_linear_linear__list_issue_statuses` for the team
2. Find state where `type == "started"` AND `name in ["In Progress", "Doing", "Started"]`
3. `mcp__plugin_linear_linear__update_issue` with `{ id: issue_id, stateId }`

## transition_to_review(issue_id, pr_url)

1. Find state where `name in ["In Review", "Review", "Code Review"]`
2. `update_issue` with `stateId`
3. Add comment: `mcp__plugin_linear_linear__create_comment` with `{ issueId, body: "PR opened: " + pr_url }`

## transition_to_done(issue_id)

1. Find state where `type == "completed"` AND `name in ["Done", "Completed", "Closed"]`
2. `update_issue` with `stateId`

## verify_merged(issue_id)

1. Read issue: `mcp__plugin_linear_linear__get_issue({ id: issue_id })`
2. Look for attached PR (Linear auto-detects PRs linked via `Fixes` keywords or branch naming `<team_key>-<n>-...`).
3. Check the PR's merged state via gh CLI: `gh pr view <number> --json mergedAt -q .mergedAt`.
4. Return truthy if non-null.

## get_state(issue_id)

`mcp__plugin_linear_linear__get_issue` → `.state.name` and `.state.type`.

Map:
- type `backlog` or `unstarted` → `backlog`
- type `started` → `doing`
- type `started` AND name matches "review" → `review`
- type `completed` → `done`
- type `canceled` → `cancelled`

## Failure handling

- If MCP unavailable, halt with: "Linear MCP not reachable — run `claude mcp list` to debug, or `/flow-init --repair`."
- If auth not completed, halt with: "Linear OAuth not done — open Claude Code Settings → MCP → linear → Authenticate."
- Rate limit: Linear MCP returns 429 — retry with exponential backoff up to 3 times.
- If team_key not found, halt with the list of available team keys.
