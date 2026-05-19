# flow-story Workflow

**Goal:** drive one story from its current phase to the next pause point. Default mode is **execute** — invoke the next command and chain phases automatically. Pause only at destructive boundaries (commit, PR) or blockers (CRITICAL review findings, verify failure, e2e failure).

**Authority boundary:** this skill orchestrates ECC and adapter primitives. The actual code-writing, reviewing, and verifying happens in those — flow-story calls them.

**Execution model:**
- **Default (no flag):** execute mode. Chain phases. Only pause at destructive boundaries.
- **`--advise-only`:** print the command for each phase and end the turn. The pre-v0.3 behavior. Use when you want to inspect what would happen.
- **`--auto`:** truly no human gates. Skips ECC `/plan` entirely (writes a minimal Plan placeholder so implement can proceed), skips the pre-commit Y/n confirm, and proceeds straight to PR open. Use for clone-of-sibling stories where you've internalized the pattern. Cannot disable safety halts (CRITICAL findings, verify failure, e2e failure, awaiting-merge).
- **`--skip-plan`:** skip the plan phase (jump from missing-plan to implement). Useful for trivial / clone-of-sibling stories.
- **`--no-verify`:** skip the verify phase (don't run `make verify` / `pnpm verify`). Risky — disables a safety gate. Use for docs-only / content-only changes.
- **`--no-e2e`:** skip e2e even if story tags would trigger it.
- **`--no-tests`:** shortcut for `--no-verify` + `--no-e2e`. Skips all test gates. Use only when you're iterating on something you'll re-check later.
- **`--no-review`:** skip the code-review phase. Even riskier than `--no-verify`. Use for trivial dependency bumps / config tweaks.
- **`--hard-review`:** force adversarial + edge-case reviewers regardless of tags.

**Idempotency:** every phase checks "did I already do this?" via state markers in the story file. Re-invoking after a successful phase skips it. Workflow is safe to re-run without producing duplicate commits or PRs.

---

<workflow>

<step n="1" goal="Resolve target story + ensure story file exists">
  <action>Parse flags from args: `--advise-only`, `--auto`, `--skip-plan`, `--no-verify`, `--no-e2e`, `--no-tests`, `--no-review`, `--hard-review`, plus optional positional story id.</action>
  <action>If `--no-tests` is set, treat both `--no-verify` and `--no-e2e` as also set.</action>

  <action>Load `flow.config.yaml`. If missing, HALT with "Run /flow-init first."</action>
  <action>Load `docs/flow/sprint.yaml` → `{{sprint}}`.</action>

  <check if="positional arg provided">
    <action>Match against `story.id` (E1-001 or E1-S1 form). → `{{story}}`.</action>
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

  <check if="{{story.kind}} == 'offline'">
    <output>🌍 {{story.id}} — {{story.title}} is offline. Use `/flow-sprint done {{story.id}} --note "..."` when complete.</output>
    <action>End turn.</action>
  </check>

  <!-- Story file resolution + auto-scaffold ────────────────────────────── -->
  <action>Determine `{{story_file}}`:
    - If `{{story.file}}` set in sprint.yaml → that path.
    - Else look for `docs/flow/stories/{{story.id}}-*.md` (glob).
    - Else look for `docs/_bmad-output/implementation-artifacts/{{story.bmad_key}}.md` (legacy BMad spec).
    - Else `{{story_file}}` is null → trigger auto-scaffold below.
  </action>

  <check if="{{story_file}} is null">
    <action>**Auto-scaffold a minimal stub.** No interactive Q&A — derive everything from sprint.yaml + conventions.
      1. Find the most recent done story in this epic → `{{sibling}}`. This sets the "house pattern" reference.
      2. Look for design refs by convention: scan `docs/design/` for files whose name contains a slugified token of `{{story.title}}` (case-insensitive). Collect matches → `{{design_refs}}`.
      3. Look for content refs: scan `docs/_bmad-output/planning-artifacts/` for `content-*` files mentioning the story's keyword. Collect → `{{content_refs}}`.
      4. Generate the stub file at `docs/flow/stories/{{story.id}}-{{slug(story.title)}}.md` with this exact shape (5–10 lines, no boilerplate):

      ```markdown
      # {{story.id}} — {{story.title}}

      **Epic:** {{story.epic}} — {{epic.title}}
      **Tags:** {{story.tags or "(none)"}}
      **Status:** {{story.status}}

      **Refs:**
      {{design_refs lines or "(no design ref auto-detected — check docs/design/)" }}
      {{content_refs lines or "" }}
      **Sibling pattern:** {{sibling.id}} — {{sibling.title}} ({{sibling.file or "see archive"}})

      ## Plan

      <!-- /plan will populate this. -->
      ```

      5. Append `file: docs/flow/stories/{{story.id}}-{{slug(story.title)}}.md` to the sprint.yaml entry for this story. Write sprint.yaml. Set `{{story_file}}` to the new path.
    </action>
    <output>📄 Auto-created stub: `{{story_file}}` (sibling: {{sibling.id}}, refs: {{design_refs_count}} design + {{content_refs_count}} content)</output>
  </check>

  <action>Load `{{story_file_content}}` from `{{story_file}}`.</action>
</step>

<step n="2" goal="Detect current phase">
  <action>Read in parallel:
    - `{{branch}}` = `git rev-parse --abbrev-ref HEAD`
    - `{{commits_ahead}}` = `git rev-list --count origin/main..HEAD` (fall back to `main` if no `origin/main`)
    - `{{has_uncommitted}}` = `git status --porcelain` non-empty (modified, untracked, or staged-but-uncommitted)
    - `{{has_changes}}` = `{{commits_ahead}} > 0` OR `{{has_uncommitted}}` (work exists to review/verify/commit, regardless of whether it's been committed yet)
    - `{{has_plan_section}}` = does `{{story_file_content}}` contain `## Plan` followed by non-comment content
    - `{{review_done}}` = does `{{story_file_content}}` contain `## Review Notes`
    - `{{verify_passed}}` = does `{{story_file_content}}` contain `## Verified`
    - `{{e2e_passed}}` = does `{{story_file_content}}` contain `## E2E` with `passed: true`
    - `{{pr_number}}` + `{{pr_state}}` = if pr_adapter != none, query GH for PR on this branch
  </action>

  <action>Phase decision (first match wins). **Important:** review and verify run on uncommitted work; we don't require a commit before they're eligible. commit-pr happens AFTER they pass, bundling everything into a single commit.
    - `{{story.status}} == 'done'` → `archived`
    - `{{story.status}} == 'review'` AND `{{pr_state}} == 'merged'` → `merge-done`
    - `{{story.status}} == 'review'` → `awaiting-merge`
    - `{{has_changes}}` AND `{{verify_passed}}` AND (e2e ok or n/a) AND `{{review_done}}` AND NOT `{{pr_number}}` → `commit-pr`
    - `{{has_changes}}` AND `{{review_done}}` AND NOT `{{verify_passed}}` → `verify`
    - `{{has_changes}}` AND NOT `{{review_done}}` → `review`
    - `{{branch}}` starts `flow/` AND NOT `{{has_changes}}` AND (`{{has_plan_section}}` OR `--skip-plan`) → `implement`
    - `{{branch}}` starts `flow/` AND NOT `{{has_changes}}` AND NOT `{{has_plan_section}}` AND NOT `--skip-plan` → `plan`
    - `{{story.status}} == 'doing'` AND `{{branch}} == 'main'` → `resume-branch`
    - else → `unknown`
  </action>

  <output>📋 Story {{story.id}} — phase: {{phase}} {{ (advise-only) if --advise-only }}</output>
</step>

<step n="3" goal="Execute the detected phase + chain to next">

  <!-- ADVISE-ONLY ESCAPE: emit command for current phase only, end turn -->
  <check if="--advise-only">
    <action>Print the command that WOULD execute for `{{phase}}`. Do not invoke. End turn.</action>
  </check>

  <!-- ────────────────────── PLAN ────────────────────── -->
  <check if="phase == 'plan'">
    <!-- Under --auto or --skip-plan, we can't bypass ECC /plan's internal CONFIRM
         gate, so we don't invoke it. We auto-write a minimal Plan section derived
         from the story itself and let implement run directly. -->
    <check if="--auto OR --skip-plan">
      <output>📐 plan → auto-skipped ({{ "--auto" if --auto else "--skip-plan" }}). Writing minimal Plan placeholder so implement can proceed.</output>
      <action>Append a `## Plan` section to {{story_file}} with:
        ```
        ## Plan

        Auto-skipped (--auto). Implementation derived from:
        - ACs in this story file
        - Sibling pattern: {{sibling.id}} — {{sibling.title}}
        - Refs listed above

        prp-implement will read the ACs + Files block + sibling code and produce the diff.
        ```
      </action>
      <action>Re-detect phase from Step 2 (should now be `implement`). Continue. Do NOT end turn.</action>
    </check>

    <!-- Default: invoke ECC's /plan, which has its own CONFIRM gate that the user must answer. -->
    <output>📐 plan → invoking `plan` skill on {{story_file}}… (pass `--auto` to skip the CONFIRM gate)</output>
    <action>Invoke the `plan` skill via the Skill tool with argument `@{{story_file}}`. The plan skill will (a) read the story, (b) propose an implementation strategy, (c) ASK the user to CONFIRM before continuing. That confirmation gate is plan's own, not flow-story's — flow-story waits for it to return.</action>
    <action>After /plan returns successfully (story file now has a populated `## Plan` section): re-detect phase from Step 2 and continue. Do NOT end turn.</action>
  </check>

  <!-- ────────────────────── IMPLEMENT ────────────────────── -->
  <check if="phase == 'implement'">
    <output>🛠 implement → invoking `prp-implement` skill on {{story_file}}…</output>
    <action>Invoke the `prp-implement` skill via the Skill tool with argument `@{{story_file}}`. It reads the plan + ACs + Files block and implements with internal validation loops. May commit incrementally; flow-story tolerates that.</action>
    <action>After /prp-implement returns: re-detect phase (should advance to `review` once commits are on the branch). Continue. Do NOT end turn.</action>
  </check>

  <!-- ────────────────────── REVIEW ────────────────────── -->
  <check if="phase == 'review'">
    <check if="--no-review">
      <output>🔍 review → skipped (--no-review). Appending placeholder Review Notes…</output>
      <action>Append `## Review Notes` to {{story_file}} with `(skipped via --no-review, {{timestamp}})`. Re-detect phase. Continue.</action>
    </check>

    <action>Compose reviewer set:
      - Always: `code-review` (generic reviewer)
      - Stack-specific: from `config.review.language_reviewer` if set (e.g. `typescript-reviewer`)
      - Security: `security-review` if `(config.review.auto_hard_review_tags ∩ story.tags) ≠ ∅` OR `--hard-review`
      - Adversarial: `bmad-review-edge-case-hunter` if `--hard-review` or tags include `auth|payments|migration|pii`
    </action>

    <output>🔍 review → spawning {{reviewer_count}} reviewer(s) in parallel…</output>

    <check if="config.review.use_separate_model AND Agent tool available">
      <action>Spawn each reviewer as an Agent (parallel, one Agent tool block with N tool calls). For language reviewers and security-review use `subagent_type: <reviewer-id>`. Use `model: "sonnet"` override if config says so. Collect all findings.</action>
    </check>
    <check if="NOT use_separate_model">
      <action>Invoke each reviewer skill sequentially via the Skill tool. Faster wall-clock to do them in parallel via Agent, but same model is fine for v0.</action>
    </check>

    <action>Aggregate findings by severity. Render the report.</action>

    <check if="any finding is CRITICAL or HIGH">
      <output>🚨 Review halted — {{N}} CRITICAL, {{M}} HIGH finding(s):

      {{render findings with file:line}}

      Fix these, then re-invoke `/flow-story`. (CRITICAL/HIGH always pauses, even in --auto mode.)
      </output>
      <action>End turn.</action>
    </check>

    <action>Append `## Review Notes` to {{story_file}} with LOW/MEDIUM findings, reviewer names, timestamps.</action>
    <action>Re-detect phase. Continue. Do NOT end turn.</action>
  </check>

  <!-- ────────────────────── VERIFY ────────────────────── -->
  <check if="phase == 'verify'">
    <check if="--no-verify">
      <output>🧪 verify → skipped (--no-verify / --no-tests). Appending placeholder Verified marker…</output>
      <action>Append `## Verified` to {{story_file}} with `(skipped via --no-verify, {{timestamp}})`. Re-detect phase. Continue.</action>
    </check>

    <action>Load verify adapter: `~/.claude/skills/flow-story/adapters/verify/{{config.adapters.verify}}.md`. Get its `verify_cmd`.</action>

    <output>🧪 verify → $ {{verify_cmd}}</output>
    <action>Execute `{{verify_cmd}}` via the Bash tool. Stream output. Capture exit code.</action>

    <check if="exit != 0">
      <output>✗ Verify failed (exit {{code}}). Fix and re-invoke. Common helpers:

      `/build-fix` — ECC build-error resolver
      Read the output above for the actual error.
      </output>
      <action>End turn. (Verify failure always pauses, even in --auto mode.)</action>
    </check>

    <action>Append `## Verified` block to {{story_file}} with timestamp + command + exit_code: 0.</action>
    <action>Re-detect phase. Continue. Do NOT end turn.</action>
  </check>

  <!-- ────────────────────── E2E ────────────────────── -->
  <check if="(story.tags ∩ config.implement.e2e_auto_trigger_tags) ≠ ∅ AND config.adapters.e2e != 'none' AND NOT {{e2e_passed}} AND NOT --no-e2e">
    <action>Load e2e adapter: `~/.claude/skills/flow-story/adapters/e2e/{{config.adapters.e2e}}.md`.</action>
    <action>Read `## E2E Journey` block from {{story_file}}. If missing, skip e2e and emit advisory "story tagged for E2E but has no Journey block — add one for stronger coverage". Do NOT halt.</action>

    <output>🎭 e2e → running journey via {{config.adapters.e2e}}…</output>
    <action>Execute the adapter's `run_journey` operation (typically the Playwright MCP tools per step). Stream output. Save artifacts to `docs/flow/artifacts/{{story.id}}/`.</action>

    <check if="run_journey failed">
      <output>✗ E2E journey failed. Artifacts: docs/flow/artifacts/{{story.id}}/

      {{summary of failed steps}}

      Re-run after fixing. (E2E failure always pauses, even in --auto mode.)
      </output>
      <action>End turn.</action>
    </check>

    <action>Append `## E2E` block to {{story_file}} with `passed: true` + artifact paths.</action>
    <action>Re-detect phase. Continue. Do NOT end turn.</action>
  </check>

  <!-- ────────────────────── DOCS ────────────────────── -->
  <check if="config.mode in [standard, team] AND {{verify_passed}} AND NOT story has '## Docs' marker">
    <output>📚 docs → invoking `update-docs` skill…</output>
    <action>Invoke `update-docs` skill via Skill tool. Wait for completion.</action>
    <action>If `config.mode == team`, also invoke `update-codemaps`.</action>
    <action>Append `## Docs` marker to {{story_file}}. Re-detect. Continue. Do NOT end turn.</action>
  </check>

  <!-- ────────────────────── COMMIT-PR ────────────────────── -->
  <check if="phase == 'commit-pr'">
    <action>Compose commit message: derive `type` from story.tags (ui→feat, fix→fix, chore→chore, default feat) and form `<type>: {{story.id}} — {{story.title}}`.</action>

    <action>Inventory what needs committing:
      - `{{has_uncommitted}}` files (from `git status --porcelain`) — the implementation
      - The story file with its appended `## Review Notes` / `## Verified` / `## E2E` / `## Docs` markers
      - The sprint.yaml entry (will be flipped to `review` AFTER prp-pr returns; staged in this same commit if the project's convention is "single-commit-then-flip", separate if "commit then flip then commit again")
      - Any deferred-work updates
    </action>

    <output>💾 commit-pr → ready to commit + open PR.

    Commit message: `{{commit_msg}}`
    Branch:         {{branch}}
    PR target:      main
    </output>

    <check if="NOT --auto">
      <ask>Proceed? [Y/n/edit-message]</ask>
      <check if="user picks edit-message">
        <ask>New commit message:</ask>
        <action>Update `{{commit_msg}}`.</action>
      </check>
      <check if="user picks n">
        <output>Holding. Run `/flow-story` again when ready.</output>
        <action>End turn.</action>
      </check>
    </check>

    <action>Invoke `prp-commit` skill via Skill tool with the commit message + the relevant file paths.</action>
    <action>Invoke `prp-pr` skill via Skill tool. The PR body is rendered from `templates/pr.md.tmpl` + story content.</action>

    <action>After prp-pr returns with the PR URL:
      1. Flip `{{story.status}}` in sprint.yaml: doing → review. Set `pr: {{pr_url}}`.
      2. Invoke issue-tracker adapter `transition_to_review({{story.issue}}, {{pr_url}})` if `{{story.issue}}` set.
      3. Write sprint.yaml.
    </action>

    <output>✓ PR opened: {{pr_url}}. Sprint: doing → review.

    Next: review the PR, merge it, then run `/flow-sprint done {{story.id}}` (or re-invoke `/flow-story` for auto-close on merge).
    </output>
    <action>End turn. (PR is open; waiting on human review unless --auto-merge is implemented in a future version.)</action>
  </check>

  <!-- ────────────────────── AWAITING MERGE ────────────────────── -->
  <check if="phase == 'awaiting-merge'">
    <output>⏳ awaiting-merge — PR {{pr_url}} ({{pr_state}}, reviewDecision: {{reviewDecision}})

    Merge via GitHub UI or `gh pr merge {{pr_number}} --squash --delete-branch`. Then re-invoke `/flow-story` (auto-closes) or `/flow-sprint done {{story.id}}` directly.
    </output>
    <action>End turn.</action>
  </check>

  <!-- ────────────────────── MERGE-DONE ────────────────────── -->
  <check if="phase == 'merge-done'">
    <output>✓ PR merged. Closing out via /flow-sprint done…</output>
    <action>Invoke `flow-sprint` skill with arg `done {{story.id}}`. That handles branch cleanup, status flip to done, archive, issue close.</action>
    <action>End turn.</action>
  </check>

  <!-- ────────────────────── RESUME BRANCH ────────────────────── -->
  <check if="phase == 'resume-branch'">
    <output>⚠ Story {{story.id}} is `doing` but you're on `main`. Expected branch: `flow/{{story.id}}-*`.

    Options:
      - `git checkout flow/{{story.id}}-...` if the branch still exists locally
      - `/flow-sprint next` to recreate
    </output>
    <action>End turn.</action>
  </check>

  <!-- ────────────────────── UNKNOWN ────────────────────── -->
  <check if="phase == 'unknown'">
    <output>🚨 Drift detected. State is inconsistent:

    Branch:     {{branch}}
    Commits:    {{commits_ahead}}
    Plan:       {{has_plan_section}}
    Reviewed:   {{review_done}}
    Verified:   {{verify_passed}}
    PR:         {{pr_number}} ({{pr_state}})
    Story:      {{story.status}}

    Inspect with: `/flow-sprint status` + `git status`. Re-invoke with `--advise-only` to see what each phase would do without acting.
    </output>
    <action>End turn.</action>
  </check>

</step>

</workflow>

---

## Phase summary

| Phase | Trigger | Action in execute mode | Pauses on |
|---|---|---|---|
| auto-stub | sprint.yaml entry, no story file | scaffold 5–7 line stub from conventions | — |
| plan | no `## Plan` populated | invoke `plan` skill (CONFIRM gate) — or auto-write placeholder under `--auto`/`--skip-plan` | plan's CONFIRM (skipped under `--auto`) |
| implement | branch + plan present, no commits | invoke `prp-implement` | — |
| review | changes exist (committed or uncommitted), no Review Notes | spawn reviewer(s) parallel on `git diff`; auto-append clean findings | CRITICAL/HIGH (always); skipped under `--no-review` |
| verify | reviewed, no Verified marker | run verify adapter's cmd | non-zero exit (always); skipped under `--no-verify` / `--no-tests` |
| e2e | story tags trigger, e2e adapter active | run journey via adapter | journey failure (always); skipped under `--no-e2e` / `--no-tests` |
| commit-pr | reviewed AND verified AND e2e-ok | bundle uncommitted + staged + story markers into one commit, open PR | pre-commit Y/n (skipped under `--auto`) |
| docs | mode ≥ standard, verified, no Docs marker | invoke `update-docs` (and `update-codemaps` in team) | — |
| commit-pr | verified, no PR | propose commit; ask Y/n; invoke `prp-commit` + `prp-pr` | user n (skipped if --auto) |
| awaiting-merge | PR open | print PR link + wait | always (need human merge) |
| merge-done | PR merged | invoke `flow-sprint done` | — |

**Hard halt boundaries** (never bypassed, even in `--auto`):
- CRITICAL or HIGH review findings
- Verify non-zero exit
- E2E journey failure
- PR open (awaits human merge — Flow does not auto-merge in v0)

**Bypassed under `--auto`:**
- Plan skill's CONFIRM gate (Flow writes a placeholder Plan instead of invoking `/plan`)
- Pre-commit Y/n confirmation

**Soft halt boundaries** (skipped in `--auto`):
- Pre-commit confirmation prompt

**Never silent:** every phase prints what it's doing (`📐 plan → ...`, `🛠 implement → ...`, etc.) so the user can see chaining happen and Ctrl-C if needed.
