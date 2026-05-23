// lib/sprint/store.js — load/save docs/flow/sprint.yaml with round-trip
// preservation. Uses yaml's Document API rather than parse+stringify so
// comments + ordering in the user's hand-edited file survive each
// mutation. The skill workflow's pure-YAML ops mutate sprint.yaml dozens
// of times during a sprint; an in-place stringify would shred the
// user's annotations.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseDocument, isMap, isSeq } from 'yaml';

const DEFAULT_SPRINT_REL = join('docs', 'flow', 'sprint.yaml');

/**
 * @typedef {Object} SprintStore
 * @property {import('yaml').Document} doc - mutable round-trip Document
 * @property {string} path - absolute path the doc was loaded from
 * @property {Object} json - the parsed plain-object view (read-only;
 *   regenerated on demand)
 */

/**
 * Locate sprint.yaml from a starting directory. Walks up looking for
 * docs/flow/sprint.yaml so callers can run `flow sprint status` from
 * anywhere inside the project.
 *
 * @param {string} startDir
 * @returns {string|null}
 */
export function findSprintFile(startDir) {
  let cur = resolve(startDir);
  for (;;) {
    const candidate = join(cur, DEFAULT_SPRINT_REL);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/**
 * Load the sprint.yaml file as a round-trip Document. Caller mutates
 * `store.doc` and then calls saveSprint(store) to persist.
 *
 * @param {string} path
 * @returns {SprintStore}
 */
export function loadSprint(path) {
  if (!existsSync(path)) {
    throw new Error(`sprint.yaml not found: ${path}`);
  }
  const text = readFileSync(path, 'utf8');
  const doc = parseDocument(text, { keepSourceTokens: true });
  if (doc.errors && doc.errors.length > 0) {
    throw new Error(`sprint.yaml parse errors: ${doc.errors.map(e => e.message).join('; ')}`);
  }
  return { doc, path, json: doc.toJSON() };
}

/**
 * Persist the sprint document back to disk. Updates `last_updated` so
 * the user can see when the file was last touched without diving into
 * git.
 *
 * @param {SprintStore} store
 */
export function saveSprint(store) {
  // Touch last_updated before serialization.
  store.doc.set('last_updated', new Date().toISOString());
  mkdirSync(dirname(store.path), { recursive: true });
  writeFileSync(store.path, store.doc.toString());
  store.json = store.doc.toJSON();
}

/**
 * Find a story by id. Returns `{ index, story }` or null. Index lets
 * callers mutate the YAML sequence directly via `doc.getIn(['stories', index, 'status'], ...)`.
 *
 * @param {SprintStore} store
 * @param {string} id
 * @returns {{index: number, story: Object}|null}
 */
export function findStory(store, id) {
  const stories = store.doc.get('stories');
  if (!isSeq(stories)) return null;
  for (let i = 0; i < stories.items.length; i += 1) {
    const node = stories.items[i];
    if (!isMap(node)) continue;
    if (node.get('id') === id) return { index: i, story: node.toJSON() };
  }
  return null;
}

/**
 * Find an epic by id.
 *
 * @param {SprintStore} store
 * @param {string} id
 * @returns {{index: number, epic: Object}|null}
 */
export function findEpic(store, id) {
  const epics = store.doc.get('epics');
  if (!isSeq(epics)) return null;
  for (let i = 0; i < epics.items.length; i += 1) {
    const node = epics.items[i];
    if (!isMap(node)) continue;
    if (node.get('id') === id) return { index: i, epic: node.toJSON() };
  }
  return null;
}
