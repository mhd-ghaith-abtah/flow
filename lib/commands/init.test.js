// lib/commands/init.test.js — coverage for `flow init` CLI dispatch.
//
// Only --repair has a focused unit test here — the headless --yes path
// is covered end-to-end via orchestrate.test.js + the CI smoke step.
// --repair is its own narrow surface that doesn't touch the orchestrator
// or upstream installers, so a direct unit test is the right shape.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import init from './init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

/**
 * Capture console output across the FULL lifecycle of an async fn.
 * install.test.js / doctor.test.js / plan.test.js use a try/finally
 * shape that restores console synchronously before the awaited promise
 * resolves — fine for commands that print all output before the first
 * await, but lossy for commands like `flow init --repair` that await
 * dynamic imports between prints. Putting the restore in the promise's
 * .finally keeps the overrides active until the command actually returns.
 */
function captureOutput(fn) {
  const originalLog = console.log;
  const originalErr = console.error;
  let stdout = '';
  let stderr = '';
  console.log = (...args) => { stdout += args.join(' ') + '\n'; };
  console.error = (...args) => { stderr += args.join(' ') + '\n'; };
  return fn()
    .then((rc) => ({ stdout, stderr, rc }))
    .finally(() => {
      console.log = originalLog;
      console.error = originalErr;
    });
}

function seedMinimalInstall(cwd) {
  // Synthetic install-state matching what scaffold() writes — repair reads
  // profile + answers from this file, so a hand-rolled one suffices for
  // the unit test (no need to actually run the full orchestrator first).
  mkdirSync(join(cwd, '.claude', 'flow'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'flow', 'install-state.json'), JSON.stringify({
    schema_version: 'flow.install.v1',
    flow_version: '0.7.99-test',
    profile: 'minimal',
    answers: {
      profile: 'minimal',
      issueTracker: 'none',
      pr: 'none',
      e2e: 'none',
      verify: 'custom',
      bmadSubset: 'none',
      eccSubset: 'none',
      eccScope: 'user',
      cavemanSubset: 'full',
      migrateBmad: 'skip',
      secretsStore: 'env-file',
    },
    upstreams: {},
    migration: null,
    ran_at: new Date().toISOString(),
  }, null, 2));
}

describe('flow init --repair', () => {
  it('refuses to repair when no install-state.json exists + exits 1', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-init-repair-empty-'));
    try {
      const { rc, stderr } = await captureOutput(() =>
        init({ repair: true }, { repoRoot: REPO_ROOT, cwd })
      );
      assert.equal(rc, 1);
      assert.match(stderr, /no \.claude\/flow\/install-state\.json found/);
      assert.match(stderr, /flow init --profile/);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('recreates a deleted sprint.yaml from the recorded profile', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-init-repair-restore-'));
    try {
      seedMinimalInstall(cwd);
      // Don't create docs/flow/sprint.yaml so the repair has something to do.
      const { rc, stdout } = await captureOutput(() =>
        init({ repair: true }, { repoRoot: REPO_ROOT, cwd })
      );
      assert.equal(rc, 0);
      assert.ok(existsSync(join(cwd, 'docs', 'flow', 'sprint.yaml')), 'sprint.yaml should be recreated');
      assert.ok(existsSync(join(cwd, 'docs', 'flow', 'deferred.md')), 'deferred.md should be recreated');
      assert.match(stdout, /flow init --repair complete/);
      // Sprint content reflects the recorded profile.
      const sprint = parseYaml(readFileSync(join(cwd, 'docs', 'flow', 'sprint.yaml'), 'utf8'));
      assert.equal(sprint.version, 1);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('--repair --dry-run reports what would be restored without writing', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-init-repair-dry-'));
    try {
      seedMinimalInstall(cwd);
      const { rc, stdout } = await captureOutput(() =>
        init({ repair: true, 'dry-run': true }, { repoRoot: REPO_ROOT, cwd })
      );
      assert.equal(rc, 0);
      assert.match(stdout, /--dry-run: nothing was actually written/);
      // Nothing in docs/flow/ should exist.
      assert.equal(existsSync(join(cwd, 'docs', 'flow', 'sprint.yaml')), false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('rejects a corrupt install-state.json with exit 2', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-init-repair-corrupt-'));
    try {
      mkdirSync(join(cwd, '.claude', 'flow'), { recursive: true });
      writeFileSync(join(cwd, '.claude', 'flow', 'install-state.json'), '{ not json');
      const { rc, stderr } = await captureOutput(() =>
        init({ repair: true }, { repoRoot: REPO_ROOT, cwd })
      );
      assert.equal(rc, 2);
      assert.match(stderr, /failed to parse install-state/);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});

describe('flow init --update', () => {
  it('refuses to update when no install-state.json exists + exits 1', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-init-update-empty-'));
    try {
      const { rc, stderr } = await captureOutput(() =>
        init({ update: true }, { repoRoot: REPO_ROOT, cwd })
      );
      assert.equal(rc, 1);
      assert.match(stderr, /no \.claude\/flow\/install-state\.json found/);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('reports no-op when nothing changed (same profile, no overrides)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-init-update-noop-'));
    try {
      seedMinimalInstall(cwd);
      const { rc, stdout } = await captureOutput(() =>
        init({ update: true, 'dry-run': true }, { repoRoot: REPO_ROOT, cwd })
      );
      assert.equal(rc, 0);
      assert.match(stdout, /No changes — install matches the requested state/);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('surfaces a delta for each changed answer when profile swaps', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-init-update-swap-'));
    try {
      seedMinimalInstall(cwd); // recorded profile=minimal
      const { rc, stdout } = await captureOutput(() =>
        init({ update: true, profile: 'mini', 'dry-run': true }, { repoRoot: REPO_ROOT, cwd })
      );
      assert.equal(rc, 0);
      assert.match(stdout, /Δ profile: minimal → mini/);
      // Adapter defaults from mini should also show as deltas.
      assert.match(stdout, /Δ issueTracker: none → github-issues/);
      assert.match(stdout, /Δ pr: none → github/);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('refuses install_scope swap mid-flight with a clear uninstall-then-reinstall hint', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-init-update-scopeswap-'));
    try {
      seedMinimalInstall(cwd); // eccScope=user
      const { rc, stderr } = await captureOutput(() =>
        init({ update: true, 'ecc-scope': 'project' }, { repoRoot: REPO_ROOT, cwd })
      );
      assert.equal(rc, 1);
      assert.match(stderr, /install_scope change \(user → project\)/);
      assert.match(stderr, /uninstall \+ reinstall/);
      assert.match(stderr, /flow uninstall --execute --yes/);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('--ecc-scope override is honored when scope is unchanged (same value passed)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-init-update-samescope-'));
    try {
      seedMinimalInstall(cwd);
      const { rc, stdout } = await captureOutput(() =>
        init({ update: true, 'ecc-scope': 'user', 'dry-run': true }, { repoRoot: REPO_ROOT, cwd })
      );
      assert.equal(rc, 0);
      // Same value → not a delta, but also not a halt.
      assert.doesNotMatch(stdout, /Δ eccScope/);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});
