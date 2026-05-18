# flow-sprint Workflow

**Goal:** maintain sprint state in `docs/flow/sprint.yaml`. Stories are the unit of work; epics group them; status flows backlog → doing → review → done. Every status change also invokes the active issue-tracker adapter to keep external state in sync.

**Schema invariants** (validated on every write):
- `stories[].id` matches `^E\d+-\d{3}$` (e.g. `E1-001`)
- `stories[].status` in `[backlog, doing, review, done, cancelled]`
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

  <action>If `flow.config.yaml` is missing, HALT with "Flow not installed in this project — run /flow init first."</action>

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

    <action>Compute next story number for this epic: max(stories where epic == {{epic_id}}).id_num + 1, zero-padded to 3 (e.g. `E1-002`). → `{{story_id}}`.</action>

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
    <action>Find the first story in `{{sprint}}.stories` where status == 'backlog' (preserve YAML order). → `{{story}}`.</action>
    <check if="no such story">
      <output>📭 No backlog stories. Run `/flow-sprint status` to see what's left, or `/flow-sprint add` to create one.</output>
      <action>End turn.</action>
    </check>

    <check if="any story has status == 'doing'">
      <output>⚠ Another story is already in 'doing': {{that_story.id}}. Finish or pause it first.</output>
      <ask>Continue anyway and put {{story.id}} alongside? [y/N] (only safe in team mode)</ask>
    </check>

    <action>Flip `{{story}}.status` to `doing`. Set `{{story}}.started_at` = today (ISO).</action>

    <action>Create + checkout branch: `git checkout -b flow/{{story.id}}-{{slug(title)}}` (or `{{issue_id}}-...` if present and adapter prefers that format).</action>

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
    <action>Parse: `<story-id>`. Look up story in {{sprint}}.</action>
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
