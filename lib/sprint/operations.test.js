// lib/sprint/operations.test.js — coverage for pure-YAML sprint ops.
//
// Each test builds a tmp sprint.yaml, loads it, mutates, saves, then
// re-loads to confirm round-trip preservation. We use loadSprint /
// saveSprint instead of building YAML docs by hand so the tests exercise
// the same code path the CLI will.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { loadSprint, saveSprint, findStory, findEpic, findSprintFile } from './store.js';
import { addStory, nextStory, setStatus, summarize, parseDeferred, VALID_STATUSES } from './operations.js';

function tmpSprint(yamlText) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-sprint-ops-'));
  mkdirSync(join(dir, 'docs', 'flow'), { recursive: true });
  const path = join(dir, 'docs', 'flow', 'sprint.yaml');
  writeFileSync(path, yamlText);
  return { dir, path };
}

const SEED = `version: 1
project: test
last_updated: 2026-05-23T00:00:00Z

epics:
  - id: E1
    title: Foundation
    status: in-progress
  - id: E2
    title: Cross-platform
    status: backlog

stories:
  - id: E1-001
    title: Bootstrap project
    epic: E1
    status: done
  - id: E1-002
    title: Add CI
    epic: E1
    status: review
  - id: E2-001
    title: Plumbing
    epic: E2
    status: backlog
`;

describe('findSprintFile', () => {
  it('walks up parents looking for docs/flow/sprint.yaml', () => {
    const { dir, path } = tmpSprint(SEED);
    try {
      const nested = join(dir, 'src', 'deep', 'nested');
      mkdirSync(nested, { recursive: true });
      assert.equal(findSprintFile(nested), path);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('returns null when no sprint.yaml exists above the start dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flow-sprint-nofind-'));
    try {
      assert.equal(findSprintFile(dir), null);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('addStory', () => {
  it('appends a valid story and persists to disk', () => {
    const { dir, path } = tmpSprint(SEED);
    try {
      const store = loadSprint(path);
      const r = addStory(store, { id: 'E2-002', title: 'New thing', epic: 'E2', tags: ['cli'] });
      assert.equal(r.ok, true);
      saveSprint(store);
      const reloaded = parseYaml(readFileSync(path, 'utf8'));
      assert.ok(reloaded.stories.find(s => s.id === 'E2-002'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects a duplicate id without mutating the doc', () => {
    const { dir, path } = tmpSprint(SEED);
    try {
      const store = loadSprint(path);
      const before = store.doc.toString();
      const r = addStory(store, { id: 'E1-001', title: 'dup', epic: 'E1' });
      assert.equal(r.ok, false);
      assert.match(r.error, /already exists/);
      assert.equal(store.doc.toString(), before, 'doc should be untouched on error');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects unknown epic', () => {
    const { dir, path } = tmpSprint(SEED);
    try {
      const store = loadSprint(path);
      const r = addStory(store, { id: 'EX-001', title: 't', epic: 'EX' });
      assert.equal(r.ok, false);
      assert.match(r.error, /not declared/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects missing required fields', () => {
    const { dir, path } = tmpSprint(SEED);
    try {
      const store = loadSprint(path);
      assert.equal(addStory(store, { title: 't', epic: 'E1' }).ok, false);
      assert.equal(addStory(store, { id: 'X', epic: 'E1' }).ok, false);
      assert.equal(addStory(store, { id: 'X', title: 't' }).ok, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('nextStory', () => {
  it('flips the first backlog story to doing', () => {
    const { dir, path } = tmpSprint(SEED);
    try {
      const store = loadSprint(path);
      const r = nextStory(store);
      assert.equal(r.ok, true);
      assert.equal(r.story.id, 'E2-001');
      assert.equal(r.story.status, 'doing');
      saveSprint(store);
      const reloaded = parseYaml(readFileSync(path, 'utf8'));
      const target = reloaded.stories.find(s => s.id === 'E2-001');
      assert.equal(target.status, 'doing');
      assert.match(target.started_at, /^\d{4}-\d{2}-\d{2}$/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('returns error when no backlog stories exist', () => {
    const { dir, path } = tmpSprint(`version: 1\nepics: []\nstories: []\n`);
    try {
      const store = loadSprint(path);
      const r = nextStory(store);
      assert.equal(r.ok, false);
      assert.match(r.error, /no stories/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('restricts to a specific epic when --epic is passed', () => {
    const yaml = `version: 1
epics:
  - { id: E1, title: a, status: backlog }
  - { id: E2, title: b, status: backlog }
stories:
  - { id: E1-001, title: a1, epic: E1, status: backlog }
  - { id: E2-001, title: b1, epic: E2, status: backlog }
`;
    const { dir, path } = tmpSprint(yaml);
    try {
      const store = loadSprint(path);
      const r = nextStory(store, { epic: 'E2' });
      assert.equal(r.ok, true);
      assert.equal(r.story.id, 'E2-001');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('setStatus / done', () => {
  it('flips review → done and stamps completed_at', () => {
    const { dir, path } = tmpSprint(SEED);
    try {
      const store = loadSprint(path);
      const r = setStatus(store, 'E1-002', 'done');
      assert.equal(r.ok, true);
      saveSprint(store);
      const reloaded = parseYaml(readFileSync(path, 'utf8'));
      const target = reloaded.stories.find(s => s.id === 'E1-002');
      assert.equal(target.status, 'done');
      assert.match(target.completed_at, /^\d{4}-\d{2}-\d{2}$/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses done from backlog without --force', () => {
    const { dir, path } = tmpSprint(SEED);
    try {
      const store = loadSprint(path);
      const r = setStatus(store, 'E2-001', 'done');
      assert.equal(r.ok, false);
      assert.match(r.error, /expects "review" or "doing"/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('--force allows done from backlog', () => {
    const { dir, path } = tmpSprint(SEED);
    try {
      const store = loadSprint(path);
      const r = setStatus(store, 'E2-001', 'done', { force: true });
      assert.equal(r.ok, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('appends note when supplied', () => {
    const { dir, path } = tmpSprint(SEED);
    try {
      const store = loadSprint(path);
      setStatus(store, 'E1-002', 'done', { note: 'PR auto-merged' });
      saveSprint(store);
      const reloaded = parseYaml(readFileSync(path, 'utf8'));
      const target = reloaded.stories.find(s => s.id === 'E1-002');
      assert.ok(Array.isArray(target.notes));
      assert.equal(target.notes[0].text, 'PR auto-merged');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects invalid status values', () => {
    const { dir, path } = tmpSprint(SEED);
    try {
      const store = loadSprint(path);
      const r = setStatus(store, 'E1-001', 'martian');
      assert.equal(r.ok, false);
      assert.match(r.error, /invalid status/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('VALID_STATUSES exports the right set', () => {
    assert.deepEqual([...VALID_STATUSES].sort(), ['backlog', 'cancelled', 'doing', 'done', 'review']);
  });
});

describe('summarize', () => {
  it('groups stories by epic + computes per-epic + overall counts', () => {
    const { dir, path } = tmpSprint(SEED);
    try {
      const store = loadSprint(path);
      const s = summarize(store);
      assert.equal(s.counts.total, 3);
      assert.equal(s.counts.done, 1);
      assert.equal(s.counts.review, 1);
      assert.equal(s.counts.backlog, 1);
      const e1 = s.epics.find(e => e.id === 'E1');
      assert.equal(e1.total, 2);
      assert.equal(e1.done, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('puts orphan-epic stories under (no-epic) bucket', () => {
    const yaml = `version: 1
epics:
  - { id: E1, title: a, status: backlog }
stories:
  - { id: E1-001, title: a, epic: E1, status: backlog }
  - { id: X-001, title: orphan, epic: EX, status: backlog }
`;
    const { dir, path } = tmpSprint(yaml);
    try {
      const store = loadSprint(path);
      const s = summarize(store);
      const orphan = s.epics.find(e => e.id === '(no-epic)');
      assert.ok(orphan, 'should have orphan bucket');
      assert.equal(orphan.total, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('parseDeferred', () => {
  it('separates open vs resolved items', () => {
    const md = `# deferred

- open thing
- [ ] explicitly open
- [x] resolved thing
- another open
random note
`;
    const { open, resolved } = parseDeferred(md);
    assert.deepEqual(open.sort(), ['another open', 'explicitly open', 'open thing']);
    assert.deepEqual(resolved, ['resolved thing']);
  });

  it('empty input returns empty arrays', () => {
    const r = parseDeferred('');
    assert.deepEqual(r.open, []);
    assert.deepEqual(r.resolved, []);
  });
});

describe('store round-trip', () => {
  it('preserves comments + ordering across load → mutate → save', () => {
    const seedWithComments = `# This is a load-bearing comment.
version: 1
project: test

# Epics block intentionally split for readability.
epics:
  - id: E1
    title: First
    status: backlog

stories: []
`;
    const { dir, path } = tmpSprint(seedWithComments);
    try {
      const store = loadSprint(path);
      addStory(store, { id: 'E1-001', title: 'hello', epic: 'E1' });
      saveSprint(store);
      const out = readFileSync(path, 'utf8');
      assert.match(out, /# This is a load-bearing comment\./);
      assert.match(out, /# Epics block intentionally split for readability\./);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('findStory / findEpic', () => {
  it('locates stories + epics by id', () => {
    const { dir, path } = tmpSprint(SEED);
    try {
      const store = loadSprint(path);
      assert.equal(findStory(store, 'E1-002')?.story.title, 'Add CI');
      assert.equal(findStory(store, 'missing'), null);
      assert.equal(findEpic(store, 'E2')?.epic.title, 'Cross-platform');
      assert.equal(findEpic(store, 'EX'), null);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
