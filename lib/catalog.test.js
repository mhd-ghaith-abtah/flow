// lib/catalog.test.js — minimal smoke tests for the catalog resolver.
// Run via `npm test` (node --test).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, resolveProfile, listProfiles } from './catalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

describe('catalog', () => {
  const catalog = loadCatalog(REPO_ROOT);

  it('parses with required top-level keys', () => {
    assert.equal(catalog.version, 1);
    assert.ok(catalog.profiles);
    assert.ok(catalog.flow_components);
    assert.ok(catalog.adapters);
  });

  it('lists the four built-in profiles', () => {
    const profiles = listProfiles(catalog).sort();
    assert.deepEqual(profiles, ['mini', 'minimal', 'standard', 'team']);
  });

  it('resolves minimal profile (no inheritance)', () => {
    const p = resolveProfile(catalog, 'minimal');
    assert.equal(p.bmad_subset, 'none');
    assert.equal(p.ecc_subset, 'none');
    assert.equal(p.caveman_subset, 'full');
    assert.ok(p.flow_components.includes('core:flow-skills'));
  });

  it('resolves standard profile (extends mini, extends minimal)', () => {
    const p = resolveProfile(catalog, 'standard');
    assert.equal(p.bmad_subset, 'planning-only');
    assert.equal(p.ecc_subset, 'flow-essentials-plus-tdd');
    assert.ok(p.mcps.includes('context7'));
    assert.ok(p.mcps.includes('playwright'));
    // standard adds e2e-playwright-mcp on top of mini's adapters
    assert.ok(p.adapters.includes('adapter:e2e-playwright-mcp'));
  });

  it('resolves team profile (overrides issue-tracker family)', () => {
    const p = resolveProfile(catalog, 'team');
    // team should override github-issues with linear (later wins per family)
    assert.ok(p.adapters.includes('adapter:issue-tracker-linear'));
    assert.ok(!p.adapters.includes('adapter:issue-tracker-github-issues'));
    assert.equal(p.bmad_subset, 'full');
  });

  it('throws on unknown profile', () => {
    assert.throws(() => resolveProfile(catalog, 'bogus'), /not found/);
  });
});

describe('catalog schema', () => {
  it('validates the shipped catalog against schemas/catalog.schema.json', () => {
    // loadCatalog runs ajv when schema is present. This passing means the
    // shipped catalog conforms.
    assert.doesNotThrow(() => loadCatalog(REPO_ROOT, { validate: true }));
  });
});

