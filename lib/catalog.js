// lib/catalog.js — load and resolve flow's catalog.yaml.
//
// Minimal v0.7 implementation: parse YAML, resolve profile inheritance, expose
// helpers for `flow plan` and `flow init`. JSON-schema validation lands when
// schemas/catalog.schema.json is finalized (tracked in task #9).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * @typedef {Object} Profile
 * @property {string} description
 * @property {string[]} flow_components
 * @property {string[]} adapters
 * @property {string[]} mcps
 * @property {string} bmad_subset
 * @property {string} ecc_subset
 * @property {string} caveman_subset
 * @property {Object} [features]
 */

/**
 * @typedef {Object} Catalog
 * @property {number} version
 * @property {string} flow_version_compat
 * @property {Array<Object>} flow_components
 * @property {Array<Object>} adapters
 * @property {Object} [mcps]
 * @property {Object} [upstreams]
 * @property {Record<string, RawProfile>} profiles
 */

/**
 * @typedef {Object} RawProfile
 * @property {string} description
 * @property {string} [extends]
 * @property {string[]} [flow_components]
 * @property {string[]} [adapters]
 * @property {string[]} [mcps]
 * @property {string} [bmad_subset]
 * @property {string} [ecc_subset]
 * @property {string} [caveman_subset]
 * @property {Object} [features]
 */

/**
 * Load and parse catalog.yaml from the given repo root.
 * @param {string} repoRoot
 * @returns {Catalog}
 */
export function loadCatalog(repoRoot) {
  const catalogPath = resolve(repoRoot, 'catalog.yaml');
  const raw = readFileSync(catalogPath, 'utf-8');
  const catalog = parseYaml(raw);

  if (!catalog || typeof catalog !== 'object') {
    throw new Error(`catalog.yaml at ${catalogPath} did not parse to an object`);
  }
  if (!catalog.profiles || typeof catalog.profiles !== 'object') {
    throw new Error(`catalog.yaml has no 'profiles' section`);
  }
  return catalog;
}

/**
 * Resolve a profile name to its fully-merged spec (walks `extends:` chain).
 * Adapter lists override family-by-family (later profile wins per family).
 * @param {Catalog} catalog
 * @param {string} profileName
 * @returns {Profile}
 */
export function resolveProfile(catalog, profileName) {
  const seen = new Set();
  const chain = [];
  let cursor = profileName;
  while (cursor) {
    if (seen.has(cursor)) {
      throw new Error(`Profile inheritance cycle detected at '${cursor}'`);
    }
    seen.add(cursor);
    const profile = catalog.profiles[cursor];
    if (!profile) {
      throw new Error(`Profile '${cursor}' not found in catalog. Available: ${Object.keys(catalog.profiles).join(', ')}`);
    }
    chain.unshift(profile);
    cursor = profile.extends;
  }

  // Merge: later entries in the chain override earlier ones. For adapters,
  // override by family (one adapter per family — later wins).
  const merged = {
    description: '',
    flow_components: [],
    adapters: [],
    mcps: [],
    bmad_subset: 'none',
    ecc_subset: 'none',
    caveman_subset: 'full',
    features: {}
  };

  for (const layer of chain) {
    if (layer.description) merged.description = layer.description;
    if (layer.flow_components) merged.flow_components = uniq([...merged.flow_components, ...layer.flow_components]);
    if (layer.adapters) merged.adapters = mergeAdapters(merged.adapters, layer.adapters, catalog);
    if (layer.mcps) merged.mcps = uniq([...merged.mcps, ...layer.mcps]);
    if (layer.bmad_subset) merged.bmad_subset = layer.bmad_subset;
    if (layer.ecc_subset) merged.ecc_subset = layer.ecc_subset;
    if (layer.caveman_subset) merged.caveman_subset = layer.caveman_subset;
    if (layer.features) merged.features = { ...merged.features, ...layer.features };
  }
  return merged;
}

/**
 * Adapters are keyed by family — replacing one adapter for a family overrides
 * any previously-merged adapter for the same family.
 * @param {string[]} current
 * @param {string[]} incoming
 * @param {Catalog} catalog
 * @returns {string[]}
 */
function mergeAdapters(current, incoming, catalog) {
  const byFamily = new Map();
  for (const id of [...current, ...incoming]) {
    const adapter = catalog.adapters.find(a => a.id === id);
    const family = adapter ? adapter.family : id.split(':')[1]?.split('-')[0] ?? id;
    byFamily.set(family, id);
  }
  return [...byFamily.values()];
}

function uniq(arr) {
  return [...new Set(arr)];
}

/**
 * List all available profile names.
 * @param {Catalog} catalog
 * @returns {string[]}
 */
export function listProfiles(catalog) {
  return Object.keys(catalog.profiles);
}
