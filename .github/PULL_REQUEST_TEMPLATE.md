<!-- See CONTRIBUTING.md before opening. -->

## What changed

<!-- One sentence on the why; the diff handles the what. -->

## Issue / context

<!-- Reference an open issue or the handoff-list number (#4, #16, etc.) if applicable. -->

## CHANGELOG

- [ ] Updated `CHANGELOG.md` under `## [Unreleased]` (required for any change to `lib/`, `bin/`, `skills/`, `adapters/`, `templates/`, `catalog.yaml`, `package.json`)

## Tests

- [ ] `npm test` passes locally
- [ ] `node bin/flow.js plan --profile standard` runs without error
- [ ] Added tests for any new module under `lib/` (or explained why none were needed)

## Skills + adapters

- [ ] If you added a new skill, it's registered in `catalog.yaml` under `core:flow-skills` and `tools/dev-link.sh`
- [ ] If you touched a `workflow.md`, any new marker regex is anchored with `^...$`

## Risk + rollout

<!-- Anything reviewer should pay extra attention to: irreversible state changes, MCP registration tweaks, schema bumps, etc. -->
