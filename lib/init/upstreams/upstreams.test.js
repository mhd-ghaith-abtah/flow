// lib/init/upstreams/upstreams.test.js — coverage for the three upstream
// dispatchers. Tests focus on the pure `buildCommand` surface plus
// `install` in dry-run mode so we never actually shell out.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../catalog.js';
import * as bmad from './bmad.js';
import * as ecc from './ecc.js';
import * as caveman from './caveman.js';
import { tokenizeCommand, firstExistingPath } from './common.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const catalog = loadCatalog(REPO_ROOT);

describe('common helpers', () => {
  it('tokenizeCommand splits on whitespace and respects double-quoted segments', () => {
    const toks = tokenizeCommand('npx -y -p "github:owner/repo#tag" install');
    assert.deepEqual(toks, ['npx', '-y', '-p', 'github:owner/repo#tag', 'install']);
  });

  it('tokenizeCommand handles single-quoted segments too', () => {
    const toks = tokenizeCommand("foo --flag 'value with spaces' bar");
    assert.deepEqual(toks, ['foo', '--flag', 'value with spaces', 'bar']);
  });

  it('firstExistingPath returns null when no candidate exists', () => {
    const r = firstExistingPath(['/nonexistent/a', '/nonexistent/b'], '/tmp');
    assert.equal(r, null);
  });

  it('firstExistingPath expands ~/ against the supplied homeDir', () => {
    // The flow repo's own path is guaranteed to exist; use it as a probe.
    const r = firstExistingPath(['~/nonexistent-flow-test-path', REPO_ROOT], '/tmp');
    assert.equal(r, REPO_ROOT);
  });
});

describe('bmad.buildCommand', () => {
  it('emits the npx command with --tools and modules joined by comma', () => {
    const cmd = bmad.buildCommand({ catalog, subset: 'planning-only' });
    assert.equal(cmd.cmd, 'npx');
    assert.ok(cmd.args.includes('bmad-method'));
    assert.ok(cmd.args.includes('install'));
    assert.ok(cmd.args.includes('--tools'));
    assert.ok(cmd.args.includes('claude-code'));
    assert.ok(cmd.args.includes('--yes'));
    assert.ok(cmd.args.includes('--modules'));
  });

  it('drops --modules entirely when subset has empty modules array (none case)', async () => {
    const result = await bmad.install({ catalog, subset: 'none' }, { dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.command.source, 'skipped:subset-none');
    assert.equal(result.stateRecord.skipped, true);
  });

  it('appends config kvs via --set key=value', () => {
    const cmd = bmad.buildCommand({ catalog, subset: 'planning-only', configKvs: { 'foo.bar': 'baz' } });
    const setIdx = cmd.args.indexOf('--set');
    assert.ok(setIdx >= 0, '--set should appear');
    assert.equal(cmd.args[setIdx + 1], 'foo.bar=baz');
  });

  it('throws on unknown subset', () => {
    assert.throws(() => bmad.buildCommand({ catalog, subset: 'not-a-subset' }), /unknown bmad subset/);
  });
});

describe('ecc.buildCommand', () => {
  it('routes --target claude when scope is user', () => {
    const cmd = ecc.buildCommand({
      catalog, subset: 'flow-essentials', profile: 'mini', scope: 'user',
    });
    const targetIdx = cmd.args.indexOf('--target');
    assert.ok(targetIdx >= 0, 'should pass --target');
    assert.equal(cmd.args[targetIdx + 1], 'claude');
  });

  it('routes --target claude-project when scope is project', () => {
    const cmd = ecc.buildCommand({
      catalog, subset: 'flow-essentials-plus-tdd', profile: 'team', scope: 'project',
    });
    const targetIdx = cmd.args.indexOf('--target');
    assert.equal(cmd.args[targetIdx + 1], 'claude-project');
  });

  it('uses cmd_fallback (github pin) when no installer_path candidate resolves', () => {
    // Pass a homeDir that won't have ~/dev-tools/... — the test repo's
    // ecc-fork candidate path will not exist either when run from CI.
    const cmd = ecc.buildCommand({
      catalog, subset: 'flow-essentials', profile: 'mini', scope: 'user',
      homeDir: '/nonexistent/home-for-test',
    });
    assert.match(cmd.source, /cmd_fallback/);
    // Pin must include the merge commit SHA the catalog declares.
    assert.ok(cmd.args.some(a => a.includes('github:affaan-m/ECC#')), `args=${cmd.args.join(' ')}`);
  });

  it('appends --with for each entry in withList', () => {
    const cmd = ecc.buildCommand({
      catalog, subset: 'flow-essentials', profile: 'mini', scope: 'user',
      withList: ['skill:plankton-code-quality', 'capability:security'],
    });
    const withCount = cmd.args.filter(a => a === '--with').length;
    assert.equal(withCount, 2);
  });

  it('throws when scope has no target_by_scope mapping', () => {
    assert.throws(() => ecc.buildCommand({
      catalog, subset: 'flow-essentials', profile: 'mini', scope: 'bogus',
    }), /target_by_scope/);
  });

  it('install with subset=none returns skipped result and records scope', async () => {
    const result = await ecc.install({
      catalog, subset: 'none', profile: 'minimal', scope: 'user',
    }, { dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.stateRecord.skipped, true);
    assert.equal(result.stateRecord.install_scope, 'user');
  });
});

describe('caveman.buildCommand', () => {
  it('emits the github-pinned npx command from the fork', () => {
    const cmd = caveman.buildCommand({ catalog, subset: 'full' });
    assert.equal(cmd.cmd, 'npx');
    assert.ok(cmd.args.some(a => a.startsWith('github:mhd-ghaith-abtah/caveman')), `args=${cmd.args.join(' ')}`);
    assert.equal(cmd.source, 'npx-from-fork');
  });

  it('install with subset=none returns skipped result', async () => {
    const result = await caveman.install({ catalog, subset: 'none' }, { dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.stateRecord.skipped, true);
  });

  it('honors FLOW_INSPECT_INSTALL_SCRIPTS=1 by returning inspect-only without running', async () => {
    const prev = process.env.FLOW_INSPECT_INSTALL_SCRIPTS;
    process.env.FLOW_INSPECT_INSTALL_SCRIPTS = '1';
    try {
      const result = await caveman.install({ catalog, subset: 'full' }, { dryRun: false });
      assert.equal(result.ok, true);
      assert.equal(result.stateRecord.inspect_only, true);
      assert.match(result.error, /FLOW_INSPECT_INSTALL_SCRIPTS=1/);
    } finally {
      if (prev === undefined) delete process.env.FLOW_INSPECT_INSTALL_SCRIPTS;
      else process.env.FLOW_INSPECT_INSTALL_SCRIPTS = prev;
    }
  });

  it('records fork_tag in the state record after a (dry-run) install', async () => {
    const result = await caveman.install({ catalog, subset: 'full' }, { dryRun: true });
    assert.equal(result.stateRecord.fork_tag, 'flow-pin-v0.1');
    assert.equal(result.stateRecord.upstream_pr, 407);
  });
});
