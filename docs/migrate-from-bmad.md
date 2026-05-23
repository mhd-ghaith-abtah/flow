# Migrating from BMad

Flow doesn't replace BMad — it sits on top of it and adds a lightweight per-story state layer. If you already have a BMad project with `sprint-status.yaml` and stories under `docs/_bmad-output/`, here's how to move to Flow without losing work.

## What stays the same

- Your BMad PRD, architecture, and epic documents — `/flow-init` does NOT touch these
- Your BMad story files in `docs/_bmad-output/stories/` — Flow reads them as references
- The BMad slash commands keep working — Flow doesn't remove or rename them. The exact slash names depend on which BMad version is installed (BMad 6+ uses the `/bmad:bmm:<step>` namespace, e.g. `/bmad:bmm:2-plan-workflow`, `/bmad:bmm:3-solutioning`, `/bmad:bmm:4-implementation`; older releases used a flatter `/bmad-*` form). Check `~/.claude/skills/` after install to see what BMad registered.
- `_bmad/_config/manifest.yaml` — Flow records the BMad version for repair

## What changes

- A new `docs/flow/` directory with:
  - `sprint.yaml` — replaces `sprint-status.yaml`
  - `stories/` — new per-story stubs (~30 lines each) that link back to the BMad story file as a reference
  - `journeys/`, `retros/`, `archive/`, `deferred.md`, `artifacts/`
- `flow.config.yaml` — adapter + profile config (committed; team-share safe)
- A new branch convention: `flow/<story-id>-<slug>` — used by `/flow-story` for auto-branching
- `/flow-story` becomes the per-story orchestrator instead of BMad's own per-story workflow + manual stepping

## Migration

```
/flow-init --migrate-bmad
```

This runs `/flow-init` in migration mode. In addition to the normal install flow, it:

1. **Parses `sprint-status.yaml`** — extracts epic IDs, story IDs, status, tags
2. **Maps statuses** — BMad `draft|approved|in-progress|done` → Flow `backlog|todo|doing|done`
3. **Writes `docs/flow/sprint.yaml`** — single sprint with the migrated stories
4. **Generates Flow story stubs** — one per BMad story, with a `references:` pointer to the original BMad markdown

After migration, `/flow-sprint status` should show your full backlog. Run `/flow-story <id>` on the first migrated story and Flow will auto-detect its phase from the existing git/PR state.

## Manual migration

If `--migrate-bmad` fails (usually: malformed `sprint-status.yaml` or non-standard epic IDs), it falls back to "no migration" mode and prints the parse error. Fix the YAML, then re-run:

```
/flow-init --update --migrate-bmad
```

Or do it manually:

```yaml
# docs/flow/sprint.yaml
version: 1
sprint:
  id: S1
  started: 2026-05-19
  goal: <copy from BMad PRD>
epics:
  - id: E1
    title: <copy from BMad epic>
stories:
  - id: E1-001
    title: <copy from BMad story>
    epic: E1
    status: todo
    tags: [<copy>]
    references:
      - docs/_bmad-output/stories/E1-001-<slug>.md
```

Then create one story stub per entry — `templates/story.md.tmpl` is the shape.

## Coexistence

Once migrated, you can still create new stories through BMad's own slash commands (whatever your BMad version exposes) and re-import:

```
# Run BMad's create-story flow — exact command depends on your BMad version.
# Then back into Flow:
/flow-sprint import-bmad      # detects new BMad story files, generates Flow stubs
```

The reverse — Flow → BMad — isn't supported. Flow's story stubs are deliberately lighter than BMad's, so round-tripping would lose information. If you need a full BMad-shape story file later, run BMad's create-story flow and Flow will detect + link it on the next `import-bmad`.

## Rollback

`docs/flow/` is fully additive. To roll back:

```
rm -rf docs/flow/ flow.config.yaml
git checkout sprint-status.yaml   # if Flow wrote a backup
```

Flow stages a backup at `sprint-status.yaml.flow-backup-<timestamp>` before any migration write, so you can always restore.

## Known gotchas

- **Non-standard epic IDs:** BMad allows `E3-S9b` (sub-stories). Flow's `import-bmad` parser handles this, but other forms (`E1.a`, `Epic-1-Story-1`) need a `--epic-id-pattern` override.
- **Deferred stories:** BMad's `status: deferred` maps to Flow's `deferred.md` file, not `sprint.yaml`. The migration moves them automatically.
- **Story branches:** BMad uses `feature/<story-id>`; Flow uses `flow/<story-id>-<slug>`. The migration leaves existing branches alone — only NEW stories under `/flow-story` get the new naming.
