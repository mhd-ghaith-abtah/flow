# No PR platform adapter

All PR operations are no-ops. Commits go straight to `main` (or whatever the default branch is). Flow uses local branches per story but `flow-sprint done` merges via `git merge --ff-only` instead of opening a PR.

Use when:
- Solo project with no review needed
- Internal scripts / experiments
- Pre-publish prototypes

## open_pr(title, body, base, head)

1. Switch to base: `git checkout {{base}}`.
2. Merge feature branch fast-forward: `git merge --ff-only {{head}}`.
3. Push: `git push origin {{base}}`.
4. Delete local branch: `git branch -d {{head}}`.
5. Return `{ pr_id: "local-merge", pr_number: null, url: null }`.

## get_pr_state(pr_id)

Returns `{ state: "merged", mergedAt: <ISO timestamp of local merge>, reviewDecision: null }`.

## merge_pr(pr_id, method)

No-op — merge happened at `open_pr` time. Returns `ok`.

## branch_name(story_id, slug)

`flow/{{story_id}}-{{slug}}`. Same as github.

## pr_template(story)

Returns empty string (no body needed).
