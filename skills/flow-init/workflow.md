# flow-init Workflow

**Output style — Caveman mandate.** All user-facing output from this workflow (status banners, prompts, error messages, plan tables, smoke-test results) MUST be Caveman-mode: fragments OK, drop articles / filler / pleasantries / hedging, keep code & commit & security text normal. If `caveman` skill registered, prefer phrasing that mirrors its style. Examples:
  - "📦 Installing Caveman…" not "I'll go ahead and install Caveman now if that's okay with you."
  - "✓ 7 skills · 6 hooks · 1 MCP" not "Caveman was successfully installed with seven skills, six hooks, and one MCP server."
  - "✗ verify exit 1. Run `make verify` directly." not "Unfortunately the verification step failed; you might want to try running make verify directly to investigate."

**Goal:** install Flow into a project (and globally where needed), delegating to upstream installers for BMad and ECC, configuring MCP servers, scaffolding `docs/flow/`, and recording everything in `install-state.json` so `repair`, `update`, and `uninstall` work later.

**Authority:** the catalog at `catalog.yaml` is the single source of truth for available components, profiles, adapters, MCPs, and upstream presets. This workflow reads it; it does not duplicate its contents.

**Idempotency:** re-running `/flow-init` on a project that's already configured re-reads `install-state.json`, presents the current state, and offers `--update` or `--repair` rather than reinstalling blindly.

---

<workflow>

<step n="1" goal="Locate the catalog and existing state">
  <action>Resolve `{{repo_root}}`:
    - If env `FLOW_REPO_ROOT` is set, use it.
    - Else if running from `~/.claude/skills/flow-init/`, walk up to find a directory containing `catalog.yaml` (npm install path is typically `~/.npm-global/lib/node_modules/@mhd-ghaith-abtah/flow/`).
    - Else if the CWD contains `catalog.yaml`, use the CWD (dev mode).
    - Else HALT with "catalog.yaml not found — re-install Flow (clone https://github.com/mhd-ghaith-abtah/flow and run `tools/dev-link.sh`, or wait for npm v0.7).".
  </action>

  <action>Load `{{catalog}}` from `{{repo_root}}/catalog.yaml`. Validate against `{{repo_root}}/schemas/catalog.schema.json` if present.</action>

  <action>Determine scopes:
    - `{{home_scope_root}}` = `$HOME/.claude`
    - `{{project_scope_root}}` = `$CWD/.claude`
  </action>

  <action>Read `{{home_state}}` from `{{home_scope_root}}/flow/install-state.json` if it exists, else initialize empty.</action>
  <action>Read `{{project_state}}` from `{{project_scope_root}}/flow/install-state.json` if it exists, else initialize empty.</action>
</step>

<step n="2" goal="Detect project shape">
  <action>Probe in parallel:
    - Git: `git rev-parse --show-toplevel 2>/dev/null` → `{{git_root}}`
    - Remote: `git remote get-url origin 2>/dev/null` → `{{origin_url}}`
    - Package manager: presence of `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `Cargo.toml`, `go.mod`, `requirements.txt`, etc. → `{{pkg_manager}}` + `{{primary_stack}}`
    - Framework: scan `package.json` dependencies for next, astro, react, vue, svelte, etc. → `{{framework}}`
    - CLAUDE.md presence: `{{has_claude_md}}`
    - BMad: `test -d _bmad` or `test -d docs/_bmad-output` → `{{bmad_installed}}` (parse `_bmad/_config/manifest.yaml` for version if present)
    - ECC: `test -d ~/.claude/rules/common` → `{{ecc_installed}}` (read `~/.claude/rules/VERSION` if present)
    - MCPs already installed: `claude mcp list` → `{{existing_mcps}}` (list of names)
    - CLIs available: probe `git`, `gh`, `glab`, `jq`, `yq`, `make`, `pnpm`, `npm`, `yarn` → `{{available_clis}}`
    - Existing Flow install (this project): presence of `.claude/flow.config.yaml` → `{{flow_already_configured}}`
  </action>

  <output>━━━ Detected ━━━
  - Project: {{git_root or CWD}}
  - Stack: {{primary_stack}}{{ + framework if any}}
  - Package manager: {{pkg_manager}}
  - BMad: {{bmad_installed ? version : "not installed"}}
  - ECC: {{ecc_installed ? version : "not installed"}}
  - MCPs: {{existing_mcps.join(", ") or "none"}}
  - CLAUDE.md: {{has_claude_md ? "present" : "missing"}}
  - Flow: {{flow_already_configured ? "already configured" : "first install"}}
  </output>
</step>

<step n="3" goal="Branch on existing install vs first-time">
  <check if="{{flow_already_configured}} AND no --update AND no --repair flag passed">
    <output>⚠  Flow is already configured in this project (`{{project_scope_root}}/flow.config.yaml` exists).</output>
    <ask>What would you like to do?
      [1] Show status and exit
      [2] Run --update (re-resolve catalog, install delta)
      [3] Run --repair (restore missing files from catalog)
      [4] Re-run init from scratch (will not lose flow.config.yaml or sprint.yaml)
      [q] Quit
    </ask>
    <action>Branch on user choice. For [1] delegate to `flow-status` skill (or print the state file contents). For [2] set `{{mode}} = update`. For [3] set `{{mode}} = repair`. For [4] set `{{mode}} = fresh`. For [q] HALT.</action>
  </check>
  <action>Default: `{{mode}} = fresh` for new installs, `update`/`repair` if flag passed.</action>
</step>

<step n="4" goal="Profile + customization Q&A">
  <ask>Q1 — Profile? (matches `catalog.profiles`)
    Recommended based on detection: {{ recommended_profile derived from: solo + 1 repo + has Makefile → standard; multi-repo or planinout-like → team; else mini }}
    Options: minimal | mini | standard | team
  </ask>

  <ask>Q2 — Issue tracker?
    Options for adapters in family `issue-tracker`: {{ catalog.adapters where family == issue-tracker }}
    Default for {{profile}}: {{profile.adapters of family issue-tracker}}
  </ask>

  <ask>Q3 — PR platform?  (adapters family `pr`)</ask>
  <ask>Q4 — E2E?           (adapters family `e2e`)</ask>
  <ask>Q5 — Verify command? (adapters family `verify`)</ask>

  <ask>Q6 — BMad?
    Options: {{ catalog.upstreams.bmad.curated_subsets keys }}
    Default for {{profile}}: {{profile.bmad_subset}}
  </ask>

  <ask>Q7 — ECC?
    Options: {{ catalog.upstreams.ecc.curated_subsets keys }}
    Default for {{profile}}: {{profile.ecc_subset}}
  </ask>

  <ask>Q7b — Caveman compression mode? (Flow expects Caveman installed — it cuts response tokens ~46% input / ~75% output)
    Options: {{ catalog.upstreams.caveman.curated_subsets keys }}
    Default for {{profile}}: {{profile.caveman_subset}}  (typically `full`)
    Choose `none` only if you have a specific reason. If Caveman isn't installed, Flow will offer to install it via curl-pipe-bash with a confirmation prompt.
  </ask>

  <check if="{{bmad_installed}} AND {{project has docs/_bmad-output/implementation-artifacts/sprint-status.yaml}}">
    <ask>Q8 — Migrate existing BMad state to Flow?
      [y] Import sprint-status.yaml + story files + deferred-work into docs/flow/, archive _bmad/
      [n] Keep BMad alongside (Flow reads BMad sprint-status as fallback)
      [skip] Don't touch BMad state
    </ask>
  </check>

  <ask>Q9 — Where should Flow store secrets (API tokens for env-var-auth MCPs)?
    [a] ~/.claude/.env.flow (gitignored, chmod 600)   [recommended]
    [b] I'll set env vars in my shell profile myself — just print the export lines
    [c] 1Password CLI (`op`) — detected: {{ test -x op ? "yes" : "no" }}
  </ask>
</step>

<step n="5" goal="Resolve the plan">
  <action>Compute `{{plan}}`:
    - Resolve profile inheritance (follow `extends:` chain in catalog)
    - Apply user's adapter overrides (Q2–Q5)
    - Resolve BMad delegation args (`{{bmad_cmd}}` = "npx bmad-method install" + base_args + module_arg + modules + config kvs)
    - Resolve ECC delegation args (`{{ecc_cmd}}` = "<installer_path>" + base_args + profile_arg + profile + with/without lists)
    - Resolve MCPs to install (union of `mcps` referenced by selected adapters + profile's mcps list, minus those already in `{{existing_mcps}}`)
    - Resolve CLIs to install (any `needs_cli` for selected adapters not in `{{available_clis}}`)
    - Resolve Flow's own components (always: core:flow-skills, core:flow-templates, core:flow-state-store)
  </action>

  <output>━━━ Plan ━━━
  Flow components:
    {{plan.flow_components — file copies, target paths}}
  Adapters:
    {{plan.adapters — markdown files to copy + their config keys}}
  BMad delegation:
    $ {{bmad_cmd}}
  ECC delegation:
    $ {{ecc_cmd}}
  MCPs to install:
    {{plan.mcps each: claude mcp add ... + scope + auth note}}
  CLIs missing (manual install required):
    {{plan.missing_clis with install hints from catalog}}
  Project scaffold:
    - .claude/flow.config.yaml
    - docs/flow/sprint.yaml
    - docs/flow/stories/, journeys/, retros/, archive/
    - docs/flow/deferred.md
    - docs/flow/README.md
    - CLAUDE.md (Workflow section)
  {{ if migrate_bmad: }}
  BMad migration:
    - sprint-status.yaml → sprint.yaml ({{N stories}})
    - deferred-work.md → deferred.md ({{N items}})
    - Archive _bmad/ → _bmad.archived/
  </output>

  <ask>Proceed? [Y/n/dry-run-only]</ask>
  <check if="user chose dry-run-only OR --dry-run was passed">
    <action>Save the plan as `{{project_scope_root}}/flow/install-plan.json`. End turn.</action>
  </check>
</step>

<step n="6" goal="Execute — Flow's own files">
  <action>For each operation in `{{plan.flow_components}}` AND `{{plan.adapters}}.ops`:
    - **Dev-mount detection (do this FIRST for every copy op):**
      1. Check whether `destinationPath` already exists as a symbolic link (`test -L "$destinationPath"`).
      2. If yes, resolve it: `readlink "$destinationPath"` → `{{resolved}}`.
      3. If `{{resolved}}` equals `sourcePath` (or matches `{{repo_root}}/...` for the source's relative form), this is a **dev-mount** placed by `tools/dev-link.sh`. SKIP the copy and record the op as `{ kind: "skip-dev-mount", destinationPath, resolves_to: resolved }` in state.
      4. If `{{resolved}}` is anywhere else, HALT with: "Unexpected symlink at {{destinationPath}} → {{resolved}}. Refusing to overwrite. Resolve manually or pass `--force-overwrite-symlinks`."
    - **Otherwise** (target is not a symlink, or doesn't exist):
      - copy-file / ensure-dir / touch as specified in the operation.
      - Record each operation in `{{home_state}}.operations` with sourcePath, destinationPath, moduleId, ownership: managed.
  </action>
  <output>✓ Installed {{N}} Flow files ({{skipped_count}} skipped — dev-mount detected, content already live)</output>
</step>

<step n="7" goal="Execute — delegate to BMad if requested">
  <check if="{{plan.bmad_subset}} != none">
    <action>Run `{{bmad_cmd}}` via execa (stream stdout/stderr live to user). Capture exit code.</action>
    <check if="exit code != 0">
      <output>⚠ BMad installer exited {{code}}. See output above. You can continue without BMad and re-run later.</output>
      <ask>Continue Flow install? [Y/n]</ask>
    </check>
    <action>**Pin upstream version** (issue #12). After install: read the version from the first existing path in `catalog.upstreams.bmad.detect.version_path_candidates` (typically `_bmad/_config/manifest.yaml` → `version` field). If unparseable, store the literal commit hash from `git -C _bmad rev-parse HEAD 2>/dev/null`; if neither available, store `"unknown@{{date}}"` so doctor can still detect drift.</action>
    <action>Record in `{{home_state}}.upstreams.bmad`: { subset, modules, exit_code, ran_at, version: <pinned-version> }</action>
  </check>
</step>

<step n="8" goal="Execute — delegate to ECC if requested">
  <check if="{{plan.ecc_subset}} != none">
    <action>Resolve `{{ecc_installer_path}}` from catalog.upstreams.ecc.detect.installer_path_candidates. If none found, fall back to `npx @everything-claude-code/ecc install`.</action>
    <action>Run `{{ecc_cmd}}` via execa (stream live). Capture exit code.</action>
    <action>**Pin upstream version** (issue #12). After install: read `~/.claude/rules/VERSION` (path from `catalog.upstreams.ecc.detect.version_path`). If absent, fall back to `git -C ~/.claude/rules log -1 --format=%H 2>/dev/null` or `"unknown@{{date}}"`.</action>
    <action>Record in `{{home_state}}.upstreams.ecc`: { subset, profile, exit_code, ran_at, version: <pinned-version> }</action>
  </check>
</step>

<step n="8b" goal="Execute — install Caveman (default: required for all profiles)">
  <check if="{{plan.caveman_subset}} != none">
    <action>Run detection: `{{catalog.upstreams.caveman.detect.check_cmd}}` → `{{caveman_present}}`.</action>

    <check if="{{caveman_present}} == true">
      <output>✓ Caveman already installed — leaving in place.</output>
      <action>**Pin upstream version** (issue #12). Read Caveman's installed version: try `cat ~/.claude/plugins/cache/caveman/caveman/*/package.json | jq -r .version 2>/dev/null` then `cat ~/.claude/skills/caveman/SKILL.md | grep -oE 'version: [0-9.]+' | head -1` then fall back to `"unknown@{{date}}"`.</action>
      <action>Record in `{{home_state}}.upstreams.caveman`: { subset, mode, installed: pre-existing, ran_at, version: <pinned-version> }.</action>
    </check>

    <check if="{{caveman_present}} == false">
      <output>📦 Caveman not detected. About to install via npx-from-fork:

      $ {{catalog.upstreams.caveman.installer.cmd}}

      Caveman is an output-compression layer ({{plan.caveman_subset}} mode). It modifies all Claude Code sessions globally to cut response tokens.

      Source (temporary fork): {{catalog.upstreams.caveman.repo}}
      Upstream: {{catalog.upstreams.caveman.upstream_repo}}
      Fork status: {{catalog.upstreams.caveman.fork_status}}
      Tracking PR: {{catalog.upstreams.caveman.upstream_pr}}

      The fork applies project-scope gating patches from PR #407 on top of upstream main. Flow will swap back to upstream once #407 merges.
      </output>

      <check if="$FLOW_INSPECT_INSTALL_SCRIPTS == 1">
        <action>Download the script to `/tmp/caveman-install.sh` first. Compute + print:
          - File path
          - `wc -l` count
          - SHA-256: `shasum -a 256 /tmp/caveman-install.sh | cut -d' ' -f1`

          This lets the user cross-check the hash against a known-good value before running.
          Ask "Inspect? [Y/n]" — if Y, print the file. Then ask "Run? [Y/n]".
        </action>
      </check>
      <check if="$FLOW_INSPECT_INSTALL_SCRIPTS != 1 AND NOT --yes">
        <ask>Run the curl-pipe-bash install? [Y/n/inspect]</ask>
        <check if="user picks inspect">
          <action>Switch behavior to download-first (as if $FLOW_INSPECT_INSTALL_SCRIPTS=1). Re-ask.</action>
        </check>
      </check>

      <action>Execute the install command via Bash. Stream output. Capture exit code.</action>
      <action>Verify install: run `{{catalog.upstreams.caveman.installer.verify_after_cmd}}`. If it fails, HALT with "Caveman installer reported success but verification failed. Check {{path}}".</action>

      <action>Set Caveman mode to `{{plan.caveman_mode}}` (from the chosen subset). Caveman's install script may handle this; if not, document the post-install command the user should run (e.g. `/caveman full`).</action>

      <action>**Pin upstream version** (issue #12). Read Caveman's installed version (same resolution chain as the pre-existing branch above). If install was successful but version can't be read, store `"installed-{{date}}"`.</action>
      <action>Record in `{{home_state}}.upstreams.caveman`: { subset, mode, installed_at, source: "npx-from-fork", repo, fork_tag: "flow-pin-v0.1", upstream_pr: 407, exit_code, version: <pinned-version> }.</action>
    </check>

    <!-- Project-scope opt-in (issue #9 follow-up). Flow installs Caveman from
         a temporary fork (github:mhd-ghaith-abtah/caveman#flow-pin-v0.1) that
         carries the project-scope gating patches from JuliusBrussee/caveman#407
         applied on top of upstream main. The fork exists because upstream has a
         ~134-PR backlog and ~5 merges/month — #407 would block Flow for months.
         When #407 merges upstream we swap catalog.yaml back and delete the fork
         (see catalog.yaml SWAP PLAN comment). The .caveman-enable marker Flow
         drops here works identically against upstream and the fork — both honor
         the marker, so swapping packages is a no-op at the project level. -->
    <action>Drop `.caveman-enable` marker (zero-byte file) in the project root if not already present. This makes the project's intent explicit: "caveman ON here regardless of global default". Useful for teams where some developers run Caveman in only-Flow-projects allowlist mode.</action>
  </check>

  <check if="{{plan.caveman_subset}} == none">
    <output>⚠ Caveman skipped via explicit `none` subset. Flow's outputs may consume more tokens than expected. To re-enable later: `/flow init --update` and pick a caveman_subset.</output>
  </check>
</step>

<step n="9" goal="Execute — install MCPs">
  <action>For each MCP in `{{plan.mcps}}`:
    1. Run `{{mcp.install_cmd}}` (typically `claude mcp add <name> npx <package>`). Stream output.
    2. If `{{mcp.auth}} == api_token`:
       - For each env var in `{{mcp.env}}`:
         - Prompt user (mask if `secret: true`)
         - Append to chosen secrets store (`.env.flow` / shell-profile-instructions / 1Password)
    3. If `{{mcp.auth}} == oauth_browser`:
       - Print `{{mcp.auth_instructions}}` verbatim
       - Mark in state: `auth: pending`
    4. Verify reachable: re-run `claude mcp list` and confirm the MCP appears.
    5. Record in `{{home_state}}.mcps[mcp.id]`.
  </action>

  <action>For each MCP runtime_dep (e.g., Playwright Chromium download), run the install_cmd in the project root.</action>
</step>

<step n="10" goal="Scaffold project files">
  <action>Write `{{project_scope_root}}/flow.config.yaml` from `{{repo_root}}/templates/flow.config.yaml.tmpl`, filling in:
    - mode = {{profile}}
    - active adapters = {{user's picks}}
    - integrations = config keys collected from selected adapters
    - secrets_store choice from Q9
  </action>

  <action>Create directories: `docs/flow/{stories,journeys,retros,archive}`.</action>
  <action>Write `docs/flow/sprint.yaml` from `{{repo_root}}/templates/sprint.yaml.tmpl` (empty stories list).</action>
  <action>Write `docs/flow/deferred.md` (empty header).</action>
  <action>Write `docs/flow/README.md` from `{{repo_root}}/templates/flow-readme.md.tmpl`.</action>

  <check if="{{has_claude_md}}">
    <action>Append the Flow Workflow section from `{{repo_root}}/templates/claude-md-section.md.tmpl` to `CLAUDE.md`, marked with `<!-- flow-managed:begin -->` / `<!-- flow-managed:end -->` so future updates can replace cleanly.</action>
  </check>
  <check if="NOT {{has_claude_md}}">
    <action>Write a minimal `CLAUDE.md` that includes the Flow section + a TODO marker for project-specific guidance.</action>
  </check>
</step>

<step n="11" goal="Migrate BMad state if user opted in (Q8)">
  <check if="user answered yes to Q8">
    <!-- Backup + rollback (issue #19). Stage backups before ANY write so the
         user can restore if the migration produces a malformed sprint.yaml. -->
    <action>**Backup before migration.** Set `{{backup_ts}}` = `date -u +%Y%m%dT%H%M%SZ`. Copy:
      - `docs/_bmad-output/implementation-artifacts/sprint-status.yaml` → `docs/_bmad-output/implementation-artifacts/sprint-status.yaml.flow-backup-{{backup_ts}}`
      - `docs/_bmad-output/implementation-artifacts/deferred-work.md` → `…/deferred-work.md.flow-backup-{{backup_ts}}` (if present)
      - Any pre-existing `docs/flow/sprint.yaml` → `docs/flow/sprint.yaml.flow-backup-{{backup_ts}}` (if Flow is re-migrating into a non-empty target)

      Record the backup paths in `{{project_state}}.migrations.bmad.backups = [<path>, …]`. If any copy fails, HALT — do NOT proceed with the migration.
    </action>

    <action>Read `docs/_bmad-output/implementation-artifacts/sprint-status.yaml`. For each story key matching `e\d+-s\d+-...`:
      - Parse epic + story number + title
      - Map BMad status → Flow status (backlog→backlog, ready-for-dev→backlog, in-progress→doing, review→review, done→done)
      - Append entry to `docs/flow/sprint.yaml` under `stories:`
      - Generate `docs/flow/stories/E{N}-S{M}-{title}.md` stub using `{{repo_root}}/templates/story.md.tmpl`, prefilling title + epic + sprint-status
    </action>

    <action>**Validate the produced sprint.yaml.** Parse it; if the parse fails OR the produced file has zero stories when the source had non-zero, treat the migration as failed → restore each backed-up file from its `.flow-backup-{{backup_ts}}` snapshot, delete the produced files, and HALT with the parse error. The user can fix sprint-status.yaml and re-run `flow-init --update --migrate-bmad`.</action>

    <action>Read `docs/_bmad-output/implementation-artifacts/deferred-work.md`. For each non-folded entry, append a one-line summary to `docs/flow/deferred.md`.</action>

    <action>**Do NOT rename or remove `_bmad/`.** Leave it in place so BMad slash commands keep working in this project (the global `bmad-*` skills resolve `_bmad/scripts/...` paths relative to project root). Flow ignores it. The user can archive manually later via `mv _bmad _bmad.archived` once they're sure they're done with BMad in this project, or run `flow uninstall --archive-bmad` in v0.2+.</action>

    <action>Keep `docs/_bmad-output/planning-artifacts/` in place as reference docs (Flow's `flow.config.yaml > reference_docs` points at it).</action>

    <action>Record migration in `{{project_state}}.migrations.bmad`: { from_version, stories_imported, deferred_imported, bmad_kept_in_place: true, backups: [<paths>], backup_ts: {{backup_ts}} }</action>

    <output>✓ Migration complete.

    Backups staged at `*.flow-backup-{{backup_ts}}` next to the original BMad files. To roll back:

      rm -rf docs/flow/
      git checkout flow.config.yaml      # if it was new
      mv docs/_bmad-output/implementation-artifacts/sprint-status.yaml.flow-backup-{{backup_ts}} \
         docs/_bmad-output/implementation-artifacts/sprint-status.yaml

    Or run `flow uninstall --restore-backup {{backup_ts}}` once that command lands in v0.2.
    </output>
  </check>
</step>

<step n="11b" goal="Optional planning audit (post-migration)">
  <!-- If the migration brought in a non-trivial number of stories, offer to
       run a scope review immediately. Catches over-scoped epics-stories.md
       early — before the user is committed to executing 40+ stories. -->
  <check if="migrated_stories_count > 10">
    <output>📋 Migrated {{migrated_stories_count}} stories across {{migrated_epics_count}} epics from BMad.

    That's a lot of scope. Before you start executing, worth a 5-min scope review? It reads sprint.yaml + story files + PRD/architecture (if present in reference_docs) and proposes merges / drops / splits / adds.

    Output: `docs/flow/scope-reviews/{{date}}.md` — review then apply interactively.
    </output>
    <ask>Run scope review now? [Y/n/later]
      Y      → invoke `/flow-sprint scope-review --include-prd` immediately
      n      → skip; you can still run it any time
      later  → record a midpoint reminder so /flow-sprint status prompts you again at 50% done
    </ask>

    <check if="user picks Y">
      <action>Invoke `flow-sprint` skill via Skill tool with arg `scope-review --include-prd`. The user will iterate through suggestions interactively per that skill's flow.</action>
    </check>
    <check if="user picks later">
      <action>Set `docs/flow/sprint.yaml > metadata.scope_review_pending = true` (defaults the midpoint prompt to "high signal" so it surfaces more prominently when reached).</action>
    </check>
  </check>
</step>

<step n="12" goal="Persist state">
  <action>Write `{{home_state}}` to `{{home_scope_root}}/flow/install-state.json` (pretty JSON, schema version `flow.install.v1`).</action>
  <action>Write `{{project_state}}` to `{{project_scope_root}}/flow/install-state.json`.</action>
  <action>Ensure `{{project_scope_root}}/flow/install-state.json` is in `.gitignore` (don't commit secrets references).</action>
  <action>Ensure `flow.config.local.yaml` is in `.gitignore` (per-developer override of `flow.config.yaml`; the base config IS committed for team-share, the local override is not).</action>
  <action>Ensure `~/.claude/.env.flow` has `chmod 600` if it was created in Q9.</action>
</step>

<step n="13" goal="Smoke test (flow doctor inline)">
  <action>Invoke the doctor checklist:
    - All selected adapter files present at expected paths
    - All selected MCPs reachable (`claude mcp list`)
    - All required CLIs in $PATH
    - flow.config.yaml validates against schema
    - sprint.yaml parses
    - Secrets file readable if used
    - BMad / ECC paths recorded match what's actually installed
  </action>
  <output>━━━ Smoke ━━━
  {{table of checks with ✓ / ✗}}
  </output>
</step>

<step n="14" goal="Done">
  <output>🎯 Flow installed.

  Profile:  {{profile}}
  Adapters: {{summary}}
  MCPs:     {{installed mcps}}
  {{ if any auth: pending: "Action required: complete OAuth for {{mcps}} (instructions printed above)." }}

  Next steps:
    /flow-sprint add "<title>" --epic E1 --tags <list>     # add a story
    /flow-sprint status                                    # show sprint
    /flow-sprint next                                      # start work on the next backlog story
    /flow-story                                            # advance the active story
    flow doctor                                            # health check anytime
  </output>
</step>

</workflow>

---

## Handling failures

- **BMad installer fails:** the user can re-run `flow install --profile <p> --bmad-subset <s>` once the upstream issue is fixed. Flow records the attempted command in state so the user can re-paste it.
- **ECC installer fails:** same — `flow install --profile <p> --ecc-subset <s>` is the re-run.
- **MCP install fails (network, package not found):** Flow halts the MCP phase, records the failure, lets the user pick a different adapter (e.g., issue-tracker-none instead of linear) and re-runs install.
- **Migration parser fails on BMad sprint-status.yaml:** Flow falls back to "no migration" mode and prints the parse error so the user can fix the YAML and re-run with `--migrate-bmad`.
- **CLAUDE.md append collision (existing flow-managed block):** Flow refuses to silently overwrite; emits a diff and asks the user to confirm.
