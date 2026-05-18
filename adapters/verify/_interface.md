# Verify Adapter Interface

Runs the project's build + test gate. Returns a single pass/fail signal plus the raw output for triage.

## Required operations

### `verify_cmd → string`

Return the shell command Flow should execute as the verification gate. Examples:
- make adapter: `make verify`
- pnpm adapter: `pnpm verify` (or whatever script name was configured)
- custom adapter: user-defined command from config

### `run() → { passed, duration_ms, exit_code, stdout, stderr }`

Execute `verify_cmd`. Capture exit code + output. Stream to terminal so user sees progress.

## Optional operations

### `on_failure(exit_code, stderr) → string`

Return a one-line suggestion for the user (e.g., "Run `/build-fix` to triage the type error").

### `precheck() → ok | { error }`

Sanity check before running verify (e.g., for make adapter: confirm Makefile exists and has a `verify` target).
