# flow-story Workflow

**Goal:** advance one story through the phases plan → (test) → implement → review → verify → (e2e) → (docs) → commit → pr. The skill detects which phase you're in from external state (sprint.yaml status, git branch, commits ahead, PR state) and either runs that phase or emits the next command to run.

**Authority boundary:** this skill delegates. It does not write code, do reviews, or run tests. Those belong to ECC's primitives (`/plan`, `/prp-implement`, `/code-review`, `/update-docs`, `/prp-commit`, `/prp-pr`) and to the active adapters from `flow.config.yaml`. flow-story orchestrates them.

**Idempotency:** re-invoking on the same phase without external state change produces identical output. No double commits, no double PRs.

---

<workflow>

<step n="1" goal="Resolve target story">
  <action>Load `flow.config.yaml`. If missing, HALT with "Run /flow init first."</action>
  <action>Load `docs/flow/sprint.yaml` → `{{sprint}}`.</action>

  <check if="positional arg provided">
    <action>Match against story.id (E1-001 form) or against slug in story.file. → `{{story}}`.</action>
    <check if="no match">
      <output>🚫 No story matching `{{arg}}`. Run `/flow-sprint status`.</output>
      <action>End turn.</action>
    </check>
  </check>

  <check if="no positional arg">
    <action>Find stories with status == 'doing' OR 'review'. → `{{candidates}}`.</action>
    <check if="zero candidates">
      <output>🚫 No active story. Run `/flow-sprint next` to start one.</output>
      <action>End turn.</action>
    </check>
    <check if="exactly one candidate">
      <action>Set `{{story}}` = that one.</action>
    </check>
    <check if="multiple candidates">
      <ask>Multiple active stories. Pick one:</ask>
      <action>Print numbered list, resolve user's pick.</action>
    </check>
  </check>

  <action>Load `{{story_file}}` from `{{story.file}}`.</action>
</step>

<step n="2" goal="Detect current phase from external state">
  <action>Read in parallel:
    - `{{branch}}` = `git rev-parse --abbrev-ref HEAD`
    - `{{commits_ahead}}` = `git rev-list --count main..HEAD` (or main equivalent)
    - `{{has_plan_section}}` = `grep -c '^## Plan' {{story_file}}`
    - `{{has_impl_files}}` = check `## Files` block in story file vs actual git diff
    - `{{review_done}}` = check `{{story_file}}` for `## Review Notes` section (added by /code-review hook or manual)
    - `{{verify_passed}}` = check for `## Verified` marker
    - `{{pr_number}}` = if pr_adapter != none, query GH for PR on this branch
    - `{{pr_state}}` = open/merged/closed
  </action>

  <action>Phase decision tree:
    - If `{{story.status}} == 'done'`: phase = `archived`, emit "Story already done. /flow-sprint status."
    - Else if `{{story.status}} == 'review'` AND `{{pr_state}} == 'merged'`: phase = `merge-done`, run `flow-sprint done {{story.id}}`.
    - Else if `{{story.status}} == 'review'`: phase = `awaiting-merge`, emit PR link + "Merge via GitHub UI, then re-run."
    - Else if `{{commits_ahead}} > 0` AND `{{verify_passed}}` AND NOT `{{pr_number}}`: phase = `commit-pr`.
    - Else if `{{commits_ahead}} > 0` AND `{{review_done}}` AND NOT `{{verify_passed}}`: phase = `verify`.
    - Else if `{{commits_ahead}} > 0` AND NOT `{{review_done}}`: phase = `review`.
    - Else if `{{branch}} starts with 'flow/'` AND NOT `{{commits_ahead}}` AND `{{has_plan_section}}` (or `--skip-plan`): phase = `implement`.
    - Else if `{{branch}} starts with 'flow/'` AND NOT `{{has_plan_section}}` AND NOT `--skip-plan`: phase = `plan`.
    - Else if `{{story.status}} == 'doing'` AND `{{branch}} == 'main'`: phase = `resume-branch`, emit "Run `git checkout flow/{{story.id}}-*` or `/flow-sprint next` to recreate branch."
    - Else: phase = `unknown`, emit drift report.
  </action>

  <output>📋 Story {{story.id}} — phase: {{phase}}</output>
</step>

<step n="3" goal="Execute the detected phase">

  <check if="phase == 'plan'">
    <output>📐 Phase: plan. The story has no `## Plan` section yet.

    Run:  /plan @{{story_file}}

    Or pass `--skip-plan` if this story is trivial enough to implement directly.

    Re-invoke `/flow-story` after planning.
    </output>
    <action>End turn.</action>
  </check>

  <check if="phase == 'implement'">
    <output>🛠 Phase: implement.

    Run:  /prp-implement @{{story_file}}

    /prp-implement will read the story's ACs + Files + Plan and implement with validation loops. Or edit directly if you prefer.

    Re-invoke `/flow-story` when commits are on the branch.
    </output>
    <action>End turn.</action>
  </check>

  <check if="phase == 'review'">
    <action>Compose reviewer list:
      - Always: `/code-review`
      - If `flow.config.yaml > review.language_reviewer` is set: that one
      - Conditional on tags (auto_hard_review_tags ∩ story.tags ≠ ∅): `/security-review`, `bmad-review-edge-case-hunter`
      - If `--hard-review`: force the conditional ones
    </action>

    <output>🔍 Phase: review.

    Running:
      {{reviewer_list with one per line}}

    {{ if config.review.use_separate_model: }}
    Multi-LLM mode: code-review spawns reviewer agent with model override.
    </output>

    <check if="config.review.use_separate_model AND we have Agent tool access">
      <action>For each reviewer, spawn an Agent in parallel with appropriate subagent_type + model override. Collect findings.</action>
    </check>
    <check if="NOT spawning agents inline">
      <action>Emit the exact commands the user should run, in order. End turn. (User runs them, re-invokes.)</action>
    </check>

    <action>If reviewers ran inline and findings include CRITICAL or HIGH: HALT with the report. User fixes, re-invokes.</action>
    <action>If reviewers ran inline and findings are clean (or only LOW): append `## Review Notes` to story file with the LOW findings + reviewer names + timestamps. Continue to verify phase or end turn for user to re-invoke.</action>
  </check>

  <check if="phase == 'verify'">
    <action>Load verify adapter: `~/.claude/skills/flow-story/adapters/verify/{{config.adapters.verify}}.md`. Read its `verify_cmd`.</action>

    <output>🧪 Phase: verify.

    Running:  $ {{verify_cmd}}
    </output>

    <action>Execute verify_cmd via Bash. Stream output.</action>

    <check if="exit != 0">
      <output>✗ Verify failed. Fix issues and re-invoke.

      Suggested:  /build-fix    (ECC has this skill — opt-in)
      </output>
      <action>End turn.</action>
    </check>

    <action>Append `## Verified` block to story file with timestamp + command + exit_code.</action>

    <check if="(story.tags ∩ config.implement.e2e_auto_trigger_tags) != ∅ AND config.adapters.e2e != 'none'">
      <action>Continue to e2e phase.</action>
    </check>
    <check if="no e2e trigger">
      <action>Continue to docs phase.</action>
    </check>
  </check>

  <check if="phase contains 'e2e'">
    <action>Load e2e adapter: `~/.claude/skills/flow-story/adapters/e2e/{{config.adapters.e2e}}.md`.</action>
    <action>Read `## E2E Journey` block from story file. If missing, ask user "Story tagged for E2E but no Journey defined — describe in 3 lines:" and add to story file.</action>
    <action>Execute the adapter's `run_journey` op. Stream output, save artifacts to `docs/flow/artifacts/{{story.id}}/`.</action>
    <action>If failed: HALT. If passed: append `## E2E` block to story file with artifact paths.</action>
  </check>

  <check if="phase contains 'docs' (mode standard or team, or --docs flag)">
    <output>📚 Phase: docs.

    Running:
      /update-docs
      /update-codemaps
    </output>
    <action>Emit the commands; user runs them; re-invokes. Or if config.docs.auto and Agent tool available, spawn doc-updater agent inline.</action>
  </check>

  <check if="phase == 'commit-pr'">
    <action>Compose commit message: `<type>: {{story.id}} — {{story.title}}` (type inferred from story.tags: ui→feat, fix→fix, etc.). Story file path included in scope.</action>

    <output>💾 Phase: commit + PR.

    Running:
      /prp-commit "{{commit_msg}}"
      /prp-pr
    </output>

    <action>Emit the commands. (Don't auto-commit/push in v0 — too risky. User runs /prp-commit and /prp-pr themselves.)</action>

    <check if="pr_adapter != 'none' AND /prp-pr was just run AND PR opened">
      <action>Flip `{{story.status}}` to `review`. Update sprint.yaml.</action>
      <action>Invoke issue-tracker adapter `transition_to_review({{story.issue}}, {{pr_url}})`.</action>
      <output>→ Sprint flipped: doing → review. Issue updated. Waiting on PR merge.</output>
    </check>

    <action>End turn.</action>
  </check>

  <check if="phase == 'awaiting-merge'">
    <output>⏳ Phase: awaiting merge.

    PR: {{pr_url}} ({{pr_state}})

    Merge it (via GitHub UI or `gh pr merge {{pr_number}} --squash`), then re-invoke `/flow-story` or run `/flow-sprint done {{story.id}}` directly.
    </output>
    <action>End turn.</action>
  </check>

  <check if="phase == 'merge-done'">
    <output>✓ PR merged. Closing out…</output>
    <action>Delegate to flow-sprint: `/flow-sprint done {{story.id}}`.</action>
  </check>

  <check if="phase == 'unknown'">
    <output>🚨 Unable to detect phase — state is inconsistent.

    Branch:     {{branch}}
    Commits:    {{commits_ahead}}
    Plan:       {{has_plan_section}}
    Reviewed:   {{review_done}}
    Verified:   {{verify_passed}}
    PR:         {{pr_number}} ({{pr_state}})
    Story:      {{story.status}}

    Suggested:
      - `/flow-sprint status` to inspect sprint state
      - `git status` to inspect branch state
      - `/flow-story --dry-run` to see detected phase without executing
    </output>
    <action>End turn.</action>
  </check>

</step>

</workflow>

---

## Phase summary table

| Phase | Trigger condition | Delegates to | Own work |
|---|---|---|---|
| plan | branch=flow/* AND no `## Plan` | `/plan @story` | — |
| implement | branch=flow/* AND has Plan AND no commits | `/prp-implement @story` | — |
| review | commits>0 AND no Review Notes | `/code-review` (+ language reviewer + conditional security/hard) | append Review Notes |
| verify | reviewed AND no Verified marker | verify adapter | append Verified marker |
| e2e | tags trigger AND e2e adapter active | e2e adapter | save artifacts |
| docs | mode≥standard OR --docs | `/update-docs` + `/update-codemaps` | — |
| commit-pr | verified AND no PR | `/prp-commit` + `/prp-pr` | flip status → review, transition issue |
| awaiting-merge | PR open | — | print PR link + wait |
| merge-done | PR merged | `/flow-sprint done` | archive story, close issue |
