# E2E Adapter Interface

E2E adapters run the user-journey block from a story file against a live app.

## Required operations

### `run_journey(story_file, base_url) → { passed, failed, artifacts }`

1. Parse the `## E2E Journey` block from the story file.
2. Execute each step in order.
3. Collect artifacts (screenshots, traces, logs) at `docs/flow/artifacts/<story_id>/`.
4. Return:
   - `passed` — array of step names that passed
   - `failed` — array of `{ step, error, artifact_path }` for failures
   - `artifacts` — list of generated file paths

### `smoke_test(base_url) → ok | { error, artifact_path }`

Quick sanity check: load base_url, verify no console errors, no 5xx. Returns `ok` if reachable.

## Optional operations

### `screenshot_diff(baseline_path, current_path) → { diff_pct, diff_image_path }`

Visual regression — optional but recommended for UI-heavy stories.

## Journey block format

```markdown
## E2E Journey

- navigate /
- assert visible "Welcome"
- click "Get started"
- assert url ends with /signup
- fill input[name=email] = "test@example.com"
- click "Continue"
- assert visible "Check your inbox"
- screenshot success
```

Each line is one step. Verbs supported per adapter — see each adapter's docstring. Indentation tolerant. Comments start with `#`.
