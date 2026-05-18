# GitHub PR adapter

Uses `gh` CLI. Same auth as the github-issues adapter.

**Dependencies:** `gh` authenticated; remote `origin` is a GitHub repo.

---

## open_pr(title, body, base, head)

1. Push branch if not pushed: `git push -u origin {{head}}`.
2. Run:
   ```bash
   gh pr create \
     --title "{{title}}" \
     --body "$(cat <<'EOF'
   {{body}}
   EOF
   )" \
     --base "{{base}}" \
     --head "{{head}}"
   ```
3. Parse stdout — last non-empty line is the PR URL.
4. Extract `pr_number` from URL.
5. Return `{ pr_id: pr_number, pr_number, url }`.

## get_pr_state(pr_id)

```bash
gh pr view {{pr_id}} --json state,mergedAt,reviewDecision
```

Map:
- `state` from GitHub: `OPEN` → `open`, `CLOSED` (no merge) → `closed`, `MERGED` → `merged`
- `reviewDecision`: `APPROVED` / `CHANGES_REQUESTED` / `REVIEW_REQUIRED` lowercased

## merge_pr(pr_id, method)

```bash
gh pr merge {{pr_id}} \
  --{{method}}                       # --squash | --merge | --rebase
  --delete-branch \
  --auto                              # waits for required checks if needed
```

If `--auto` is rejected (no required checks configured), retry without `--auto`.

## branch_name(story_id, slug)

`flow/{{story_id}}-{{slug}}` (e.g. `flow/E1-001-tokens-base-layout`).

If the active issue-tracker is `linear`, override to `{{issue_id}}-{{story_id}}-{{slug}}` so Linear's auto-link recognition works (`PLA-42-...`).

## pr_template(story)

Reads `{repo_root}/templates/pr.md.tmpl`. Substitutes:
- `{{story.title}}`
- `{{story.id}}`
- `{{issue_ref}}` — `Fixes #N` (github-issues) or `Closes PLA-42` (linear) or empty
- `{{summary}}` — first sentence of story's `Why`
- `{{test_plan}}` — rendered from story's ACs (each AC becomes a `- [ ]` line)
