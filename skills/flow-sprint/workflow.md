# flow-sprint Workflow

**Goal:** maintain sprint state in `docs/flow/sprint.yaml`. Stories are the unit of work; epics group them; status flows backlog → doing → review → done. Every status change also invokes the active issue-tracker adapter to keep external state in sync.

**Schema invariants** (validated on every write):
- `stories[].id` matches `^E\d+-S?\d{1,3}[a-z]?$`. Accepted forms:
  - Flow native — `E1-001`, `E1-002`, … (zero-padded three-digit)
  - BMad-style — `E1-S1`, `E2-S10`, `E3-S9b`, … (kept when migrated from `bmad-create-story` output to preserve continuity)
  - Both forms can coexist in the same sprint.yaml. `flow-sprint add` continues whichever form the epic already uses.
- `stories[].status` in `[backlog, doing, review, done, cancelled]`
- `stories[].kind` in `[code, offline]`, default `code` when omitted.
  - `code` — runs the full per-story loop (branch → plan → implement → review → verify → e2e → docs → commit → PR).
  - `offline` — meatspace tasks (address resolution, photoshoot, copywriting, manual data work). `next` skips by default; `done` is a one-shot flip with no branch / PR / verify checks.
- Exactly zero or one story may be in `doing` at any time (enforce one-story-at-a-time per dev unless `mode: team`)

---

<workflow>

<step n="1" goal="Parse subcommand and arguments">
  <action>Parse argv:
    - First positional = subcommand
    - Remaining args interpreted per subcommand
  </action>

  <action>Resolve paths from `flow.config.yaml`:
    - `{{sprint_file}}` = config.sprint_file (default `docs/flow/sprint.yaml`)
    - `{{stories_dir}}` = config.stories_dir (default `docs/flow/stories`)
    - `{{deferred_file}}` = config.deferred_file (default `docs/flow/deferred.md`)
    - `{{archive_dir}}` = `docs/flow/archive`
    - `{{retros_dir}}` = `docs/flow/retros`
    - `{{issue_tracker_adapter}}` = config.adapters.issue_tracker (e.g. "github-issues")
    - `{{pr_adapter}}` = config.adapters.pr
    - `{{mode}}` = config.mode
  </action>

  <action>If `flow.config.yaml` is missing, HALT with "Flow not installed in this project — run /flow-init first."</action>

  <action>Load `{{sprint}}` = parsed `{{sprint_file}}`.</action>
</step>

<step n="2" goal="Dispatch subcommand">

  <check if="subcommand == 'init'">
    <action>Write a minimal sprint.yaml + create dirs. Same effect as flow-init's project scaffold step but standalone. Useful for bootstrapping a fresh sprint after a retro.</action>
  </check>

  <check if="subcommand == 'add-epic'">
    <action>Parse: `<epic-id> "<title>"` — e.g. `add-epic E1 "Foundation"`.</action>
    <action>Validate epic-id format (`^E\d+$`).</action>
    <action>Refuse if epic-id already exists in `{{sprint}}.epics`.</action>
    <action>Append `{ id, title, status: backlog }` to `{{sprint}}.epics`.</action>
    <action>Write sprint.yaml.</action>
    <output>✓ Added epic {{epic_id}}.</output>
  </check>

  <check if="subcommand == 'add'">
    <action>Parse: `"<title>" --epic <E?> [--tags t1,t2] [--why "..."] [--issue auto|skip]`.</action>

    <action>If `--epic` omitted, ask which epic (numbered list from {{sprint}}.epics).</action>

    <check if="--why not provided">
      <ask>Brief why? (one sentence)</ask>
    </check>
    <check if="ACs not provided in args">
      <ask>Acceptance criteria? One per line. Empty line to finish.</ask>
    </check>

    <action>Compute the next story id for this epic — **detect format from existing stories first**:
      1. Collect existing stories in this epic: `{{epic_stories}}` = stories where `epic == {{epic_id}}`.
      2. Determine `{{id_format}}`:
         - If `{{epic_stories}}` is non-empty: inspect the FIRST entry's id.
           - Matches `^E\d+-S\d+[a-z]?$` → format = `bmad` (e.g. `E1-S1`).
           - Matches `^E\d+-\d{3}$`        → format = `flow-native` (e.g. `E1-001`).
           - Anything else                  → HALT with "Unrecognized story-id format in epic {{epic_id}}: {{first.id}}. Fix sprint.yaml or pass --id-format=flow-native|bmad."
         - If `{{epic_stories}}` is empty: use `flow.config.yaml > sprint.default_id_format` (default `bmad` post-migration, `flow-native` for greenfield projects).
      3. Compute next numeric: `{{next_num}}` = max(parsed numeric part of each existing id) + 1; start at 1 for empty epics.
      4. Render `{{story_id}}` per format:
         - `bmad`         → `E{{epic_num}}-S{{next_num}}` (no zero-padding; e.g. `E1-S11`)
         - `flow-native`  → `E{{epic_num}}-{{next_num.toString().padStart(3, '0')}}` (e.g. `E1-011`)
    </action>

    <action>Generate filename: `{{stories_dir}}/{{story_id}}-{{slug(title)}}.md`.</action>

    <action>Render the story file from `templates/story.md.tmpl` with title, epic, tags, why, ACs.</action>

    <check if="{{issue_tracker_adapter}} != 'none' AND --issue != 'skip'">
      <action>Load adapter: `~/.claude/skills/flow-story/adapters/issue-tracker/{{issue_tracker_adapter}}.md`. Follow its `create_issue` operation with title + body. Capture returned `{issue_id, url}`.</action>
      <action>Update story file frontmatter: add `Issue: {{issue_id}}` line.</action>
    </check>

    <action>Append to `{{sprint}}.stories`:
      ```yaml
      - id: {{story_id}}
        title: "{{title}}"
        epic: {{epic_id}}
        issue: "{{issue_id or null}}"
        status: backlog
        tags: {{tags}}
        file: {{relative path to story md}}
      ```
    </action>

    <action>Write sprint.yaml.</action>
    <output>✓ Added {{story_id}} — {{title}}
       File:  {{file}}
       Issue: {{issue_id or "(none)"}}
       Run `/flow-sprint next` to start work.
    </output>
  </check>

  <check if="subcommand == 'next'">
    <action>Parse optional flags from args: `--epic <id>` (scope picker to one epic), `--include-offline` (don't skip stories where `kind == offline`), `--kind <code|offline>` (force pick by kind).</action>

    <action>Build the candidate set:
      1. Start from `{{sprint}}.stories` where `status == 'backlog'` (preserve YAML order).
      2. If `--epic` given, filter to that epic.
      3. **Filter out offline stories by default:** drop entries where `kind == 'offline'` UNLESS `--include-offline` or `--kind offline` was passed.
      4. → `{{candidates}}`.
    </action>

    <check if="{{candidates}} is empty">
      <action>Check whether there ARE offline stories that were filtered out. If yes, surface them as a hint.</action>
      <output>📭 No code stories in backlog{{epic_scope_suffix}}.

      {{ if filtered_offline > 0: }}{{filtered_offline}} offline-tagged story(ies) skipped. Run with `--include-offline` to pick one, or:
        - `/flow-sprint next --include-offline` — include offline stories in the candidate pool
        - `/flow-sprint done <id> --kind offline` — close an offline story directly (no branch, no PR)
        - `/flow-sprint add "<title>" --epic E? --tags ...` — add a new story
      {{ else: }}Add a story with `/flow-sprint add` or run `/flow-sprint status` to see what's left.{{ /if }}
      </output>
      <action>End turn.</action>
    </check>

    <action>Pick the first entry in `{{candidates}}` → `{{story}}`.</action>

    <check if="any story has status == 'doing'">
      <output>⚠ Another story is already in 'doing': {{that_story.id}}. Finish or pause it first.</output>
      <ask>Continue anyway and put {{story.id}} alongside? [y/N] (only safe in team mode)</ask>
    </check>

    <action>Flip `{{story}}.status` to `doing`. Set `{{story}}.started_at` = today (ISO).</action>

    <check if="{{story.kind}} == 'offline'">
      <action>**Offline branch:** do NOT create a git branch. Skip the issue-tracker `transition_to_doing` call (offline stories typically have no linked issue). Write sprint.yaml. Emit:</action>
      <output>📌 Started {{story.id}} — {{story.title}}   *(kind: offline)*

         No branch created — this is meatspace work.
         When you've completed the task IRL, close it out:
           `/flow-sprint done {{story.id}}`
      </output>
      <action>End turn — flow-story has nothing to do for offline stories.</action>
    </check>

    <action>**Code branch (default):** Create + checkout `git checkout -b flow/{{story.id}}-{{slug(title)}}` (or `{{issue_id}}-...` if present and adapter prefers that format).</action>

    <action>Invoke issue-tracker adapter `transition_to_doing({{story.issue}})` if `{{issue_id}}` exists.</action>

    <action>Write sprint.yaml.</action>

    <output>📌 Started {{story.id}} — {{story.title}}

       Branch:  {{branch_name}}
       Story:   {{story.file}}
       Issue:   {{story.issue or "(none)"}}

       Next: `/flow-story` to drive implementation.
    </output>
  </check>

  <check if="subcommand == 'status'">
    <action>Group stories by epic. For each epic, show:
      - Epic header + progress count
      - Each story: status icon, id, title, issue (if any)
    </action>

    <action>Show open PRs (if `{{pr_adapter}}` != none): query GH for PRs matching `flow/*` branches.</action>
    <action>Show open deferred-work count (count non-resolved lines in `{{deferred_file}}`).</action>

    <action>**Midpoint check.** Compute `{{progress_pct}}` = done / (total - cancelled). Read `{{midpoint_threshold}}` from flow.config.yaml > sprint.midpoint_threshold (default 0.5). Read `{{midpoint_review_offered}}` from sprint.yaml > metadata.midpoint_review_offered (default false).</action>

    <check if="{{progress_pct}} >= {{midpoint_threshold}} AND NOT {{midpoint_review_offered}}">
      <output>🎯 Midpoint reached ({{done}}/{{total}} = {{progress_pct}}%). Worth a scope check?

      Open scope is a leading indicator of slip. A 5-min review now can save a lot at the back end.

      Run: `/flow-sprint scope-review` (or `--report-only` for just the report, no prompts).
      </output>
      <action>Set `sprint.yaml > metadata.midpoint_review_offered = true` so this prompt doesn't repeat.</action>
    </check>

    <output>📊 Sprint status

    {{ for each epic: }}
    Epic {{epic.id}} — {{epic.title}} ({{done}}/{{total}}) {{ ✓ if done==total }}
      {{ for each story: }}
      {{status_icon}} {{story.id}}  {{story.title}}{{ + " · " + issue if any}}

    Open PRs: {{count}}
    Open deferred: {{count}}
    </output>
  </check>

  <check if="subcommand == 'done'">
    <action>Parse: `<story-id>` [+ optional flags `--note "..."`, `--force`]. Look up story in {{sprint}}.</action>

    <check if="{{story.kind}} == 'offline'">
      <action>**Offline shortcut path** — no branch / PR / verify gates apply.
        1. Validate current status in `[backlog, doing]` (allow done-without-doing for backfilled offline work; halt only if already `done` or `cancelled`).
        2. Flip `{{story}}.status` → `done`. Set `{{story}}.completed_at` = today.
        3. If `--note` provided, append it to `{{story}}.notes` (one-line resolution summary, e.g. `"Office at Dubai Silicon Oasis, Building XYZ, Floor 3"`).
        4. Invoke issue-tracker adapter `transition_to_done({{story.issue}})` only if `{{story.issue}}` exists (typically offline stories have none).
        5. If story file exists, move to archive; else skip.
        6. Write sprint.yaml.
        7. Skip the `git checkout main && pull && branch -d` block — no branch was created.
      </action>
      <output>✓ {{story.id}} done   *(offline)*
         {{ if note: }}Note: {{note}}{{ /if }}
      </output>
      <action>Continue to epic-complete check at bottom of this subcommand, then end turn.</action>
    </check>

    <action>**Code path (default):**</action>
    <action>Validate current status is `review` (or `doing` if user passes `--force`).</action>

    <check if="story has issue AND {{pr_adapter}} != 'none'">
      <action>Verify PR is merged via adapter `verify_merged(issue_id)`. If not merged, HALT with "PR not merged yet — merge first, then re-run."</action>
    </check>

    <action>Flip `{{story}}.status` to `done`. Set `{{story}}.completed_at` = today.</action>
    <action>Invoke issue-tracker adapter `transition_to_done({{story.issue}})` to close the external issue.</action>

    <action>Move story file: `{{story.file}}` → `{{archive_dir}}/{{basename}}`. Update `{{story}}.file` to the new path.</action>

    <action>`git fetch --prune && git checkout main && git pull --ff-only && git branch -d flow/{{story.id}}-*`.</action>

    <action>Write sprint.yaml.</action>

    <action>Check epic completion: if all stories in this epic have status == 'done', set epic.status = done and emit a hint to run `/flow-sprint retro {{epic.id}}`.</action>

    <output>✓ {{story.id}} done. Archived to {{archive_dir}}.
       {{ if epic complete: }} 🎉 Epic {{epic.id}} complete — run `/flow-sprint retro {{epic.id}}`.
    </output>
  </check>

  <check if="subcommand == 'deferred'">
    <action>Read `{{deferred_file}}`. Parse lines (one entry per line, format: `- [<status>] <one-liner> · <source>`).</action>
    <output>Deferred items ({{open_count}} open):
      {{ list with line numbers + status }}
    Add new: append to {{deferred_file}}. Mark resolved: change `[ ]` → `[x]`.
    </output>
  </check>

  <check if="subcommand == 'retro'">
    <action>Parse: `<epic-id>` (default: most recently completed epic).</action>
    <action>Validate epic exists and has at least one done story.</action>

    <action>Gather inputs:
      - All story files in `{{archive_dir}}` matching this epic
      - `git log --oneline main` filtered to commits in this epic's date range (between first story's started_at and last story's completed_at)
      - Open deferred items tagged for this epic
    </action>

    <action>Render `{{retros_dir}}/{{epic.id}}-retro.md` from `templates/retro.md.tmpl`. Pre-fill: shipped count, cycle time avg, deferred carry-forward. Leave "What worked / What didn't / Carry into next epic" sections for the user to edit.</action>

    <output>✓ Retro draft written to {{retros_dir}}/{{epic.id}}-retro.md.
       Edit, commit, push.
    </output>
  </check>

  <check if="subcommand == 'import-bmad'">
    <action>Same migration logic as flow-init step 11. Useful if user skipped migration at install time.</action>
  </check>

  <check if="subcommand == 'scope-review'">
    <action>Parse optional flags: `--apply` (interactively apply suggestions), `--report-only` (write report, no prompts), `--threshold <pct>` (override 0.5 default for what counts as "midpoint"), `--include-prd` (also read PRD/architecture from reference_docs).</action>

    <action>Gather inputs for the audit agent:
      1. sprint.yaml — full epic + story list with status
      2. All story files under `{{stories_dir}}` AND `{{archive_dir}}` (recent + done)
      3. `{{deferred_file}}` — accumulated friction signals
      4. `{{retros_dir}}/*.md` — completed-epic retros
      5. Reference docs from `flow.config.yaml > reference_docs` — only if `--include-prd` (e.g. PRD, architecture, epics-stories.md from BMad)
      6. Recent git history: `git log --oneline -50 main` for done-context
    </action>

    <action>Spawn a background agent (Agent tool, run_in_background: true) with:
      - `subagent_type`: `general-purpose` (no specialized scope-audit agent in v0; could add later)
      - `description`: "Scope review of {{project_name}}"
      - `prompt`: a self-contained brief listing all inputs above and asking the agent to return a structured markdown report:

        ```
        # Scope Review — {{project_name}} — {{date}}

        ## Progress snapshot
        - {{done}}/{{total}} stories done ({{pct}}%)
        - {{N}} stories in backlog / doing / review
        - Time since first story: {{days}}
        - Deferred items open: {{open_count}}

        ## Proposed merges (overlapping stories)
        For each: source story-ids, suggested merged id + title, rationale (1 line)

        ## Proposed drops (no longer relevant / duplicates)
        For each: story-id, rationale referencing PRD or deferred ledger or retro

        ## Proposed splits (stories that grew too big)
        For each: story-id, proposed split into N new stories

        ## Proposed adds (gaps not covered)
        For each: epic, suggested new story-id + title, rationale

        ## Epics worth reconsidering
        Either consolidate / drop / split entire epics. Include rationale.

        ## Risks of NOT trimming
        One paragraph on what happens if scope stays as-is.
        ```

        Output ONLY the report. No preamble, no closing remarks.
    </action>

    <action>While the agent runs (in background), continue:
      1. Ensure `{{retros_dir}}/../scope-reviews/` exists (mkdir).
      2. Reserve filename `docs/flow/scope-reviews/{{YYYY-MM-DD}}.md`.
    </action>

    <action>When the agent returns (notification): write its report to the reserved filename.</action>

    <output>📋 Scope review report → docs/flow/scope-reviews/{{YYYY-MM-DD}}.md ({{N}} merges, {{M}} drops, {{K}} adds, {{L}} splits proposed).</output>

    <check if="--apply OR (default behavior, NOT --report-only)">
      <ask>Review suggestions interactively? [Y/n/later]</ask>
      <check if="user picks Y">
        <action>For each suggestion in the report (merge, drop, split, add) in that order:
          1. Show the suggestion + rationale.
          2. Ask `[a]pply / [s]kip / [m]odify / [q]uit`.
          3. If apply: mutate sprint.yaml accordingly. For merges, combine stories under one id, archive the absorbed ones with a "merged into <X>" note. For drops, set status to `cancelled` with a `cancelled_reason`. For splits, replace one entry with N new entries. For adds, append new entries with status `backlog`.
          4. If modify: collect user's edits to the proposed change, then apply.
        </action>
        <action>After all suggestions processed: write sprint.yaml, record `metadata.last_scope_review.applied_at` = today + summary counts.</action>
      </check>
      <check if="user picks later">
        <action>Record `metadata.last_scope_review.report_pending` = true + filename. User can run `/flow-sprint scope-review --apply-from <path>` later.</action>
      </check>
    </check>

    <action>Record in sprint.yaml `metadata.scope_reviews[]`: {date, suggested_counts, applied_counts, report_path}.</action>
  </check>

  <check if="subcommand not recognized">
    <output>Unknown subcommand: {{subcommand}}.
       Try: init | add-epic | add | next | status | done | deferred | retro | import-bmad
    </output>
  </check>
</step>

</workflow>

---

## sprint.yaml schema (canonical)

```yaml
version: 1
project: <name>
generated: <ISO date>
last_updated: <ISO timestamp>

epics:
  - id: E1
    title: "Foundation"
    status: backlog | in-progress | done

stories:
  - id: E1-001                              # ^E\d+-\d{3}$
    title: "Tokens + base layout"
    epic: E1
    issue: "#42" | "PLA-15" | null
    status: backlog | doing | review | done | cancelled
    tags: [ui, foundation]
    file: docs/flow/stories/E1-001-tokens-base-layout.md
    started_at: 2026-05-18           # only when status >= doing
    completed_at: 2026-05-19          # only when status == done
```

Comments are preserved on write. Unknown top-level keys are preserved (forward-compat).
