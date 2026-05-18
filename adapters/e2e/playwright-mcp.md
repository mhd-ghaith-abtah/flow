# Playwright MCP adapter

Uses the Playwright MCP server. Runs an interactive browser session, executes journey steps, captures artifacts.

**MCP namespace:** `mcp__playwright__*` (exact prefix depends on how the MCP is registered — `mcp__plugin_playwright__*` if installed as a plugin).

**Dependencies:**
- Playwright MCP server installed (`claude mcp list | grep playwright`)
- `@playwright/test` runtime in the project (`pnpm add -D @playwright/test`)
- A browser binary installed (`npx playwright install chromium`)

**Config keys** (`flow.config.yaml > integrations.e2e`):
- `base_url` — required, e.g. `http://localhost:4321`
- `journeys_dir` — default `docs/flow/journeys` (for reusable journeys outside stories)
- `viewport` — optional `{ width, height }`, defaults `{ 1280, 720 }`
- `start_server_cmd` — optional, e.g. `pnpm dev`. If set, Flow starts the server before journey and stops after.

---

## run_journey(story_file, base_url)

1. **Pre-flight:**
   - If `start_server_cmd` is set, spawn it in background, wait for `base_url` to respond 200, max 30s.
   - Parse `## E2E Journey` block from `story_file` into ordered step list.

2. **Browser setup:**
   - `mcp__playwright__browser_navigate({ url: base_url })`
   - `mcp__playwright__browser_resize({ width, height })` if viewport configured.

3. **Step execution** — for each step:

   | Step verb | MCP tool |
   |---|---|
   | `navigate <path>` | `browser_navigate({ url: base_url + path })` |
   | `assert visible "<text>"` | `browser_snapshot()` then check accessibility tree for text |
   | `assert url ends with <path>` | `browser_evaluate({ function: "() => location.pathname" })` |
   | `click "<text>"` or `click <selector>` | `browser_click({ ref })` (resolve ref from snapshot first) |
   | `fill <selector> = "<value>"` | `browser_type({ ref, text })` |
   | `wait <selector>` | `browser_wait_for({ ref })` |
   | `screenshot <name>` | `browser_take_screenshot({ filename: "<story_id>/<name>.png" })` |
   | `assert no console errors` | `browser_console_messages()` → filter level=error → assert empty |
   | `# <comment>` | no-op (just a step label) |

4. **On failure:**
   - Capture a screenshot of the failure state: `browser_take_screenshot({ filename: "<story_id>/FAIL-<step_name>.png" })`
   - Record `{ step, error, artifact_path }` in `failed[]`.
   - Continue running remaining steps unless `--stop-on-failure` flag was set.

5. **Cleanup:**
   - If `start_server_cmd` was used, kill the spawned process.
   - `browser_close()`.

6. **Save artifacts:**
   - All screenshots already saved by MCP under the path passed.
   - Write a summary at `docs/flow/artifacts/<story_id>/journey-result.json`:
     ```json
     {
       "story_id": "...",
       "ran_at": "...",
       "base_url": "...",
       "passed": [...],
       "failed": [...],
       "duration_ms": ...
     }
     ```

7. **Return** `{ passed, failed, artifacts }`.

## smoke_test(base_url)

1. `browser_navigate({ url: base_url })`
2. `browser_console_messages()` → assert no `level: error`
3. `browser_snapshot()` → assert any visible content (page is not blank)
4. `browser_close()`
5. Return `ok` or `{ error, artifact_path }`.

## screenshot_diff(baseline_path, current_path)

Optional — v0.1 returns `{ diff_pct: null, note: "not implemented" }`. v0.2 will use `pixelmatch` or `odiff`.

## Failure handling

- MCP unreachable: halt with `claude mcp list` output and "Run `/flow-init --repair` or `claude mcp add playwright ...`".
- Server start fails: halt with the start command output.
- Journey block missing: prompt user to add it, or fall back to `smoke_test`.
- Step verb unrecognized: halt with the offending line and the supported verbs list above.
