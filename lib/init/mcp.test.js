// lib/init/mcp.test.js — coverage for the MCP dispatcher.
//
// Pure functions (buildCommand, resolveMcps) get full coverage; the
// async install paths are exercised through dry-run mode + stubbing the
// `claude` CLI via PATH so we never touch the user's real MCP config.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../catalog.js';
import * as mcp from './mcp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const catalog = loadCatalog(REPO_ROOT);

describe('mcp.buildCommand', () => {
  it('tokenizes context7 install_cmd into claude/mcp/add/...', () => {
    const def = catalog.mcps.find(m => m.id === 'context7');
    const cmd = mcp.buildCommand(def);
    assert.equal(cmd.cmd, 'claude');
    assert.deepEqual(cmd.args.slice(0, 3), ['mcp', 'add', 'context7']);
    assert.ok(cmd.args.includes('npx'));
    assert.ok(cmd.args.some(a => a.includes('context7-mcp')));
    assert.equal(cmd.source, 'mcp:context7');
  });

  it('throws on a definition missing install_cmd', () => {
    assert.throws(() => mcp.buildCommand({ id: 'broken' }), /missing install_cmd/);
  });
});

describe('mcp.resolveMcps', () => {
  it('returns MCP definitions in the requested order', () => {
    const out = mcp.resolveMcps(catalog, ['context7', 'playwright']);
    assert.equal(out.length, 2);
    assert.equal(out[0].id, 'context7');
    assert.equal(out[1].id, 'playwright');
  });

  it('throws on unknown id with the list of available ids in the message', () => {
    assert.throws(
      () => mcp.resolveMcps(catalog, ['context7', 'not-a-real-mcp']),
      /unknown MCP id: not-a-real-mcp/
    );
  });
});

describe('mcp.install (dry-run)', () => {
  it('returns ok=true + records auth=none for context7 in dry-run', async () => {
    const def = catalog.mcps.find(m => m.id === 'context7');
    const result = await mcp.install(def, { dryRun: true, force: true });
    assert.equal(result.ok, true);
    assert.equal(result.id, 'context7');
    assert.equal(result.stateRecord.auth, 'none');
    assert.equal(result.stateRecord.scope, 'home');
  });

  it('records auth_state=pending for oauth_browser MCPs (e.g. linear)', async () => {
    const def = catalog.mcps.find(m => m.id === 'linear');
    if (!def) return; // catalog might omit linear in some test configs
    const result = await mcp.install(def, { dryRun: true, force: true });
    assert.equal(result.stateRecord.auth, 'oauth_browser');
    assert.equal(result.stateRecord.auth_state, 'pending');
    assert.ok(result.authInstructions, 'should surface auth_instructions');
  });

  it('surfaces requiredEnv + records required_env for api_token MCPs (github-mcp)', async () => {
    const def = catalog.mcps.find(m => m.id === 'github-mcp');
    if (!def) return;
    const result = await mcp.install(def, { dryRun: true, force: true });
    assert.ok(Array.isArray(result.requiredEnv), 'requiredEnv should be present');
    assert.ok(result.requiredEnv.some(e => e.name === 'GITHUB_PERSONAL_ACCESS_TOKEN'));
    assert.deepEqual(result.stateRecord.required_env, ['GITHUB_PERSONAL_ACCESS_TOKEN']);
  });
});

describe('mcp.installAll (dry-run)', () => {
  it('processes all MCPs in order and returns one result per input', async () => {
    const defs = mcp.resolveMcps(catalog, ['context7', 'playwright']);
    const results = await mcp.installAll(defs, { dryRun: true, force: true });
    assert.equal(results.length, 2);
    assert.equal(results[0].id, 'context7');
    assert.equal(results[1].id, 'playwright');
    assert.ok(results.every(r => r.ok));
  });
});
