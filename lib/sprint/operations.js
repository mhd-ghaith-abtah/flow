// lib/sprint/operations.js — pure-YAML sprint operations.
//
// Each operation mutates the SprintStore's Document in place and
// returns a result describing what changed. The orchestrator (the
// `flow sprint <subcommand>` CLI) calls saveSprint(store) once after a
// successful mutation; on validation failure the doc stays untouched so
// the caller can present a clean error without partial state.
//
// What this module deliberately does NOT do:
//   - git ops (branch checkout, pull, branch delete) — those belong
//     in the /flow-story skill, not the headless sprint CLI
//   - PR / issue-tracker adapter calls — same reason; CLI is pure data
//   - LLM-driven id-format detection — the CLI requires an explicit
//     --id flag rather than guessing. Skill workflow keeps the smart
//     auto-id behavior; CLI is the strict-parser path.

import { isSeq } from 'yaml';
import { findEpic, findStory } from './store.js';

const VALID_STATUSES = Object.freeze(['backlog', 'doing', 'review', 'done', 'cancelled']);

/**
 * Append a story to sprint.yaml. Caller supplies all data — no
 * prompting, no auto-id generation.
 *
 * @param {import('./store.js').SprintStore} store
 * @param {Object} input
 * @param {string} input.id
 * @param {string} input.title
 * @param {string} input.epic
 * @param {string} [input.status='backlog']
 * @param {string[]} [input.tags]
 * @param {string} [input.why]
 * @param {string} [input.issue]
 * @returns {{ok: boolean, story?: Object, error?: string}}
 */
export function addStory(store, input) {
  if (!input.id) return { ok: false, error: 'add: missing required --id' };
  if (!input.title) return { ok: false, error: 'add: missing required --title' };
  if (!input.epic) return { ok: false, error: 'add: missing required --epic' };
  const status = input.status || 'backlog';
  if (!VALID_STATUSES.includes(status)) {
    return { ok: false, error: `add: invalid status "${status}" (valid: ${VALID_STATUSES.join(', ')})` };
  }
  if (findStory(store, input.id)) {
    return { ok: false, error: `add: story ${input.id} already exists` };
  }
  if (!findEpic(store, input.epic)) {
    return { ok: false, error: `add: epic ${input.epic} not declared in sprint.yaml epics` };
  }

  const story = {
    id: input.id,
    title: input.title,
    epic: input.epic,
    status,
  };
  if (Array.isArray(input.tags) && input.tags.length > 0) story.tags = input.tags;
  if (input.why) story.why = input.why;
  if (input.issue) story.issue = input.issue;

  const stories = store.doc.get('stories');
  if (!isSeq(stories)) {
    // Empty / null stories field — create a new sequence.
    store.doc.set('stories', [story]);
  } else {
    stories.add(story);
  }
  return { ok: true, story };
}

/**
 * Pick the first backlog story (preserving YAML order) and flip it to
 * `doing`. Returns the story so the CLI can print details.
 *
 * @param {import('./store.js').SprintStore} store
 * @param {Object} [opts]
 * @param {string} [opts.epic] - restrict pick to one epic
 * @returns {{ok: boolean, story?: Object, error?: string}}
 */
export function nextStory(store, opts = {}) {
  const stories = store.doc.get('stories');
  if (!isSeq(stories) || stories.items.length === 0) {
    return { ok: false, error: 'next: no stories in sprint.yaml' };
  }
  for (let i = 0; i < stories.items.length; i += 1) {
    const node = stories.items[i];
    const s = node.toJSON();
    if (s.status !== 'backlog') continue;
    if (opts.epic && s.epic !== opts.epic) continue;
    node.set('status', 'doing');
    node.set('started_at', new Date().toISOString().slice(0, 10));
    return { ok: true, story: { ...s, status: 'doing' } };
  }
  return { ok: false, error: `next: no backlog stories${opts.epic ? ` in epic ${opts.epic}` : ''}` };
}

/**
 * Flip a story's status to a target value. Used by both `done` (status=done)
 * and arbitrary status updates if the CLI grows them later.
 *
 * @param {import('./store.js').SprintStore} store
 * @param {string} id
 * @param {string} status
 * @param {Object} [opts]
 * @param {boolean} [opts.force=false] - allow done from any source status
 * @param {string} [opts.note] - appended to the story's notes array
 * @returns {{ok: boolean, story?: Object, error?: string}}
 */
export function setStatus(store, id, status, opts = {}) {
  if (!VALID_STATUSES.includes(status)) {
    return { ok: false, error: `setStatus: invalid status "${status}" (valid: ${VALID_STATUSES.join(', ')})` };
  }
  const found = findStory(store, id);
  if (!found) return { ok: false, error: `setStatus: story ${id} not found` };

  // For `done` specifically, require source = review unless --force.
  if (status === 'done' && !opts.force) {
    const current = found.story.status;
    if (current !== 'review' && current !== 'doing') {
      return { ok: false, error: `setStatus: ${id} status is "${current}" — done expects "review" or "doing" (use --force to override)` };
    }
  }

  const node = store.doc.get('stories').items[found.index];
  node.set('status', status);
  if (status === 'done') {
    node.set('completed_at', new Date().toISOString().slice(0, 10));
  }
  if (opts.note) {
    // Notes is conceptually an append-only list; create or extend.
    const existing = node.get('notes');
    const noteEntry = { date: new Date().toISOString().slice(0, 10), text: opts.note };
    if (isSeq(existing)) existing.add(noteEntry);
    else node.set('notes', [noteEntry]);
  }
  return { ok: true, story: { ...found.story, status } };
}

/**
 * Return a grouped + summarized view of the sprint state — for the
 * `flow sprint status` CLI command. Pure: doesn't mutate, doesn't read
 * external state (PR queue, deferred-work file). Those layers live in
 * the CLI command, not here.
 *
 * @param {import('./store.js').SprintStore} store
 * @returns {{
 *   epics: Array<{id: string, title: string, status: string, done: number, total: number, stories: Object[]}>,
 *   counts: {backlog: number, doing: number, review: number, done: number, cancelled: number, total: number},
 * }}
 */
export function summarize(store) {
  const data = store.doc.toJSON();
  const stories = Array.isArray(data.stories) ? data.stories : [];
  const epics = Array.isArray(data.epics) ? data.epics : [];

  const counts = { backlog: 0, doing: 0, review: 0, done: 0, cancelled: 0, total: 0 };
  for (const s of stories) {
    counts.total += 1;
    if (Object.prototype.hasOwnProperty.call(counts, s.status)) counts[s.status] += 1;
  }

  // Group stories by epic id; pick up orphan-epic stories under a sentinel.
  const byEpic = new Map();
  for (const ep of epics) byEpic.set(ep.id, { ...ep, stories: [], done: 0, total: 0 });
  const orphanBucket = { id: '(no-epic)', title: 'Unassigned', status: 'in-progress', stories: [], done: 0, total: 0 };
  for (const s of stories) {
    const bucket = byEpic.get(s.epic) || orphanBucket;
    bucket.stories.push(s);
    bucket.total += 1;
    if (s.status === 'done') bucket.done += 1;
  }
  const epicViews = [...byEpic.values()];
  if (orphanBucket.total > 0) epicViews.push(orphanBucket);

  return { epics: epicViews, counts };
}

/**
 * Read + parse the deferred-work file. Each `- ` bullet is one item;
 * lines starting with `- [x]` are resolved. Returns { open, resolved }
 * arrays plus counts.
 *
 * @param {string} text
 * @returns {{open: string[], resolved: string[]}}
 */
export function parseDeferred(text) {
  const open = [];
  const resolved = [];
  if (!text) return { open, resolved };
  for (const line of text.split('\n')) {
    if (/^- \[x\]/i.test(line)) {
      resolved.push(line.replace(/^- \[x\]\s*/i, '').trim());
    } else if (/^- /.test(line)) {
      open.push(line.replace(/^- \[ ?\]\s*/, '').replace(/^- /, '').trim());
    }
  }
  return { open, resolved };
}

export { VALID_STATUSES };
