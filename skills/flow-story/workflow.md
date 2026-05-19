# flow-story Workflow

**Output style — Caveman mandate.** All user-facing output from this workflow MUST be Caveman-mode: fragments OK, drop articles / filler / pleasantries / hedging, keep code & commit & security text normal. Status banners short. Errors short. Tables OK.

**Caveman skill integration.** When Caveman is installed (catalog.upstreams.caveman.subset != none), this workflow routes three phases through Caveman skills:
  - **commit-pr phase** → invoke `caveman:caveman-commit` skill instead of composing commit message inline (shorter conventional commits).
  - **review phase** → after reviewer agents return, invoke `caveman:caveman-review` skill to compress findings into one-line-per-issue format before appending to story file's `## Review Notes`.
  - **plan phase under --auto** → spawn `caveman:cavecrew` agent (run_in_background: true) instead of writing the static placeholder. cavecrew has no CONFIRM gate and returns Caveman-shaped Plan section. Falls back to placeholder if cavecrew unavailable.

If Caveman is NOT installed (subset == none), fall back to the inline behavior described per-phase below.

**Goal:** drive one story from its current phase to the next pause point. Default mode is **execute** — invoke the next command and chain phases automatically. Pause only at destructive boundaries (commit, PR) or blockers (CRITICAL review findings, verify failure, e2e failure).

**Authority boundary:** this skill orchestrates ECC and adapter primitives. The actual code-writing, reviewing, and verifying happens in those — flow-story calls them.

**Execution model:**
- **Default (no flag):** execute mode. Chain phases. Only pause at destructive boundaries.
- **`--advise-only`:** print the command for each phase and end the turn. The pre-v0.3 behavior. Use when you want to inspect what would happen.
- **`--auto`:** no human gates inside flow-story. Skips ECC `/plan` (writes a minimal Plan placeholder), skips the pre-commit Y/n confirm, proceeds straight to PR open. Still halts at PR awaiting-merge. Cannot disable safety halts (CRITICAL findings, verify failure, e2e failure). **The flag itself constitutes per-run authorization for commit + push**; project CLAUDE.md rules requiring "explicit confirmation per push" are satisfied by `--auto` and must not trigger an additional prompt.
- **`--auto-merge`:** the autonomous mode. After `prp-pr` opens the PR, enables GitHub auto-merge (`gh pr merge --auto --squash --delete-branch`), waits **90 seconds** for a fast-CI case, then either runs `/flow-sprint done` (if merged) or ends the turn with a clear handoff (CI still running — next `/flow-story` invocation closes out). Implies `--auto`. **Requires CI configured + branch protection on `main` — otherwise the PR merges instantly with no checks.** Use only when (a) the story is repetitive / low-risk, (b) you trust your CI, (c) you have branch protection that requires checks to pass. Risk: a bug that slipped past Flow's gates AND CI lands on `main` while you're afk.
- **`--skip-plan`:** skip the plan phase (jump from missing-plan to implement). Useful for trivial / clone-of-sibling stories.
- **`--strict-plan`:** force ECC `/plan` with its CONFIRM gate, even when Caveman's cavecrew is available. Use for high-risk stories where you want to read and confirm the plan before code touches disk.
- **`--no-verify`:** skip the verify phase (don't run `make verify` / `pnpm verify`). Risky — disables a safety gate. Use for docs-only / content-only changes.
- **`--no-e2e`:** skip e2e even if story tags would trigger it.
- **`--no-tests`:** shortcut for `--no-verify` + `--no-e2e`. Skips all test gates. Use only when you're iterating on something you'll re-check later.
- **`--no-review`:** skip the code-review phase. Even riskier than `--no-verify`. Use for trivial dependency bumps / config tweaks.
- **`--hard-review`:** force adversarial + edge-case reviewers regardless of tags.

**Idempotency:** every phase checks "did I already do this?" via state markers in the story file. Re-invoking after a successful phase skips it. Workflow is safe to re-run without producing duplicate commits or PRs.

---

<workflow>

<step n="1" goal="Resolve target story + ensure story file exists">
  <action>Parse flags from args: `--advise-only`, `--auto`, `--auto-merge`, `--skip-plan`, `--strict-plan`, `--no-verify`, `--no-e2e`, `--no-tests`, `--no-review`, `--hard-review`, plus optional positional story id.</action>
  <action>If `--no-tests` is set, treat both `--no-verify` and `--no-e2e` as also set.</action>
  <action>If `--auto-merge` is set, also set `--auto` (auto-merge implies auto throughout the pipeline).</action>

  <action>Load `flow.config.yaml`. If missing, HALT with "Run /flow-init first." If `flow.config.local.yaml` (per-developer override, gitignored) is also present, deep-merge it **over** the base config — local values win on conflict. This is how teams keep one shared `flow.config.yaml` while each developer can tweak (e.g. `review.barrier_timeout_seconds`, `verify.command`) without committing personal overrides.</action>
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
    - `{{has_plan_section}}` = does `{{story_file_content}}` contain a line matching the anchored regex `^## Plan\s*$` (exact heading — `## Plan B`, `## Planning`, `## Plan (revised)` all do NOT count) followed by non-comment content
    - `{{review_done}}` = does `{{story_file_content}}` contain a line matching `^## Review Notes\s*$` (anchored, exact)
    - `{{verify_passed}}` = does `{{story_file_content}}` contain a line matching `^## Verified\s*$` (anchored, exact)
    - `{{e2e_passed}}` = does `{{story_file_content}}` contain a line matching `^## E2E\s*$` (anchored) with `passed: true` somewhere in its block
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
    <!-- Plan-phase decision tree. First match wins. The branches are mutually
         exclusive and ordered from most-specific (flag-driven) to default.
         (--advise-only is handled at the top of step 3; never reaches here.) -->

    <!-- 1. --skip-plan: trivial / clone-of-sibling. Placeholder only. -->
    <check if="--skip-plan">
      <output>📐 plan → placeholder (--skip-plan). prp-implement plans inline.</output>
      <action>Append a `## Plan` section to {{story_file}}:
        ```
        ## Plan

        Skipped (--skip-plan). prp-implement reads ACs + Files block + sibling code → diff.
        ```
      </action>
      <action>Re-detect phase. Continue. Do NOT end turn.</action>
    </check>

    <!-- 2. --strict-plan: high-risk story; force ECC /plan with CONFIRM gate. -->
    <check if="--strict-plan">
      <output>📐 plan → /plan (strict, CONFIRM gate enforced)…</output>
      <action>Invoke `plan` skill via Skill tool with argument `@{{story_file}}`. Wait for /plan's CONFIRM gate. After /plan returns successfully: re-detect, continue. Do NOT end turn.</action>
    </check>

    <!-- 3. Caveman installed → cavecrew is the default planner.
         Covers bare /flow-story and --auto. No CONFIRM gate, Caveman-shape output. -->
    <check if="Caveman installed AND `caveman:cavecrew` skill registered">
      <output>📐 plan → cavecrew (Caveman default, no CONFIRM gate)…</output>
      <action>Spawn `caveman:cavecrew` (or fall back to `cavecrew` flat name) as Agent with `run_in_background: true`. Prompt: "Emit Plan section for {{story.id}} — {{story.title}}. Inputs: story file at {{story_file}}, sibling pattern {{sibling.id}} ({{sibling.file}}), refs above. Output only the Plan markdown body (no preamble). Caveman style: fragments OK, drop filler." When agent returns, append its output as the `## Plan` section in {{story_file}}.</action>
      <action>Re-detect phase. Continue. Do NOT end turn.</action>
    </check>

    <!-- 4. Caveman not installed. Two sub-cases:
         4a. --auto → placeholder (consistent with cavecrew's no-gate behavior)
         4b. bare /flow-story → ECC /plan with CONFIRM gate -->
    <check if="--auto">
      <output>📐 plan → placeholder (--auto, no Caveman). prp-implement plans inline.</output>
      <action>Append a `## Plan` section to {{story_file}} as in branch 1 (placeholder). Re-detect, continue.</action>
    </check>

    <output>📐 plan → /plan with CONFIRM gate (pass `--auto` to skip, or install Caveman for cavecrew default)…</output>
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

    <action>**Always spawn reviewers as Agents with `run_in_background: true`.** This keeps each reviewer's intermediate tool calls (greps, file reads, sub-shells) isolated in its own context — only the final findings summary returns to flow-story. Without background mode, a single review pass can consume 50+ tool uses in the main thread.

      Implementation:
        - One Agent tool call per reviewer, in a single message (so they run concurrently).
        - `subagent_type` = `<reviewer-id>` (e.g. `code-reviewer`, `typescript-reviewer`, `security-reviewer`).
        - `run_in_background: true` on every call.
        - `description` = short label (e.g. "Review E2-S11 — TypeScript").
        - `prompt` = self-contained: target diff (refer to "uncommitted changes" or "current branch vs main"), story acceptance criteria, severity rubric (CRITICAL/HIGH/MEDIUM/LOW), output format ("return a markdown table of findings with file:line, severity, finding").
        - If `config.review.use_separate_model == true`, also set `model: "sonnet"` (or whatever model is configured) for at least one reviewer to get a fresh perspective.

      After spawning: do NOT block waiting. Note the background task IDs as `{{review_task_ids}}`. Continue to verify phase. Background agents will return findings via notifications — flow-story aggregates them at the commit-pr barrier.
    </action>

    <action>Mark `{{review_spawned}} = true` in state (in-memory for this run; not persisted to story file yet — that happens after aggregation). Re-detect phase. Continue to verify. Do NOT end turn.</action>
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

  <!-- ────────────────────── REVIEW BARRIER (before commit-pr) ────────────────────── -->
  <!-- Background reviewers spawned earlier may not have completed yet. Wait for
       their notifications and aggregate findings before committing. -->
  <check if="phase == 'commit-pr' AND {{review_spawned}} AND NOT {{review_done}}">
    <output>🔍 review barrier — waiting on {{N}} background reviewer(s) before commit…</output>
    <action>Record `{{barrier_start}} = now()`. Hard cap: **15 minutes** wall-clock from `{{barrier_start}}`. Configurable via `config.review.barrier_timeout_seconds` (default 900).</action>
    <action>For each background task in `{{review_task_ids}}` (or recently-spawned reviewer agents):
      - If completed, parse its findings.
      - If still running, await its completion notification (do not actively poll — the harness notifies on task completion).
      - If `now() - {{barrier_start}} >= {{barrier_timeout}}`, mark the task as `timed_out`, stop waiting on it (do NOT block further), and record `{{timed_out_reviewers}}` += reviewer-id.
    </action>

    <check if="{{timed_out_reviewers}} is non-empty">
      <output>⏱  Review barrier timed out after {{barrier_timeout}}s. Reviewer(s) still running: {{timed_out_reviewers}}.

      Options:
        1. Re-invoke `/flow-story` later (background reviewer may have finished by then — findings will be picked up).
        2. Re-spawn the reviewer with `--no-review` to skip (NOT recommended for tagged-risky stories).
        3. Bump `config.review.barrier_timeout_seconds` if your reviewers genuinely need more time.

      Committing now without these reviewers' findings is **unsafe** — halting.
      </output>
      <action>End turn. Do NOT commit. Do NOT advance phase.</action>
    </check>

    <action>Aggregate findings by severity. Compute **raw counts** from the un-compressed reviewer output and store them as `{{severity_counts}} = { critical: N, high: M, medium: P, low: Q }`. These are the **source of truth** for the safety gate — do NOT recompute from compressed output.</action>

    <action>**Severity extraction fallback** (issue #6 defense): a reviewer that emits findings without explicit `CRITICAL` / `HIGH` / `MEDIUM` / `LOW` labels (e.g., emoji-only like 🚨 / ⚠) is parsed via the table below before counting. Anything still ambiguous is bucketed as `MEDIUM`.
      - 🚨 / `critical` / `must-fix` / `blocker` → CRITICAL
      - ⚠ / `high` / `should-fix` / `severe` → HIGH
      - 🟡 / `medium` / `consider` / `nice-to-have` → MEDIUM
      - 🟢 / `low` / `nit` / `style` / `optional` → LOW
    </action>

    <check if="{{severity_counts.critical}} > 0 OR {{severity_counts.high}} > 0">
      <output>🚨 Review halted — {{severity_counts.critical}} CRITICAL, {{severity_counts.high}} HIGH finding(s):

      {{render findings with file:line, severity, reviewer name}}

      Fix these, then re-invoke `/flow-story`. (CRITICAL/HIGH always pauses, even in --auto / --auto-merge.)
      </output>
      <action>End turn.</action>
    </check>

    <check if="Caveman installed AND `caveman:caveman-review` skill registered">
      <output>🪨 caveman-review → compressing findings to one-line-per-issue…</output>
      <action>Invoke `caveman:caveman-review` skill via Skill tool with the aggregated findings as input. It returns compressed one-line-per-issue format. Store as `{{compressed_notes}}`.</action>
      <action>**Severity-label preservation guard** (issue #6): scan `{{compressed_notes}}` for at least one occurrence of `CRITICAL` / `HIGH` / `MEDIUM` / `LOW` literal tokens (case-insensitive) when `{{severity_counts.critical + high + medium + low}} > 0`. If the compressed output stripped all severity tokens, prepend this header to `{{compressed_notes}}`:

      ```
      Findings: {{severity_counts.critical}} critical · {{severity_counts.high}} high · {{severity_counts.medium}} medium · {{severity_counts.low}} low
      ```

      This keeps future readers and `/flow-doctor`'s bug-probe able to detect severity even when caveman-review compresses aggressively.
      </action>
    </check>

    <action>Append `## Review Notes` to {{story_file}} with LOW/MEDIUM findings (Caveman-compressed if available, with severity header guard applied), reviewer names, timestamps. Mark `{{review_done}} = true`. Continue to commit-pr.</action>
  </check>

  <!-- ────────────────────── COMMIT-PR ────────────────────── -->
  <check if="phase == 'commit-pr'">
    <check if="Caveman installed AND `caveman:caveman-commit` skill registered">
      <output>🪨 caveman-commit → composing message…</output>
      <action>Invoke `caveman:caveman-commit` skill via Skill tool. Pass it **raw, un-compressed inputs** (issue #16 — never feed caveman-compressed text into a Caveman skill or you get double-compression):
        - `story.id`, `story.title`, `story.tags`
        - `changed_files` = list from `git status --porcelain`
        - `severity_summary` = `{{severity_counts.critical}} crit · {{severity_counts.high}} high · {{severity_counts.medium}} med · {{severity_counts.low}} low` (from the raw counts captured in the review barrier — NOT a re-read of the compressed `## Review Notes` block)
        - `verified_command` = the verify-adapter command that passed (e.g., `make verify`), pulled from the `## Verified` block's `command:` field (raw — never compressed)
        - `e2e_status` = `passed` | `n/a` | `skipped`
      The skill returns a Caveman-shaped conventional commit message. Use as `{{commit_msg}}`.</action>
    </check>
    <check if="Caveman NOT installed">
      <action>Compose commit message inline: derive `type` from story.tags (ui→feat, fix→fix, chore→chore, default feat) and form `<type>: {{story.id}} — {{story.title}}`.</action>
    </check>

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

    <check if="--auto OR --auto-merge">
      <action>**`--auto` IS the per-push authorization.** The user typed the flag, which constitutes explicit per-run consent for the full commit + push + PR sequence. Do NOT re-ask for confirmation, EVEN IF the project's CLAUDE.md (or any other doc) says "push requires explicit user confirmation per push" — that rule is satisfied by the user's `--auto` invocation. Proceeding without prompt.</action>
    </check>

    <action>Invoke `prp-commit` skill via Skill tool with the commit message + the relevant file paths.</action>
    <action>Invoke `prp-pr` skill via Skill tool. The PR body is rendered from `templates/pr.md.tmpl` + story content.</action>

    <action>After prp-pr returns with the PR URL:
      1. Flip `{{story.status}}` in sprint.yaml: doing → review. Set `pr: {{pr_url}}`.
      2. Invoke issue-tracker adapter `transition_to_review({{story.issue}}, {{pr_url}})` if `{{story.issue}}` set.
      3. Write sprint.yaml.
    </action>

    <output>✓ PR opened: {{pr_url}}. Sprint: doing → review.</output>

    <!-- --auto-merge: don't end turn; continue into the auto-merge loop -->
    <check if="--auto-merge">
      <action>Continue to the auto-merge handler below. Do NOT end turn.</action>
    </check>

    <output>Next: review the PR, merge it, then `/flow-sprint done {{story.id}}` (or re-invoke `/flow-story` for auto-close).</output>
    <action>End turn.</action>
  </check>

  <!-- ────────────────────── AUTO-MERGE (--auto-merge only) ────────────────────── -->
  <!-- v0.7 redesign (issue #13): replaced 30s×15min poll loop with a single
       short-wait + end-turn-if-not-yet handoff. The previous loop consumed
       ~30 `gh pr view` calls + main-context churn per story. Now: one sleep
       (60–90s), two `gh pr view` calls, then either continue to merge-done
       or end turn with a clear note that the next /flow-story invocation
       will pick it up. -->
  <check if="--auto-merge AND ({{pr_state}} == 'open' OR phase == 'awaiting-merge')">
    <output>🚀 auto-merge → enabling GitHub auto-merge on PR {{pr_number}}…</output>

    <action>Run `gh pr merge {{pr_number}} --auto --squash --delete-branch`. If it errors with "auto-merge is not allowed for this repository", surface that and HALT — the user needs to enable it in repo settings.</action>

    <output>✓ Auto-merge queued.</output>

    <action>**Single bounded wait** (90s — configurable via `config.pr.auto_merge_wait_seconds`). Then check once:
      1. `sleep 90`
      2. `gh pr view {{pr_number}} --json state,mergedAt,statusCheckRollup --jq .` → `{{pr_state_now}}`
      3. If `mergedAt` is non-null → set `{{phase}} = merge-done`, continue to merge-done handler. Do NOT end turn.
      4. If state is `CLOSED` without mergedAt → HALT with "PR closed without merge: {{reason}}".
      5. If `statusCheckRollup` shows any FAILURE → HALT with "CI failed: {{failing_check_name}}. Auto-merge cancelled. Inspect and re-run."
      6. Otherwise (still queued, CI still running) → emit the handoff output below and end turn.
    </action>

    <output>⏳ Auto-merge still pending after 90s wait.

      PR:       {{pr_url}}
      State:    {{pr_state_now.state}}
      CI:       {{summary of statusCheckRollup — pass/pending/fail counts}}
      Strategy: queued for merge once required checks pass

      **Not polling further** (issue #13 — polling 30 calls × 15 min eats context). The next time you run `/flow-story` (or `/flow-sprint done {{story.id}}`), Flow will re-check and close out if the PR has merged by then. You can also leave the terminal idle — `gh pr merge --auto` runs server-side on GitHub.
    </output>
    <action>End turn.</action>
  </check>

  <!-- ────────────────────── AWAITING MERGE (manual path) ────────────────────── -->
  <check if="phase == 'awaiting-merge' AND NOT --auto-merge">
    <output>⏳ awaiting-merge — PR {{pr_url}} ({{pr_state}}, reviewDecision: {{reviewDecision}})

    Merge via GitHub UI or `gh pr merge {{pr_number}} --squash --delete-branch`. Then re-invoke `/flow-story` (auto-closes) or `/flow-sprint done {{story.id}}` directly.

    Pass `--auto-merge` next time to skip this halt (requires CI + branch protection).
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
| auto-merge | `--auto-merge` flag set, PR open | `gh pr merge --auto --squash --delete-branch`, single 90s wait then handoff | CI failure (halts); PR closed without merge (halts); not-yet-merged (ends turn — next /flow-story tick checks again) |
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
