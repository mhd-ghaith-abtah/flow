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
});
