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

**Good first issues** (small, well-scoped, visible in `docs/flow/sprint.yaml`):
- `E5-006` — CHANGELOG line-length CI enforcement
- `E5-009` — `/flow-sprint scope-review --apply-from <path>` (implement or strip the false promise)
- Any new adapter from the v0.2 list in `docs/adapters.md` (jira, gitlab, bitbucket, cypress, slack, discord)

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
