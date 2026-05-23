// lib/init/migrate-bmad.js — port BMad sprint state to Flow.
//
// Headless equivalent of step 11 of /flow-init's workflow.md. The
// migration is the one piece of `flow init` with destructive filesystem
// semantics (writes files derived from user-edited state), so the
// public surface is built around an explicit backup→validate→rollback
// loop:
//
//   1. findBmadState(cwd)        — discover what's there to migrate
//   2. backupBmadState(cwd, ts)  — copy each source to .flow-backup-<ts>
//   3. migrate(cwd, opts)        — orchestrate: backup → parse → write
//                                  → validate → record. On any failure
//                                  after step 2, rollback(cwd, ts) runs
//                                  before returning.
//   4. rollback(cwd, ts)         — restore from backups + remove produced
//                                  docs/flow/* if it was newly created.
//
// _bmad/ itself is intentionally left in place so BMad slash commands
// keep working post-migration. Users archive manually via
//   `mv _bmad _bmad.archived` once they're sure Flow is the source of
// truth. That decision is documented in the workflow.md comment.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const BMAD_SPRINT_REL = join('docs', '_bmad-output', 'implementation-artifacts', 'sprint-status.yaml');
const BMAD_DEFERRED_REL = join('docs', '_bmad-output', 'implementation-artifacts', 'deferred-work.md');
const FLOW_SPRINT_REL = join('docs', 'flow', 'sprint.yaml');
const FLOW_DEFERRED_REL = join('docs', 'flow', 'deferred.md');
const FLOW_STORIES_DIR_REL = join('docs', 'flow', 'stories');

// BMad → Flow status mapping. Anything unknown maps to backlog so the
// migration is non-lossy — the user can adjust afterwards.
const STATUS_MAP = Object.freeze({
  backlog: 'backlog',
  'ready-for-dev': 'backlog',
  ready: 'backlog',
  'in-progress': 'doing',
  doing: 'doing',
  review: 'review',
  done: 'done',
  cancelled: 'cancelled',
});

// Story ids in BMad's sprint-status.yaml follow `e<epic>-s<story>-<slug>`
// (case-insensitive). We pin the regex anchored so we don't pick up
// random keys that happen to start with `e`.
const STORY_KEY_RE = /^e(\d+)-s(\d+)(?:-(.+))?$/i;

/**
 * @typedef {Object} BmadState
 * @property {string} cwd
 * @property {string|null} sprintStatusPath
 * @property {string|null} deferredPath
 * @property {string|null} existingFlowSprintPath - non-null when Flow is
 *   re-migrating into a directory that already has docs/flow/sprint.yaml
 * @property {boolean} hasSomethingToMigrate
 */

/**
 * @typedef {Object} ParsedStory
 * @property {string} id        - e.g. "E3-S2"
 * @property {string} epicId    - e.g. "E3"
 * @property {number} epicNum
 * @property {number} storyNum
 * @property {string} slug      - kebab-case slug from the BMad key
 * @property {string} title     - human title (from value, falls back to slug)
 * @property {string} status    - Flow status (from STATUS_MAP)
 * @property {string} rawKey    - original BMad key, for traceability
 * @property {string|null} rawStatus
 */

/**
 * @typedef {Object} MigrationResult
 * @property {boolean} ok
 * @property {string} backupTs
 * @property {string[]} backups
 * @property {number} storiesImported
 * @property {number} epicsImported
 * @property {number} deferredImported
 * @property {Object} stateRecord    - JSON-serializable; lift into install-state.migrations.bmad
 * @property {string} [error]        - present when ok=false; rollback already attempted
 */

/**
 * Find what's available to migrate. Returns null-filled fields rather
 * than throwing — caller decides whether absence is fatal (the
 * orchestrator typically only calls migrate() when the user answered
 * Q8 = yes, so missing files at this point IS an error case the caller
 * should handle).
 *
 * @param {string} cwd
 * @returns {BmadState}
 */
export function findBmadState(cwd) {
  const sprintStatusPath = join(cwd, BMAD_SPRINT_REL);
  const deferredPath = join(cwd, BMAD_DEFERRED_REL);
  const existingFlowSprint = join(cwd, FLOW_SPRINT_REL);
  return {
    cwd,
    sprintStatusPath: existsSync(sprintStatusPath) ? sprintStatusPath : null,
    deferredPath: existsSync(deferredPath) ? deferredPath : null,
    existingFlowSprintPath: existsSync(existingFlowSprint) ? existingFlowSprint : null,
    hasSomethingToMigrate: existsSync(sprintStatusPath),
  };
}

/**
 * Make a UTC ISO-like timestamp without separators — safe to embed in
 * filenames on every OS (`20260520T141733Z` style). The unit-tested
 * format matches what workflow.md step 11 specifies.
 */
export function makeBackupTs(now = new Date()) {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+/, '');
}

/**
 * Copy each source file to <path>.flow-backup-<ts> next to the
 * original. If any copy fails, the in-progress backups are removed and
 * an error is thrown so the caller never proceeds with the migration
 * against a partial backup set.
 *
 * @param {BmadState} state
 * @param {string} backupTs
 * @returns {string[]} - the produced backup paths
 */
export function backupBmadState(state, backupTs) {
  const sources = [state.sprintStatusPath, state.deferredPath, state.existingFlowSprintPath].filter(Boolean);
  const produced = [];
  try {
    for (const src of sources) {
      const dest = `${src}.flow-backup-${backupTs}`;
      copyFileSync(src, dest);
      produced.push(dest);
    }
  } catch (err) {
    // Clean up partial backups so the user's tree stays tidy if we bail.
    for (const p of produced) {
      try { rmSync(p, { force: true }); } catch {}
    }
    throw new Error(`backup failed before any write: ${err.message}`);
  }
  return produced;
}

/**
 * Parse BMad sprint-status.yaml into a list of ParsedStory. Defensive:
 * unknown keys are skipped silently rather than throwing — BMad's
 * sprint-status has occasionally grown metadata keys (`epics`,
 * `last_updated`, etc.) and we don't want a future addition to break
 * migration.
 *
 * @param {string} yamlText
 * @returns {ParsedStory[]}
 */
export function parseBmadStories(yamlText) {
  let parsed;
  try { parsed = parseYaml(yamlText); } catch (err) {
    throw new Error(`failed to parse sprint-status.yaml: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object') return [];

  // BMad's sprint-status is sometimes a flat map of story keys at the
  // root, sometimes nested under `stories:`. Support both.
  const candidates = parsed.stories && typeof parsed.stories === 'object'
    ? parsed.stories
    : parsed;

  const out = [];
  for (const [key, value] of Object.entries(candidates)) {
    const m = STORY_KEY_RE.exec(key);
    if (!m) continue;
    const epicNum = Number(m[1]);
    const storyNum = Number(m[2]);
    const slug = (m[3] || '').toLowerCase();
    const valueObj = (value && typeof value === 'object') ? value : {};
    const rawStatus = valueObj.status ?? null;
    const status = STATUS_MAP[String(rawStatus || '').toLowerCase()] || 'backlog';
    const title = valueObj.title || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || key;
    out.push({
      id: `E${epicNum}-S${storyNum}`,
      epicId: `E${epicNum}`,
      epicNum,
      storyNum,
      slug,
      title,
      status,
      rawKey: key,
      rawStatus,
    });
  }
  return out;
}

/**
 * Build the sprint.yaml content from the parsed stories. We construct
 * a plain object and let `yaml.stringify` handle quoting — it's safer
 * than templating because story titles can contain colons, quotes, etc.
 *
 * @param {ParsedStory[]} stories
 * @param {Object} [meta]
 * @returns {string} YAML text ready to write
 */
function buildFlowSprintYaml(stories, meta = {}) {
  const epicIds = [...new Set(stories.map(s => s.epicId))].sort();
  const epics = epicIds.map(id => ({ id, title: id, status: 'in-progress' }));
  const sprintYaml = {
    version: 1,
    project: meta.project || 'imported-from-bmad',
    generated: new Date().toISOString().slice(0, 10),
    last_updated: new Date().toISOString(),
    migrated_from: {
      tool: 'bmad',
      backup_ts: meta.backupTs || null,
      raw_count: stories.length,
    },
    epics,
    stories: stories.map(s => ({
      id: s.id,
      title: s.title,
      epic: s.epicId,
      status: s.status,
      tags: ['migrated:bmad'],
      ...(s.rawStatus && s.rawStatus !== s.status ? { migrated_from_status: s.rawStatus } : {}),
    })),
  };
  return stringifyYaml(sprintYaml);
}

/**
 * Build a minimal story-stub markdown file. Doesn't use templates/story.md.tmpl
 * directly because that template is mustache-style and we'd need an
 * engine dep — instead we hand-roll the equivalent for the migration
 * case (which is a constrained, known input shape).
 */
function buildStoryStub(story) {
  return [
    `# ${story.id} — ${story.title}`,
    '',
    `**Epic:** ${story.epicId}`,
    `**Status:** ${story.status}`,
    `**Tags:** migrated:bmad`,
    '',
    '**Why:** _migrated from BMad sprint-status — fill in why this story exists_',
    '',
    '## Acceptance',
    '- [ ] _add acceptance criteria_',
    '',
    `## Migration provenance`,
    `- Original BMad key: \`${story.rawKey}\``,
    `- Original BMad status: \`${story.rawStatus ?? 'unset'}\``,
    '',
  ].join('\n');
}

/**
 * Parse deferred-work.md into one-line summaries. BMad's deferred-work
 * is loosely structured Markdown; we treat each `- ` bullet at column 0
 * as one deferred item.
 *
 * @param {string} markdownText
 * @returns {string[]}
 */
export function parseBmadDeferred(markdownText) {
  if (!markdownText) return [];
  const out = [];
  for (const line of markdownText.split('\n')) {
    if (/^- /.test(line)) {
      out.push(line.slice(2).trim());
    }
  }
  return out;
}

/**
 * Rollback a partial or failed migration. Restores each backup over its
 * original and removes any docs/flow/* files the migration produced.
 *
 * Idempotent: missing backups are tolerated (silently skipped) so calling
 * rollback() after a successful migration is a no-op cleanup at worst.
 *
 * @param {string} cwd
 * @param {string} backupTs
 * @param {Object} [opts]
 * @param {boolean} [opts.removeProducedFlowDir=true]
 */
export function rollback(cwd, backupTs, opts = {}) {
  const removeProducedFlowDir = opts.removeProducedFlowDir !== false;
  const candidates = [
    join(cwd, BMAD_SPRINT_REL),
    join(cwd, BMAD_DEFERRED_REL),
    join(cwd, FLOW_SPRINT_REL),
  ];
  for (const orig of candidates) {
    const bk = `${orig}.flow-backup-${backupTs}`;
    if (existsSync(bk)) {
      try { copyFileSync(bk, orig); } catch {}
    }
  }
  if (removeProducedFlowDir) {
    // Only remove docs/flow/ when it was created by THIS migration.
    // Heuristic: if the existing-flow-sprint backup exists, the dir
    // pre-existed; preserve it. Otherwise it's safe to remove.
    const preExisting = existsSync(`${join(cwd, FLOW_SPRINT_REL)}.flow-backup-${backupTs}`);
    if (!preExisting && existsSync(join(cwd, 'docs', 'flow'))) {
      try { rmSync(join(cwd, 'docs', 'flow'), { recursive: true, force: true }); } catch {}
    }
  }
}

/**
 * Top-level migration. Always returns a MigrationResult (never throws
 * for expected failure paths). On failure, the rollback has already
 * been attempted before the result is returned.
 *
 * @param {string} cwd
 * @param {Object} [opts]
 * @param {string} [opts.projectName]
 * @param {Date} [opts.now] - injection point for deterministic backupTs in tests
 * @param {boolean} [opts.dryRun=false] - report what WOULD migrate without
 *   creating backups or writing any files. Returned MigrationResult is
 *   populated with the would-be counts + a synthetic stateRecord so the
 *   orchestrator can still show the plan, but `ok` is true and `backups`
 *   is empty.
 * @returns {MigrationResult}
 */
export function migrate(cwd, opts = {}) {
  const state = findBmadState(cwd);
  const backupTs = makeBackupTs(opts.now);
  const baseResult = {
    backupTs,
    backups: [],
    storiesImported: 0,
    epicsImported: 0,
    deferredImported: 0,
    stateRecord: null,
  };

  if (!state.hasSomethingToMigrate) {
    return {
      ok: false,
      ...baseResult,
      error: `no BMad state to migrate at ${state.sprintStatusPath ?? join(cwd, BMAD_SPRINT_REL)}`,
    };
  }

  // Dry-run path: parse the source so we can report counts, but don't
  // create any backups or write any output. Returns ok=true with a
  // synthetic stateRecord flagged `dry_run: true` so the orchestrator's
  // plan output is accurate but no fs mutations occur.
  if (opts.dryRun) {
    let stories = [];
    try {
      const yamlText = readFileSync(state.sprintStatusPath, 'utf8');
      stories = parseBmadStories(yamlText);
    } catch (err) {
      return { ok: false, ...baseResult, error: err.message };
    }
    const epicsImported = new Set(stories.map(s => s.epicId)).size;
    let deferredImported = 0;
    if (state.deferredPath) {
      try {
        deferredImported = parseBmadDeferred(readFileSync(state.deferredPath, 'utf8')).length;
      } catch { /* deferred is non-critical */ }
    }
    return {
      ok: true,
      backupTs,
      backups: [],
      storiesImported: stories.length,
      epicsImported,
      deferredImported,
      stateRecord: {
        from_version: 'bmad',
        stories_imported: stories.length,
        deferred_imported: deferredImported,
        bmad_kept_in_place: true,
        backups: [],
        backup_ts: backupTs,
        dry_run: true,
        ran_at: new Date().toISOString(),
      },
    };
  }

  // 1. Backup.
  let backups;
  try {
    backups = backupBmadState(state, backupTs);
  } catch (err) {
    return { ok: false, ...baseResult, error: err.message };
  }

  // 2. Parse + 3. Write — wrapped in try/catch so we always attempt rollback on failure.
  try {
    const yamlText = readFileSync(state.sprintStatusPath, 'utf8');
    const stories = parseBmadStories(yamlText);

    // If the source had story keys but parse returned zero stories, the
    // file shape changed in a way we don't understand. Halt + rollback.
    // (We allow the legitimate empty-source case: source parses but has
    //  no story-key entries → migration is a no-op success with 0 imported.)
    const sourceHasContent = /^e\d+-s\d+/im.test(yamlText);
    if (sourceHasContent && stories.length === 0) {
      throw new Error('BMad sprint-status.yaml contains story-shaped keys but none parsed cleanly');
    }

    // Make docs/flow/ + stories/.
    mkdirSync(join(cwd, FLOW_STORIES_DIR_REL), { recursive: true });

    // Write sprint.yaml.
    const sprintYaml = buildFlowSprintYaml(stories, { project: opts.projectName, backupTs });
    writeFileSync(join(cwd, FLOW_SPRINT_REL), sprintYaml);

    // Validate: re-parse the file we just wrote.
    const reparsed = parseYaml(sprintYaml);
    if (!reparsed || !Array.isArray(reparsed.stories)) {
      throw new Error('produced sprint.yaml failed reparse validation');
    }

    // Write per-story stubs.
    for (const story of stories) {
      const stubPath = join(cwd, FLOW_STORIES_DIR_REL, `${story.id}.md`);
      writeFileSync(stubPath, buildStoryStub(story));
    }

    // Deferred work — best-effort. Failure to parse it doesn't abort
    // the whole migration since the sprint is the load-bearing piece.
    let deferredImported = 0;
    if (state.deferredPath) {
      try {
        const md = readFileSync(state.deferredPath, 'utf8');
        const items = parseBmadDeferred(md);
        deferredImported = items.length;
        if (items.length > 0) {
          const out = ['# Deferred work — imported from BMad', '', ...items.map(i => `- ${i}`), ''].join('\n');
          writeFileSync(join(cwd, FLOW_DEFERRED_REL), out);
        }
      } catch {
        // Swallow — deferred is non-critical context, not blocking state.
      }
    }

    const epicsImported = new Set(stories.map(s => s.epicId)).size;
    const stateRecord = {
      from_version: 'bmad',
      stories_imported: stories.length,
      deferred_imported: deferredImported,
      bmad_kept_in_place: true,
      backups,
      backup_ts: backupTs,
      ran_at: new Date().toISOString(),
    };

    return {
      ok: true,
      backupTs,
      backups,
      storiesImported: stories.length,
      epicsImported,
      deferredImported,
      stateRecord,
    };
  } catch (err) {
    // Rollback before returning. We pass the same backupTs so the
    // restore picks up the snapshots we just made.
    rollback(cwd, backupTs);
    return {
      ok: false,
      backupTs,
      backups,
      storiesImported: 0,
      epicsImported: 0,
      deferredImported: 0,
      stateRecord: null,
      error: err.message,
    };
  }
}
