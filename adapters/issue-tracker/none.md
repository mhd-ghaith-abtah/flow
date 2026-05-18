# No issue tracker adapter

All issue-tracker operations are no-ops. sprint.yaml is the source of truth.

Story ids use the internal scheme `E<epic>-<NNN>` (e.g. `E1-001`).

## create_issue(title, body, labels)

Returns `{ skipped: true, issue_id: null, url: null }`. Flow uses the internal story id.

## transition_to_doing(issue_id)
Returns `ok`.

## transition_to_review(issue_id, pr_url)
Returns `ok`.

## transition_to_done(issue_id)
Returns `ok`.

## verify_merged(issue_id)

Returns `true` (no external check). User is responsible for confirming PR is merged before `/flow-sprint done`.

## get_state(issue_id)

Returns the `status` field from sprint.yaml for the matching story.
