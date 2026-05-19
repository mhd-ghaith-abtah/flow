// lib/commands/install.test.js — coverage for `flow install`.

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import install from './install.js';

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

describe('flow install', () => {
  let tmpDir;
  let tmpHome;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'flow-install-test-'));
    tmpHome = mkdtempSync(join(tmpdir(), 'flow-install-home-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
  });

  const ctx = () => ({ repoRoot: REPO_ROOT, cwd: tmpDir, home: tmpHome });

  it('rejects unknown profile', async () => {
    const { rc, stderr } = await captureOutput(() => install({ profile: 'bogus' }, ctx()));
    assert.equal(rc, 1);
    assert.match(stderr, /Unknown profile/);
  });

  it('--dry-run prints plan without touching disk', async () => {
    const { rc, stdout } = await captureOutput(() =>
      install({ profile: 'minimal', 'dry-run': true }, ctx())
    );
    assert.equal(rc, 0);
    assert.match(stdout, /flow install/);
    assert.match(stdout, /Operations:/);
    assert.match(stdout, /--dry-run: stopping/);
    // Home install-state should NOT have been written.
    assert.ok(!existsSync(join(tmpHome, '.claude', 'flow', 'install-state.json')));
  });

  it('without --yes prints confirm prompt and stops', async () => {
    const { rc, stdout } = await captureOutput(() =>
      install({ profile: 'minimal' }, ctx())
    );
    assert.equal(rc, 0);
    assert.match(stdout, /Re-run with --yes/);
    assert.ok(!existsSync(join(tmpHome, '.claude', 'flow', 'install-state.json')));
  });

  it('--yes executes operations and writes install-state.json', async () => {
    const { rc, stdout } = await captureOutput(() =>
      install({ profile: 'minimal', yes: true }, ctx())
    );
    assert.equal(rc, 0);
    assert.match(stdout, /Done:/);
    assert.ok(existsSync(join(tmpHome, '.claude', 'flow', 'install-state.json')));
    // Skills should be copied to the home scope.
    assert.ok(existsSync(join(tmpHome, '.claude', 'skills', 'flow-init', 'SKILL.md')));
  });

  it('--verbose prints individual operations', async () => {
    const { stdout } = await captureOutput(() =>
      install({ profile: 'minimal', 'dry-run': true, verbose: true }, ctx())
    );
    assert.match(stdout, /\+ copy/);
  });
});
