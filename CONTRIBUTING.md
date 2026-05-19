# Contributing to Flow

Thanks for considering a contribution. Flow is small, opinionated, and prefers tight conventions over loose ones — please read this before opening a PR.

## Repo state

- **License:** MIT
- **Maintainer:** [@mhd-ghaith-abtah](https://github.com/mhd-ghaith-abtah)
- **Governance:** single-maintainer, no CLA, no CODEOWNERS, no required reviewers
- **Issue tracker:** GitHub Issues at [github.com/mhd-ghaith-abtah/flow/issues](https://github.com/mhd-ghaith-abtah/flow/issues)
- **Internal backlog:** `docs/flow/sprint.yaml` (Flow dogfoods Flow). Browse there to see what's already planned before opening a duplicate issue.
- **Release cadence:** small + frequent. v0.7.0 shipped 25-of-28 review items on day 1. Patches land same-day when reviewable.
- **CI gates:** every PR runs `npm test` (Node 20 + 22), smoke-tests four profiles, shellchecks `tools/`, and enforces the CHANGELOG-touched rule.

**Anyone with a GitHub account can contribute.** Fork → branch → PR. No special access needed.

## Practical bar

What you actually need on your machine to develop Flow:

| Requirement | Why |
|---|---|
| Git | Standard |
| Node 20+ | `bin/flow.js` + `lib/` + `npm test` |
| GitHub account | Fork + PR |
| Claude Code installed (`claude` CLI) | For testing slash-command paths (`/flow-init`, `/flow-story`, `/flow-doctor`). Optional if your PR only touches `lib/` or `bin/`. |
| `gh` CLI (optional) | If your PR touches the GitHub PR adapter or `tools/release.sh` |
| `make` (optional) | If your PR touches the `verify-make` adapter |
| `shellcheck` (optional) | Pre-run locally before CI; matches the CI shellcheck job |

**Setup flow:** `git clone` → `npm install` → `tools/dev-link.sh` → `npm test`. Five minutes from cold to a working dev mount.

**Testing surface:**
- Code in `lib/` is unit-tested via `node --test` — add a `*.test.js` next to any new module.
- Skills + adapters are markdown DSL (`workflow.md`) interpreted by Claude Code at runtime — they aren't unit-tested directly. Exercise them by running the slash command (`/flow-init`, `/flow-story`, etc.) against a scratch project or Flow's own dogfood state in `docs/flow/`.
- Smoke tests in CI cover the four built-in profiles (`flow plan --profile minimal|mini|standard|team`) on Node 20 + 22.

**What you don't need:**
- BMad, ECC, or Caveman installed locally — Flow only orchestrates them; the per-skill workflows don't import their code.
- Linear / GitHub / Jira accounts — adapter dev uses stub responses.
- A published npm package — local dev runs everything via `node bin/flow.js`.

**Common gotchas:**
- macOS bash is 3.2 (no associative arrays) — `tools/*.sh` must work there. CI is Ubuntu so dev-mac quirks slip through; run `shellcheck tools/` before pushing.
- `tools/dev-link.sh` creates a mount under `~/.claude/skills/<name>/` per skill. If you add a new skill, register it there + in `catalog.yaml` + in the dev-link script.
- Caveman fires on every Claude Code session by default. If you're testing a non-caveman behavior, drop `.caveman-disable` in your test CWD (post-PR-#407 feature) or `unset` global mode.

**Good first issues** (small, well-scoped):
- A new adapter from the "likely-but-unscheduled" list in `docs/adapters.md` (Jira, GitLab, Bitbucket, Cypress, Slack, Discord). The adapter contract in `adapters/<family>/<name>/_interface.md` is small enough to ship in a weekend.
- Real pixel-diff for `screenshot_diff()` in `adapters/e2e/playwright-mcp.md` (currently stubbed; would use `pixelmatch` or `odiff`).
- Any open story in `docs/flow/sprint.yaml` with status `ready` or `backlog` — `gh issue create` or just open a PR referencing the story id.

**Pre-PR habits the maintainer values**
- Open an issue first if the change is non-trivial (>50 LOC or any new file)
- Reference an existing sprint.yaml story id (`E3-007a`) in the PR title or body if your work maps to one
- Caveman style is fine in commit bodies and PR descriptions; code itself stays normal English
- Surface scope creep — if your PR grew past the original intent, say so in the description rather than hiding it

## Setup

```bash
git clone https://github.com/mhd-ghaith-abtah/flow.git
cd flow
npm install
tools/dev-link.sh         # mounts skills into ~/.claude/skills/ via symlinks
npm test                  # node --test on lib/**/*.test.js
node bin/flow.js plan --profile standard   # smoke
```

`tools/dev-link.sh` is idempotent. Run `tools/dev-link.sh --unlink` to remove the dev mount.

## Branch + commit conventions

- Branch off `main`.
- Use Conventional Commits (`feat: …`, `fix: …`, `chore: …`, `docs: …`, `refactor: …`).
- Keep the subject ≤ 50 chars. Detail goes in the body. Caveman style is fine for the body.

## CHANGELOG

**Every PR must update `CHANGELOG.md` under `## [Unreleased]`.** This is non-negotiable — Flow ships small and frequently, and skipped CHANGELOG entries are the single largest source of "what changed in v0.x?" pain.

Use Keep-a-Changelog sections in this order: `### Added`, `### Changed`, `### Fixed`, `### Removed`. One-line entries; reference issue numbers from the handoff list (`#4`, `#16`, etc.) when applicable.

CI will fail your PR if it touches `lib/`, `bin/`, `skills/`, `adapters/`, `templates/`, `catalog.yaml`, or `package.json` without updating `CHANGELOG.md`. The check is the `changelog` job in `.github/workflows/ci.yml`.

## Versioning

Flow follows [SemVer](https://semver.org/). Cut a release by:
1. Move all `## [Unreleased]` entries under a new dated heading: `## [0.X.Y] — YYYY-MM-DD`
2. Add an empty `## [Unreleased]` above it
3. Bump `package.json` version + `version:` in `catalog.yaml`'s `flow_version_compat` if minor/major
4. Tag: `git tag v0.X.Y && git push --tags`
5. `npm publish` (maintainers only)

## Tests

`npm test` runs `node --test 'lib/**/*.test.js'`. Add tests for any new module under `lib/`. Skills + adapters are markdown DSL — they aren't unit-tested directly; instead exercise them through the bin CLI or by running `/flow-init` / `/flow-story` / `/flow-doctor` against a scratch project.

## Code style

- Files ≤ 200–400 lines typical, 800 max.
- No `console.log` in production paths — use `chalk` + the existing logger conventions in `lib/commands/`.
- Skills are markdown with `<workflow>` / `<step>` / `<action>` / `<check>` tags — preserve the structure rather than freewriting prose.

## Pull request checklist

- [ ] CHANGELOG entry under `## [Unreleased]`
- [ ] `npm test` passes
- [ ] `node bin/flow.js plan --profile standard` runs without error
- [ ] Any new skill registered in `catalog.yaml` under `core:flow-skills` + `tools/dev-link.sh`
- [ ] If you touched a workflow.md, did you anchor any new marker regex with `^...$`?
