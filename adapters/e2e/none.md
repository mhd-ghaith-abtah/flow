# No E2E adapter

E2E phase is skipped entirely. Stories may still have `## E2E Journey` blocks for documentation, but Flow does not execute them.

## run_journey(story_file, base_url)

Returns `{ passed: [], failed: [], artifacts: [], skipped: true }`.

## smoke_test(base_url)

Returns `ok`.

## screenshot_diff(baseline_path, current_path)

Returns `{ skipped: true }`.
