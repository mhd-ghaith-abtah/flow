# Custom verify adapter

User-defined shell command. Use for non-JS stacks or when verify is a one-off compound command.

**Config:** `integrations.verify.command` — required, free-form shell string. Examples:
- Go: `go vet ./... && go test ./... && go build ./...`
- Rust: `cargo check && cargo clippy --all-targets && cargo test`
- Python: `ruff check . && pytest && mypy .`
- Mixed monorepo: `make -C web verify && pytest api/`

---

## verify_cmd

`{{config.integrations.verify.command}}`

## precheck

`test -n "{{config.integrations.verify.command}}"` → if empty, halt: "Set `integrations.verify.command` in `flow.config.yaml`."

## run

Execute via Bash. Stream output. Return `{ passed, duration_ms, exit_code, stdout, stderr }`.

## on_failure(exit_code, stderr)

Generic: "Verify command failed. Run directly to see full output: `{{verify_cmd}}`."
