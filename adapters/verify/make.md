# Make verify adapter

Runs `make verify` (or another target). Standard for repos that wrap their build/test/lint in a Makefile.

**Config:** none required. Optional override: `integrations.verify.target` (default `verify`).

**Dependencies:** `make` CLI in `$PATH`; `Makefile` at repo root with the configured target.

---

## verify_cmd

`make {{config.integrations.verify.target || "verify"}}`

## precheck

1. `test -f Makefile` → if false, halt: "No Makefile at repo root. Either create one with a `{{target}}:` target or switch to `flow adapter swap verify pnpm` / `custom`."
2. `grep -q '^{{target}}:' Makefile` → if false, halt: "Makefile is present but has no `{{target}}:` target."

## run

1. Execute `make {{target}}` via Bash, capturing exit code + streaming output.
2. Record `duration_ms` from start to finish.
3. Return `{ passed: exit_code == 0, duration_ms, exit_code, stdout, stderr }`.

## on_failure(exit_code, stderr)

- If stderr contains `error TS` or `Type error`, suggest: "TypeScript errors — try `/build-fix` or run `make typecheck` directly."
- If stderr contains `eslint`, suggest: "Lint errors — run `make lint --fix` or `pnpm lint --fix`."
- Otherwise generic: "Verify failed — run `make {{target}}` directly to see full output."
