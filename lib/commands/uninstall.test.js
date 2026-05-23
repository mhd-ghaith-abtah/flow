// lib/commands/uninstall.test.js — coverage for `flow uninstall` plan building.

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import uninstall from './uninstall.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

function captureOutput(fn) {
  const originalLog = console.log;
  const originalErr = console.error;
  let stdout = '';
  let stderr = '';
  console.log = (...args) => { stdout += args.join(' ') + '\n'; };
  console.error = (...args) => { stderr += args.join(' ') + '\n'; };
  try {
    return fn().then((rc) => ({ stdout, stderr, rc }));
  } finally {
    console.log = originalLog;
    console.error = originalErr;
  }
}

describe('flow uninstall', () => {
  let tmpDir;
  let tmpHome;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'flow-uninstall-test-'));
    tmpHome = mkdtempSync(join(tmpdir(), 'flow-uninstall-home-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
  });

  const ctx = () => ({ repoRoot: REPO_ROOT, cwd: tmpDir, home: tmpHome });

  it('dry-run is the default (no --execute)', async () => {
    const { rc, stdout } = await captureOutput(() => uninstall({ scope: 'project' }, ctx()));
    assert.equal(rc, 0);
    assert.match(stdout, /Dry run/);
    assert.match(stdout, /Would remove/);
  });

  it('rejects unknown scope', async () => {
    const { rc, stderr } = await captureOutput(() => uninstall({ scope: 'bogus' }, ctx()));
    assert.equal(rc, 1);
    assert.match(stderr, /Unknown scope/);
  });

  it('plan keeps docs/flow by default (--remove-stories not set)', async () => {
    const { rc, stdout } = await captureOutput(() => uninstall({ scope: 'project' }, ctx()));
    assert.equal(rc, 0);
    assert.match(stdout, /docs\/flow.*— user content/);
  });

  it('plan removes docs/flow when --remove-stories is set', async () => {
    const { rc, stdout } = await captureOutput(() =>
      uninstall({ scope: 'project', 'remove-stories': true }, ctx())
    );
    assert.equal(rc, 0);
    // docs/flow should now appear in Would remove, not Keeping
    const removeBlock = stdout.split('Keeping:')[0];
    assert.match(removeBlock, /docs\/flow/);
  });

  it('--execute without --yes refuses to actually remove', async () => {
    // Create files so the test can verify they survive a no-yes execute
    mkdirSync(join(tmpDir, '.claude', 'flow'), { recursive: true });
    writeFileSync(join(tmpDir, 'flow.config.yaml'), 'version: 1\n');
    const before = existsSync(join(tmpDir, 'flow.config.yaml'));
    assert.ok(before);

    const { rc, stdout } = await captureOutput(() =>
      uninstall({ scope: 'project', execute: true }, ctx())
    );
    assert.equal(rc, 0);
    assert.match(stdout, /Re-run with --execute --yes/);

    // File must survive — --execute without --yes is a confirmation prompt, not a delete.
    assert.ok(existsSync(join(tmpDir, 'flow.config.yaml')), 'file must survive without --yes');
  });

  it('--execute --yes actually removes project-scope files', async () => {
    mkdirSync(join(tmpDir, '.claude', 'flow'), { recursive: true });
    writeFileSync(join(tmpDir, 'flow.config.yaml'), 'version: 1\n');
    writeFileSync(join(tmpDir, '.claude', 'flow', 'install-state.json'), '{}');
    assert.ok(existsSync(join(tmpDir, 'flow.config.yaml')));
    assert.ok(existsSync(join(tmpDir, '.claude', 'flow')));

    const { rc, stdout } = await captureOutput(() =>
      uninstall({ scope: 'project', execute: true, yes: true }, ctx())
    );
    assert.equal(rc, 0);
    assert.match(stdout, /Done:/);
    assert.ok(!existsSync(join(tmpDir, 'flow.config.yaml')), 'flow.config.yaml should be removed');
    assert.ok(!existsSync(join(tmpDir, '.claude', 'flow')), '.claude/flow should be removed');
  });

  // E7 follow-up: project-scope ECC removal.

  it('lists project-scope ECC paths under Keeping by default when state says install_scope=project', async () => {
    mkdirSync(join(tmpDir, '.claude', 'rules', 'ecc'), { recursive: true });
    mkdirSync(join(tmpDir, '.claude', 'skills', 'ecc'), { recursive: true });
    mkdirSync(join(tmpDir, '.claude', 'flow'), { recursive: true });
    writeFileSync(join(tmpDir, '.claude', 'flow', 'install-state.json'),
      JSON.stringify({ upstreams: { ecc: { install_scope: 'project' } } }));
    const { rc, stdout } = await captureOutput(() => uninstall({ scope: 'project' }, ctx()));
    assert.equal(rc, 0);
    assert.match(stdout, /\.claude\/rules\/ecc.*--remove-project-ecc/s);
    assert.match(stdout, /\.claude\/skills\/ecc/);
  });

  it('--remove-project-ecc moves project-scope ECC paths to Would remove', async () => {
    mkdirSync(join(tmpDir, '.claude', 'rules', 'ecc'), { recursive: true });
    mkdirSync(join(tmpDir, '.claude', 'skills', 'ecc'), { recursive: true });
    mkdirSync(join(tmpDir, '.claude', 'flow'), { recursive: true });
    writeFileSync(join(tmpDir, '.claude', 'flow', 'install-state.json'),
      JSON.stringify({ upstreams: { ecc: { install_scope: 'project' } } }));
    const { rc, stdout } = await captureOutput(() =>
      uninstall({ scope: 'project', 'remove-project-ecc': true }, ctx())
    );
    assert.equal(rc, 0);
    // Both ECC paths now appear in the Would-remove block.
    assert.match(stdout, /Would remove:[\s\S]*\.claude\/rules\/ecc/);
    assert.match(stdout, /Would remove:[\s\S]*\.claude\/skills\/ecc/);
  });

  it('--execute --yes --remove-project-ecc actually removes the ECC project-scope dirs', async () => {
    mkdirSync(join(tmpDir, '.claude', 'rules', 'ecc'), { recursive: true });
    mkdirSync(join(tmpDir, '.claude', 'skills', 'ecc'), { recursive: true });
    writeFileSync(join(tmpDir, '.claude', 'rules', 'ecc', 'sentinel.md'), 'x');
    mkdirSync(join(tmpDir, '.claude', 'flow'), { recursive: true });
    writeFileSync(join(tmpDir, '.claude', 'flow', 'install-state.json'),
      JSON.stringify({ upstreams: { ecc: { install_scope: 'project' } } }));

    const { rc } = await captureOutput(() =>
      uninstall({ scope: 'project', execute: true, yes: true, 'remove-project-ecc': true }, ctx())
    );
    assert.equal(rc, 0);
    assert.ok(!existsSync(join(tmpDir, '.claude', 'rules', 'ecc')), 'rules/ecc must be gone');
    assert.ok(!existsSync(join(tmpDir, '.claude', 'skills', 'ecc')), 'skills/ecc must be gone');
  });

  it('falls back to fs detection when install-state.json is absent', async () => {
    mkdirSync(join(tmpDir, '.claude', 'rules', 'ecc'), { recursive: true });
    // No install-state.json — but ECC content exists at project scope.
    const { rc, stdout } = await captureOutput(() => uninstall({ scope: 'project' }, ctx()));
    assert.equal(rc, 0);
    assert.match(stdout, /\.claude\/rules\/ecc.*--remove-project-ecc/s);
  });

  it('does NOT list project-scope ECC when state says install_scope=user (collision avoidance)', async () => {
    mkdirSync(join(tmpDir, '.claude', 'rules', 'ecc'), { recursive: true });
    mkdirSync(join(tmpDir, '.claude', 'flow'), { recursive: true });
    // State says user-scope is the active install — the project-scope
    // content is stale/collision content (flow doctor surfaces that).
    // Uninstall should NOT try to clean it up via the project-ecc path.
    writeFileSync(join(tmpDir, '.claude', 'flow', 'install-state.json'),
      JSON.stringify({ upstreams: { ecc: { install_scope: 'user' } } }));
    const { rc, stdout } = await captureOutput(() => uninstall({ scope: 'project' }, ctx()));
    assert.equal(rc, 0);
    assert.doesNotMatch(stdout, /--remove-project-ecc/);
  });
});
