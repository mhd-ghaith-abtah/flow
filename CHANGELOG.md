# Changelog

All notable changes to Flow are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.1] — 2026-05-18

### Added
- Initial scaffold: `flow-init`, `flow-sprint`, `flow-story` skills
- Catalog (`catalog.yaml`) with profiles `mini`, `standard`, `team`
- Adapter interfaces for `issue-tracker`, `pr`, `e2e`, `verify`
- v0.1 adapters: `linear`, `github-issues`, `none` (issue-tracker);
  `github`, `none` (pr); `playwright-mcp`, `none` (e2e); `make`, `pnpm`, `custom` (verify)
- BMad delegation: invokes `npx bmad-method install --modules <curated>`
- ECC delegation: invokes `./install.sh --profile <curated> --with --without`
- MCP integration: `context7`, `playwright`, `linear`, `github-mcp` (optional)
- Node CLI binary (`bin/flow.js`) with subcommands `install`, `plan`, `status`, `doctor`, `add`, `remove`, `uninstall`
- Slash command parity inside Claude Code
- Migration from BMad `sprint-status.yaml`
- State store at `~/.claude/flow/install-state.json` and `<project>/.claude/flow/install-state.json`
