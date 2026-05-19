# Contributing to Flow

Thanks for considering a contribution. Flow is small, opinionated, and prefers tight conventions over loose ones — please read this before opening a PR.

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

CI will fail your PR if it touches `lib/`, `bin/`, `skills/`, `catalog.yaml`, `templates/`, or `adapters/` without bumping CHANGELOG. (Hook is in `.github/workflows/changelog.yml` — to be added in v0.7.)

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
