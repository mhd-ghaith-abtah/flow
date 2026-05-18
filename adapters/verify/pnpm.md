# pnpm verify adapter

Runs a pnpm script (default `verify`). Use when the project doesn't have a Makefile but exposes a verification chain via package.json scripts.

**Config:** `integrations.verify.script` (default `verify`).

**Dependencies:** `pnpm` in `$PATH`; `package.json > scripts > {{script}}` defined.

---

## verify_cmd

`pnpm {{config.integrations.verify.script || "verify"}}`

## precheck

1. `test -f package.json` → if false, halt.
2. `jq -e '.scripts["{{script}}"]' package.json` → if missing, halt: "No `{{script}}` script in package.json. Add one (typical: `\"verify\": \"pnpm typecheck && pnpm lint && pnpm test\"`) or switch verify adapter."

## run

Execute `pnpm {{script}}` via Bash, stream output, return `{ passed, duration_ms, exit_code, stdout, stderr }`.

## on_failure(exit_code, stderr)

Same suggestion logic as make.md adapter. Plus:
- If stderr contains `pnpm: command not found`, halt: "Install pnpm: https://pnpm.io/installation."
