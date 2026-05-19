# flow-doctor — health check

<workflow>

<step n="1" goal="Locate the catalog and existing state">
  <action>Resolve `{{repo_root}}`:
    - If env `FLOW_REPO_ROOT` is set, use it.
    - Else if running from `~/.claude/skills/flow-doctor/`, walk up to find a directory containing `catalog.yaml`.
    - Else if the CWD contains `catalog.yaml`, use the CWD (dev mode).
    - Else record `catalog: ✗ not found` and continue with reduced checks.
  </action>

  <action>Read `{{home_state}}` from `$HOME/.claude/flow/install-state.json` if it exists.</action>
  <action>Read `{{project_state}}` from `$CWD/.claude/flow/install-state.json` if it exists.</action>
  <action>Read `{{flow_config}}` from `$CWD/flow.config.yaml` if it exists.</action>
  <action>Parse `--fix`, `--mcp <id>`, `--json`, `--verbose` from args.</action>
</step>

<step n="2" goal="Catalog + schema integrity">
  <action>Probe:
    - `{{repo_root}}/catalog.yaml` exists and parses as YAML → `catalog.parse`
    - `{{repo_root}}/schemas/catalog.schema.json` exists → `catalog.schema_present`
    - If schema present, validate catalog against it → `catalog.schema_valid`
  </action>
</step>

<step n="3" goal="State integrity">
  <action>Probe:
    - `home_state` JSON parses, schema version starts with `flow.install.v` → `state.home_parse`
    - `project_state` JSON parses, schema version starts with `flow.install.v` → `state.project_parse`
    - `flow.config.yaml` parses, has at least `profile` + `adapters` keys → `state.config_parse`
  </action>
</step>

<step n="4" goal="Adapter wiring">
  <action>For each adapter referenced in `flow.config.yaml.adapters` (one per family: issue-tracker, pr, e2e, verify):
    - Verify the adapter file exists at `{{repo_root}}/adapters/<family>/<adapter-id>.md` → `adapter.<family>.file`
    - Verify any project-side symlink in `.claude/flow/adapters/` resolves → `adapter.<family>.symlink`
  </action>
</step>

<step n="5" goal="MCP reachability">
  <action>Run `claude mcp list` (capture output; if `claude` CLI missing, record `mcp.cli_present: ✗` and skip).</action>
  <action>For each MCP recorded in `home_state.mcps` (or `project_state.mcps`), verify it appears in `claude mcp list` output → `mcp.<id>.registered`.</action>
  <action>If `--mcp <id>` passed, deep-probe only that MCP (attempt a no-op tool call) → `mcp.<id>.responding`.</action>
</step>

<step n="6" goal="Required CLIs">
  <action>For each adapter, check its declared CLI deps (from `catalog.yaml.adapters.<family>.<id>.requires_cli`):
    - `which <cli>` → record presence
    - If missing, record `cli.<name>: ✗ not in $PATH`
  </action>
</step>

<step n="7" goal="Upstream installers">
  <action>Probe each declared upstream:
    - **BMad:** `test -d _bmad` OR `test -d docs/_bmad-output` → `upstream.bmad.present`. If present, parse `_bmad/_config/manifest.yaml` for version.
    - **ECC:** check for `~/.claude/rules/common/` and `~/.claude/skills/<known-ecc-skill>` presence → `upstream.ecc.present`. Read recorded ECC profile from `home_state.upstreams.ecc.profile`.
    - **Caveman:** check `~/.claude/skills/caveman/` and `~/.claude/skills/caveman-shrink/` → `upstream.caveman.present`.
  </action>
</step>

<step n="8" goal="Known-bug probes">
  <action>**caveman-shrink standalone-vs-wrapper probe** (issue #5): caveman-shrink is an MCP **proxy** — it must be invoked with an upstream command to wrap (e.g., `npx caveman-shrink npx @upstash/context7-mcp@latest`). Registering it standalone (no upstream args) crashes immediately with `-32000` because `index.js` exits at "missing upstream command".
    - Run `claude mcp get caveman-shrink 2>/dev/null` to fetch the registration. If absent, record `caveman_shrink.registered: ℹ not registered` and skip.
    - Parse the command line. A correctly-wrapped registration has at least 3 tokens **after** the `caveman-shrink` invocation (e.g., `npx caveman-shrink npx <pkg>` → 2+ tokens after `caveman-shrink`).
    - A standalone (broken) registration has 0 tokens after `caveman-shrink` and will return `-32000` on first call. Record `bug.caveman_shrink_standalone: ⚠ caveman-shrink registered without upstream — will fail with -32000`.
    - With `--fix`, re-register by running `{{repo_root}}/tools/fix-caveman-shrink.sh <upstream-name>` (default upstream: `context7`). Script prints the exact `claude mcp remove` + `claude mcp add` commands; user runs them.
  </action>

  <action>**Severity-label preservation probe** (issue #6):
    - If `caveman:caveman-review` skill is installed, check whether the most-recent `## Review Notes` blocks in `docs/flow/stories/*.md` retain `CRITICAL` / `HIGH` / `MEDIUM` / `LOW` literal labels.
    - If recent compressed review notes are missing any severity label, record `bug.severity_labels_stripped: ⚠`.
  </action>

  <action>**Plan/Verified/Review-Notes loose-match probe** (issue #10):
    - For each story in `docs/flow/stories/*.md`, run `grep -c '^## Plan$'` (anchored, exact). Compare to `grep -c '^## Plan'` (loose). If counts differ, record `bug.plan_marker_loose: ⚠ <story-id>`.
  </action>
</step>

<step n="9" goal="Render report">
  <output>━━━ flow doctor ━━━

  Catalog:    {{catalog.parse ? ✓ : ✗}}  ({{catalog.path}})
  Schemas:    {{catalog.schema_valid ? ✓ : (catalog.schema_present ? ⚠ invalid : ℹ not present)}}

  State:
    Home:     {{state.home_parse ? ✓ : ✗}}  ({{home_state.path}})
    Project:  {{state.project_parse ? ✓ : ✗}}  ({{project_state.path}})
    Config:   {{state.config_parse ? ✓ : ✗}}

  Adapters:
    {{ for each family: "<family>: <adapter-id> <✓|⚠|✗>" }}

  MCPs:
    {{ for each mcp: "<id>: <✓ registered|⚠ not responding|✗ missing>" }}

  CLIs:
    {{ for each cli: "<name>: <✓|✗ not in $PATH>" }}

  Upstreams:
    BMad:     {{upstream.bmad.present ? ✓ : ℹ not installed}}  {{version}}
    ECC:      {{upstream.ecc.present ? ✓ : ℹ not installed}}   {{profile}}
    Caveman:  {{upstream.caveman.present ? ✓ : ℹ not installed}}

  Known-bug probes:
    {{ for each probe: "<name>: <✓ clean|⚠ flagged: <fix-hint>>" }}

  Summary: {{n_ok}} ✓ · {{n_warn}} ⚠ · {{n_fail}} ✗
  </output>
</step>

<step n="10" goal="Auto-repair (only if --fix)">
  <check if="--fix AND bug.caveman_shrink_standalone == ⚠">
    <output>🔧 Re-registering caveman-shrink as a wrapper…</output>
    <action>Invoke `{{repo_root}}/tools/fix-caveman-shrink.sh ${args.shrink_upstream || 'context7'}`. Script prints the `claude mcp remove caveman-shrink` and `claude mcp add ...` commands. Print the exact commands; do NOT auto-run them (modifying MCP registration without user consent is a side-effect on every Claude Code session).</action>
  </check>

  <check if="--fix AND any adapter.<family>.symlink == ✗">
    <action>Re-create the missing symlink(s) from `{{repo_root}}/adapters/<family>/<id>.md` → `$CWD/.claude/flow/adapters/<family>.md`.</action>
  </check>

  <check if="--fix AND state.home_parse == ✗ AND home_state file exists but invalid">
    <action>Move the broken file to `<path>.broken.<timestamp>`, write a fresh empty state with current schema version, print "Re-run /flow-init to re-populate."</action>
  </check>
</step>

</workflow>

---

## Handling failures

- **catalog.yaml missing entirely:** Doctor still runs reduced checks (state + config + MCPs + CLIs) and prints `Run /flow-init` at the bottom.
- **`claude` CLI missing:** All MCP checks skip with `mcp.cli_present: ✗`. Doctor itself still completes.
- **`--fix` makes things worse:** Every fix logs to `~/.claude/flow/doctor.log` with a timestamp + before/after. The user can restore the pre-fix state manually from `<path>.broken.<timestamp>` snapshots.

## Exit codes (when invoked via `bin/flow.js doctor`)

- `0` — all ✓ or only ℹ
- `1` — at least one ⚠
- `2` — at least one ✗
