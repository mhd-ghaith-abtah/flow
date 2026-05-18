# GitHub Issues adapter

Uses the `gh` CLI (already authenticated via `gh auth login`). No MCP required.

**Config keys** (from `flow.config.yaml > integrations.issue_tracker`):
- `repo` — `owner/name` (auto-detected by `gh repo view --json nameWithOwner -q .nameWithOwner`)
- `label_prefix` — optional, defaults to `flow`
- `default_labels` — optional list, defaults to `["flow"]`

**Dependencies:**
- `gh` CLI authenticated (`gh auth status` must pass)
- `git remote get-url origin` resolves to a GitHub repo

---

## create_issue(title, body, labels)

1. Compose label list: `{{config.default_labels}} + labels + ["flow:backlog"]`.
2. Run:
   ```bash
   gh issue create \
     --repo {{config.repo}} \
     --title "{{title}}" \
     --body "{{body}}" \
     {{ for each label: --label "<label>" }}
   ```
3. Parse stdout — last line is the issue URL: `https://github.com/{{repo}}/issues/<N>`.
4. Extract `N` from the URL → `issue_id` = `#<N>`.
5. Return `{ issue_id, url }`.

## transition_to_doing(issue_id)

```bash
gh issue edit {{issue_id_number}} \
  --repo {{config.repo}} \
  --remove-label "flow:backlog" \
  --add-label "flow:in-progress"
```

## transition_to_review(issue_id, pr_url)

1. Update labels:
   ```bash
   gh issue edit {{issue_id_number}} \
     --remove-label "flow:in-progress" \
     --add-label "flow:in-review"
   ```
2. Post a linking comment:
   ```bash
   gh issue comment {{issue_id_number}} \
     --body "PR opened: {{pr_url}}"
   ```
3. Note: GitHub auto-links issues mentioned in PR bodies via `Fixes #N` or `Closes #N`. The PR template in Flow ensures this is included.

## transition_to_done(issue_id)

```bash
gh issue close {{issue_id_number}} \
  --repo {{config.repo}} \
  --reason completed
```

## verify_merged(issue_id)

1. Find PR linked to this issue:
   ```bash
   gh pr list \
     --search "linked:issue:{{issue_id_number}} is:merged" \
     --json number,mergedAt \
     --jq '.[0]'
   ```
2. Return truthy if `mergedAt` is not null.

## get_state(issue_id)

```bash
gh issue view {{issue_id_number}} \
  --json state,labels \
  --jq '{state: .state, labels: [.labels[].name]}'
```

Map labels → Flow state:
- `flow:backlog`     → `backlog`
- `flow:in-progress` → `doing`
- `flow:in-review`   → `review`
- `state: CLOSED`    → `done` (if `flow` label present)

## Failure handling

- If `gh` is unauthenticated, halt with: "Run `gh auth login` and retry."
- If repo not detected, prompt user for `repo` config key.
- `gh issue` operations are idempotent — re-running is safe.
- Network failures: retry once, then halt.

## Label setup (one-time)

On first use in a repo, Flow creates the label set:
```bash
gh label create "flow"            --color "0E8A16" || true
gh label create "flow:backlog"    --color "BFD4F2" || true
gh label create "flow:in-progress" --color "FBCA04" || true
gh label create "flow:in-review"  --color "5319E7" || true
```
