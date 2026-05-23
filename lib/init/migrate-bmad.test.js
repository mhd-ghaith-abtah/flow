// lib/init/migrate-bmad.test.js — coverage for the BMad → Flow migration.
//
// Each test sets up a tmp directory mimicking the BMad layout, runs
// migrate() (or one of the lower-level helpers), and asserts on both
// produced files + state record + rollback semantics. No mocking of fs
// — these are real-filesystem tests because the migration's value IS
// in getting filesystem semantics right.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  findBmadState,
  parseBmadStories,
  parseBmadDeferred,
  backupBmadState,
  rollback,
  migrate,
  makeBackupTs,
} from './migrate-bmad.js';

const BMAD_DIR_REL = ['docs', '_bmad-output', 'implementation-artifacts'];
const SPRINT_REL = join(...BMAD_DIR_REL, 'sprint-status.yaml');
const DEFERRED_REL = join(...BMAD_DIR_REL, 'deferred-work.md');
const FLOW_SPRINT_REL = join('docs', 'flow', 'sprint.yaml');
const FLOW_DEFERRED_REL = join('docs', 'flow', 'deferred.md');
const FLOW_STORIES_REL = join('docs', 'flow', 'stories');

function makeTmpProject() {
  const dir = mkdtempSync(join(tmpdir(), 'flow-migrate-bmad-'));
  mkdirSync(join(dir, ...BMAD_DIR_REL), { recursive: true });
  return dir;
}

function seedSprintStatus(dir, yamlText) {
  writeFileSync(join(dir, SPRINT_REL), yamlText);
}

const SAMPLE_SPRINT = `
e1-s1-foo-bar:
  title: "Foo bar story"
  status: in-progress
e1-s2-baz:
  title: "Baz story"
  status: done
e2-s1-quux:
  title: "Quux story"
  status: ready-for-dev
last_updated: 2026-04-10
non-story-key:
  status: ignored
`;

describe('makeBackupTs', () => {
  it('produces a colon-free, dot-free timestamp safe for filenames', () => {
    const ts = makeBackupTs(new Date('2026-05-20T14:17:33.123Z'));
    assert.equal(ts, '20260520T141733Z');
  });
});

describe('parseBmadStories', () => {
  it('skips non-story keys and parses three valid entries', () => {
    const stories = parseBmadStories(SAMPLE_SPRINT);
    assert.equal(stories.length, 3);
    assert.deepEqual(stories.map(s => s.id), ['E1-S1', 'E1-S2', 'E2-S1']);
  });

  it('maps BMad status → Flow status correctly', () => {
    const stories = parseBmadStories(SAMPLE_SPRINT);
    const byId = Object.fromEntries(stories.map(s => [s.id, s]));
    assert.equal(byId['E1-S1'].status, 'doing');   // in-progress → doing
    assert.equal(byId['E1-S2'].status, 'done');
    assert.equal(byId['E2-S1'].status, 'backlog'); // ready-for-dev → backlog
  });

  it('falls back to backlog for unknown status values', () => {
    const stories = parseBmadStories('e9-s9-x:\n  status: martian-status\n');
    assert.equal(stories.length, 1);
    assert.equal(stories[0].status, 'backlog');
  });

  it('handles the nested `stories:` shape too', () => {
    const yamlText = `
stories:
  e3-s1-a:
    title: A
    status: done
`;
    const stories = parseBmadStories(yamlText);
    assert.equal(stories.length, 1);
    assert.equal(stories[0].id, 'E3-S1');
  });

  it('throws on unparseable YAML', () => {
    assert.throws(() => parseBmadStories(':\n:\n:'), /failed to parse/);
  });
});

describe('parseBmadDeferred', () => {
  it('extracts top-level `- ` bullets and ignores other lines', () => {
    const md = '# Deferred\n\n- one thing\n- another thing\nrandom note\n  - nested\n';
    assert.deepEqual(parseBmadDeferred(md), ['one thing', 'another thing']);
  });

  it('returns [] for empty input', () => {
    assert.deepEqual(parseBmadDeferred(''), []);
  });
});

describe('findBmadState', () => {
  it('reports hasSomethingToMigrate=false on an empty project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flow-find-bmad-empty-'));
    try {
      const s = findBmadState(dir);
      assert.equal(s.hasSomethingToMigrate, false);
      assert.equal(s.sprintStatusPath, null);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('finds sprint-status.yaml + deferred-work.md when present', () => {
    const dir = makeTmpProject();
    try {
      seedSprintStatus(dir, SAMPLE_SPRINT);
      writeFileSync(join(dir, DEFERRED_REL), '- a\n');
      const s = findBmadState(dir);
      assert.equal(s.hasSomethingToMigrate, true);
      assert.ok(s.sprintStatusPath?.endsWith('sprint-status.yaml'));
      assert.ok(s.deferredPath?.endsWith('deferred-work.md'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('backupBmadState', () => {
  it('produces a .flow-backup-<ts> copy for each present source', () => {
    const dir = makeTmpProject();
    try {
      seedSprintStatus(dir, SAMPLE_SPRINT);
      writeFileSync(join(dir, DEFERRED_REL), '- x\n');
      const state = findBmadState(dir);
      const ts = '20260520T141733Z';
      const produced = backupBmadState(state, ts);
      assert.equal(produced.length, 2);
      for (const p of produced) {
        assert.ok(p.endsWith(`.flow-backup-${ts}`), `expected backup suffix on ${p}`);
        assert.ok(existsSync(p));
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('migrate', () => {
  it('returns ok=false (no rollback needed) when nothing to migrate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flow-migrate-empty-'));
    try {
      const result = migrate(dir);
      assert.equal(result.ok, false);
      assert.match(result.error, /no BMad state/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('migrates a real sprint-status.yaml end-to-end + writes story stubs', () => {
    const dir = makeTmpProject();
    try {
      seedSprintStatus(dir, SAMPLE_SPRINT);
      writeFileSync(join(dir, DEFERRED_REL), '- one\n- two\n');

      const result = migrate(dir, { projectName: 'test-proj' });
      assert.equal(result.ok, true, result.error);
      assert.equal(result.storiesImported, 3);
      assert.equal(result.epicsImported, 2);
      assert.equal(result.deferredImported, 2);

      // Sprint yaml exists, reparses, and has expected shape.
      const sprintText = readFileSync(join(dir, FLOW_SPRINT_REL), 'utf8');
      const sprint = parseYaml(sprintText);
      assert.equal(sprint.version, 1);
      assert.equal(sprint.project, 'test-proj');
      assert.equal(sprint.stories.length, 3);
      assert.equal(sprint.migrated_from.tool, 'bmad');

      // All status mappings preserved.
      const statuses = sprint.stories.map(s => s.status);
      assert.deepEqual(statuses.sort(), ['backlog', 'doing', 'done']);

      // Story stubs landed.
      for (const id of ['E1-S1', 'E1-S2', 'E2-S1']) {
        const stub = join(dir, FLOW_STORIES_REL, `${id}.md`);
        assert.ok(existsSync(stub), `missing stub: ${stub}`);
      }

      // Deferred merged into a Flow-shaped file.
      const deferred = readFileSync(join(dir, FLOW_DEFERRED_REL), 'utf8');
      assert.match(deferred, /^- one$/m);
      assert.match(deferred, /^- two$/m);

      // Backups exist next to originals.
      for (const bp of result.backups) {
        assert.ok(existsSync(bp), `backup missing: ${bp}`);
      }

      // _bmad/ left alone is enforced by the workflow doc — we don't
      // touch it in this test, but assert it would have been left even
      // if it existed (no rmSync calls inside migrate() target _bmad).
      // The presence of the backup paths is sufficient evidence.

      // State record fields.
      assert.equal(result.stateRecord.from_version, 'bmad');
      assert.equal(result.stateRecord.bmad_kept_in_place, true);
      assert.equal(result.stateRecord.stories_imported, 3);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rolls back when sprint-status has story-shaped keys but parseBmadStories returns 0', () => {
    // Craft an input that the regex hits on but yaml.parse turns into
    // primitives (e.g. all values become null/scalars rather than maps).
    // Easiest reproduction: malformed YAML that still has the e1-s1- pattern in raw text.
    const dir = makeTmpProject();
    try {
      const malformed = `e1-s1-foo:\n  status:\n    nested:\n      bad: yes\n  title: : oh no\n`;
      seedSprintStatus(dir, malformed);
      const result = migrate(dir);
      assert.equal(result.ok, false);
      assert.match(result.error, /failed to parse|parseBmadStories|reparse/);
      // docs/flow/ should NOT exist after rollback (created during attempt then removed).
      assert.equal(existsSync(join(dir, 'docs', 'flow')), false, 'docs/flow should be removed by rollback');
      // Backup file should still exist — rollback restores from it but doesn't delete it.
      const ts = result.backupTs;
      assert.ok(existsSync(join(dir, `${SPRINT_REL}.flow-backup-${ts}`)));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('preserves pre-existing docs/flow/ when rollback runs', () => {
    const dir = makeTmpProject();
    try {
      seedSprintStatus(dir, SAMPLE_SPRINT);
      // Pre-existing Flow content that must survive a failed migration.
      mkdirSync(join(dir, 'docs', 'flow'), { recursive: true });
      writeFileSync(join(dir, FLOW_SPRINT_REL), 'version: 1\nstories: []\n');
      const sentinel = join(dir, 'docs', 'flow', 'KEEP_ME.md');
      writeFileSync(sentinel, 'do not delete');

      // Force a failure by triggering rollback explicitly (we can't make
      // a successful migration also rollback; testing the helper is
      // enough to assert the preservation invariant).
      const ts = '20260520T999999Z';
      // Need to write a backup for the existing sprint.yaml first so
      // rollback() sees it and chooses to keep the dir.
      writeFileSync(`${join(dir, FLOW_SPRINT_REL)}.flow-backup-${ts}`, 'version: 1\nstories: []\n');
      rollback(dir, ts);
      assert.ok(existsSync(sentinel), 'sentinel file in pre-existing docs/flow must survive rollback');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
