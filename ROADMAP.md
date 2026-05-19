# Flow roadmap

> Working document. Updates as we learn. Last revised 2026-05-19.

This roadmap captures Flow's planned arc from v0.7.2-beta.0 (current) through v0.9. It is **prescriptive about order and effort**, **descriptive about uncertainty**, and **explicit about what we will not build until demand surfaces.**

The sprint working-list lives in `docs/flow/sprint.yaml`. This file is the longer arc.

---

## Status (2026-05-19)

| Layer | State |
|---|---|
| npm package | `@mhd-ghaith-abtah/flow@0.7.2-beta.0` published, beta tag |
| Tag | `v0.7.2-beta.0` on `main` |
| CI | green (test on Node 20+22, smoke on 4 profiles, shellcheck, changelog lint) |
| Tests | 51 / 51 |
| Issues from v0.6.1 review handoff | 28 / 28 closed |
| Post-review followups | E5-005, E5-006, E5-007, E5-009 done; E5-010 deferred |
| Upstream PRs in flight | [JuliusBrussee/caveman#407](https://github.com/JuliusBrussee/caveman/pull/407) (project-scope gating, awaiting review) |

---

## Guiding principles

These are the rules that decide what makes the roadmap and what doesn't.

1. **Validate demand before building speculatively.** Multi-repo (E5-010), multi-agent (E8), MCP server (E8-003) all stay deferred until a real user surfaces with a concrete use case. The scope-review postmortem flagged E5 as scope creep; that lesson carries forward.

2. **Strip aspirational marketing before adding features.** Every catalog `features:` block, every README claim, every CLI `--help` line must reflect ship-as-stated reality. E5-007 was the precedent (multi_repo + multi_llm_review + audit_log all stripped). Audit periodically.

3. **Lean on upstreams that already solved your problem.** BMad supports 38 tools, ECC supports 10 targets, Caveman supports 35+ agents. Flow's job is orchestration glue, not re-implementation. Confirm assumptions about upstreams before designing around them.

4. **Local fix first, upstream PR in parallel, deferred elsewhere.** Pattern from Caveman PR #407 + ECC PR (planned): patch locally for immediate user value, file upstream PR for permanence, mark the local patch as "redundant once upstream merges" in CHANGELOG. Don't wait on upstream merges.

5. **Self-doubt before scope creep.** Every new feature gets one "what would I tell a less-experienced engineer building this?" pass before commit. Caught the multi-repo overengineering (8 design problems in original sketch); E5-007 strip was the result.

6. **One source of truth per behavior.** Skills DSL (`workflow.md`) and Node CLI (`lib/commands/`) implementing the same behavior is drift risk. When porting, leave the slash command as canonical and have the CLI call into the same logic, or vice versa. Don't maintain two parallel implementations.

7. **Beta channel for first cuts of risky surface area.** First npm publish went `--tag beta` for a reason. CLI changes that affect users' installs land on beta first, promoted to latest only after soak. Same pattern for the npx-first install when it ships.

---

## v0.7.x — Stabilize the current release (next 1-2 weeks)

**Goal:** beta soaks, real-world reports surface, cut clean `0.7.2` to `latest`. Maintenance work only — no new features.

| Story | Status | Effort | Notes |
|---|---|---|---|
| E9-001 — Soak `0.7.2-beta.0` on npm for ~7 days | in-progress | passive | Watch for issues, install failures, doctor false-positives |
| E9-002 — Cut `0.7.2` non-beta, `npm publish` to `latest` | blocked-on E9-001 | 30min | `tools/release.sh 0.7.2 && npm publish --access public` |
| E9-003 — GitHub release notes for v0.7.2 (rendered from CHANGELOG) | blocked-on E9-002 | 15min | `gh release create v0.7.2 --notes-file ...` |
| E9-004 — CHANGELOG line-length CI passes on every PR for 7 days | passive | — | Validates E5-006 in practice |
| Track external issues / bug reports | passive | as-needed | Patch as v0.7.3+ if anything regressive |

**Gate to v0.8:** `0.7.2` has been on `latest` for ≥7 days with no critical issues, OR Julius merges PR #407 (whichever comes first).

---

## v0.8 — Cross-platform install (4-6 days, ~2 weeks calendar)

**Goal:** Flow installable without Claude Code. ECC scopable per-project. Sprint state manageable from pure CLI.

This is the npx-first port. The slash-command path stays canonical for in-Claude-Code use; the CLI gains parity for everything that doesn't require an LLM in the loop.

### E6 — npx-first install ceremony (~4 days)

| Story | Effort | Notes |
|---|---|---|
| E6-001 — `lib/init/detect.js` + `lib/init/questions.js` (port `/flow-init` Q&A to Node + `@inquirer/prompts`) | 1 day | Workflow.md stays canonical for slash command; questions.js is the parallel for headless. Drift discipline via shared test fixtures. |
| E6-002 — `lib/init/upstreams/{bmad,ecc,caveman}.js` (dispatch installers via execa) | 0.5 day | BMad: `--tools <agent>`. ECC: `--target <target>` (blocked on E7-001 for `claude-project`). Caveman: `--only <agent>` with SHA-256 inspect. |
| E6-003 — `lib/init/mcp.js` (port `claude mcp add` orchestration) | 0.5 day | Wraps the agent's MCP-register command. For Claude Code: `claude mcp add`. For Codex: `codex mcp add` (in E8 phase). |
| E6-004 — `lib/init/migrate-bmad.js` (backup + parse + write + rollback) | 0.5 day | Already designed in workflow.md step 11. Port verbatim. |
| E6-005 — `lib/commands/sprint/*` (add, next, status, done, deferred, import-bmad) | 1 day | Pure YAML ops. `scope-review` + `retro` stay slash-command (LLM-driven). |
| E6-006 — Tests + docs for everything above | 0.5 day | One test file per new module. README install section updated with the `flow init` interactive path. |

### E7 — ECC project-scope (~2 days Flow + 3h upstream PR)

| Story | Effort | Notes |
|---|---|---|
| E7-001 — Open PR to ECC adding `claude-project` target adapter | 3h | Clone affaan-m/ECC, mirror `cursor-project.js` pattern, register, test, push, open PR |
| E7-002 — Flow's catalog gains `upstreams.ecc.install_scope` (user \| project) | 0.5 day | Default user for `mini`/`standard`; default project for `team` |
| E7-003 — `/flow-init` + `flow init` honor the scope flag | 0.5 day | Q4 asks "Install ECC project-scope or user-scope?" |
| E7-004 — Doctor probe for ECC scope drift (both scopes present → collision warning) | 0.5 day | New flow-doctor check |
| E7-005 — Update README + `docs/profiles.md` with the new scope option | 0.5h | Replace "ECC is inherently user-scope" framing |

**Gate to v0.9:** `flow init` works end-to-end without Claude Code installed; ECC PR merged OR Flow falls back to HOME-override workaround.

---

## v0.9 — Multi-agent support (~1-2 weeks)

**Goal:** Flow works with Codex, Cline, Cursor, and any other agent the upstreams already support. The upstream work is mostly already done — Flow needs to (a) pass the right per-upstream flag, (b) install its own skills to per-agent dirs.

**Important context: this epic costs less than originally estimated.**
- BMad already supports 38 tools (`--tools <agent>`)
- ECC already supports 10 targets (`--target <target>`)
- Caveman already supports 35+ agents (`--only <agent>`)

The only Flow-side gap is that Flow's own skills install only to `~/.claude/skills/` today. For other agents they'd need to land in `~/.codex/skills/` or `.codex/skills/` etc.

### E8 — Multi-agent install (~1-2 weeks)

| Story | Effort | Notes |
|---|---|---|
| E8-001 — Validate demand: 7-day window after v0.8 ships, watch for "I don't use Claude Code, can I use Flow?" | passive | Gate. Don't build until demand surfaces. |
| E8-002 — Add `targets:` block to `catalog.yaml` (per-Flow-component agent matrix, mirroring BMad's pattern) | 1 day | Each flow_component declares which agents it ships to; the catalog resolver picks the right destination path |
| E8-003 — Per-agent install destination resolver in `lib/init/scaffold.js` | 1 day | Map agent id → install path (Claude Code: `~/.claude/skills/`, Codex: `~/.codex/skills/`, Cursor: `.cursor/rules/`, etc.) |
| E8-004 — Multi-agent flag in `/flow-init` Q&A (`--target <agent>` for headless) | 1 day | Default `claude-code`; can install for multiple targets simultaneously |
| E8-005 — `lib/init/upstreams/*.js` pass per-agent flag to upstream installers | 0.5 day | `bmad install --tools <agent>`, `ecc install --target <agent>`, `caveman install --only <agent>` |
| E8-006 — Per-agent MCP registration (extending E6-003) | 0.5 day | Detect which agent's MCP CLI to call |
| E8-007 — Doctor probes per-agent (Flow's own skills present at the right paths) | 0.5 day | Multi-agent install verification |
| E8-008 — Tests + docs | 1 day | Per-agent install smoke tests, README "supported agents" matrix |

**What does NOT change in E8:**
- `/flow-story` orchestration. Still Claude Code only. The LLM-driven phase-runner depends on Claude Code skill execution. For other agents the answer is a separate epic (E8-MCP, deferred — see below).
- Scope-review + retro. Still Claude Code (LLM-driven).

### E8-MCP (deferred) — Flow as MCP server

| Story | Effort | Notes |
|---|---|---|
| E8-MCP-001 — Design `@mhd-ghaith-abtah/flow-mcp` tool boundaries | 2 days | Gate: only build if E8 ships and users ask for /flow-story-equivalent on Codex/Cursor |
| E8-MCP-002 — Implement MCP server | 1 week | Node + @modelcontextprotocol/sdk |
| E8-MCP-003 — Migrate `/flow-story` to call MCP tools instead of bare Skill invocations | 3 days | Claude Code becomes one MCP client of Flow |
| E8-MCP-004 — Document install + use across agents | 1 day | |

**Gate to v0.9 ship:** E8-008 docs done; ≥1 non-Claude-Code user has successfully installed Flow against their preferred agent.

---

## v1.0 — Stable

**Goal:** Drop the 0.x signal. API surface stable for ≥3 months.

| Story | Status | Notes |
|---|---|---|
| Stabilize CLI surface across `flow init / install / plan / doctor / add / remove / uninstall / sprint *` | TBD | After v0.9 ships and patterns settle |
| Lock catalog.yaml schema | TBD | v1 means breaking schema changes need a v2 catalog with explicit migration |
| Lock adapter contract | TBD | `adapters/*/`'s `_interface.md` becomes the binding contract |
| Lock install-state.json schema | TBD | Same |
| Cut v1.0 | TBD | After ≥3 months on `latest` with no contract breaks |

---

## Out of scope (explicit non-goals)

These are not on the roadmap by design. Each one would consume significant engineering and provide narrow user value relative to other work. They surface here so contributors don't waste time proposing them.

1. **Coordinated multi-repo atomic merges.** The scope-review postmortem (2026-05-19) found this competes with Bors / Mergify / Kodiak — mature tools in that space. Flow's lane is workflow tracking, not merge orchestration. Tracked as E5-007 (stripped) + E5-010 (deferred awareness-only).

2. **Per-adapter-call audit log.** Was advertised in the team-profile features block until v0.7.1; stripped in E5-007. Could rebuild if a real auditing use case surfaces; speculative until then.

3. **Built-in LLM provider abstraction.** Flow does not invoke LLMs itself. The agent (Claude Code, Codex, etc.) owns the LLM relationship; Flow orchestrates between user, agent, and tools. No `flow chat`, no `flow plan-with-gpt5`.

4. **Flow's own skill registry / marketplace.** Skills are installed via BMad, ECC, or directly by the agent. Flow doesn't ship a marketplace.

5. **Visual UI / dashboard.** sprint.yaml + `flow status` + the agent's own UI are enough. No `flow dashboard`, no Electron app, no web UI.

6. **CI orchestration.** Flow opens PRs via `gh pr create` and waits for CI via `gh pr view`. Flow does not run CI, configure CI, or substitute for it.

7. **Story execution outside an agent session.** `/flow-story`'s value is LLM-driven orchestration. `flow story advance` exists as data-layer access (which phase am I in?) but does NOT do the implementation step. That requires an agent.

8. **Branch protection / merge bot replacement.** Use GitHub branch protection + `gh pr merge --auto`. Flow waits for them; it doesn't replace them.

9. **Hosted Flow service.** Flow is a local tool. No SaaS, no shared state, no team collab server.

---

## Decision log

Append-only record of design calls. Each entry: date, decision, rationale, what it implies for future work.

### 2026-05-19 — Strip team-profile `features` block (E5-007)
Self-doubt review on the multi-repo implementation sketch surfaced 8 design problems (sibling-PR enforcement is convention not enforcement; all-or-none merge can't roll back past merged PRs; etc.) plus a strategic mismatch (coordinated multi-repo competes with Bors-class tools). Stripped `multi_repo`, `multi_llm_review`, `audit_log` from team profile. `multi_llm_review` was a renamed duplicate of real `review.use_separate_model`. **Implies:** strip-before-build is the default for unimplemented marketing copy.

### 2026-05-19 — Defer multi-repo to read-only awareness only (E5-010)
If demand surfaces, build aggregate-PR-status across declared repos. Skip orchestration (Bors-class problem, not Flow's lane). **Implies:** future multi-repo work is `metadata + status query + done detection`, not branch coordination.

### 2026-05-19 — Cut v0.7.2-beta.0 (not v0.7.1 or v0.7.2) for first npm publish
Tag/artifact alignment + the trim to `package.json` `files` block meant cutting a new version. Chose `0.7.2-beta.0` so first publish doesn't auto-claim `latest`. **Implies:** any future first-major-change publish should go beta-first.

### 2026-05-19 — Upstream-PR-first policy
Caveman PR #407 was opened before local-only patching. Same pattern for ECC PR (E7-001). **Implies:** every dependency tweak that's broadly useful gets filed upstream, then local-mirrored.

### 2026-05-19 — Validate `--apply-from <path>` was a false promise (E5-009)
Skill text advertised a subcommand that didn't exist. Chose strip over implement — same-day re-run is the supported workflow. **Implies:** when the skill text and dispatcher diverge, the dispatcher wins; align text to reality.

### 2026-05-19 — All three upstreams are multi-agent (correction to roadmap assumptions)
Verified: BMad supports 38 tools, ECC supports 10 targets, Caveman supports 35+ agents. Earlier framing assumed Claude-Code-coupling. **Implies:** E8 multi-agent cost drops by ~50%; Flow's own skill paths become the bottleneck, not upstream support.

---

## How this file is maintained

- Update **Status** when versions ship or upstream PRs merge.
- Move stories from one epic to another when scope-review proposes it.
- Append to **Decision log** when a non-trivial design call is made (this is where the "why" lives so future readers don't undo it).
- **Out of scope** entries are append-mostly — only remove if a real use case surfaces and the entry is wrong.
- **Gates** are not aspirational deadlines; they're literal conditions for moving on. If the gate isn't met, stay on the current epic.
- `docs/flow/sprint.yaml` is the working list. This file is the longer arc. Don't duplicate item-level detail between them — sprint.yaml has the current epic in full, roadmap.md has the multi-epic arc.
