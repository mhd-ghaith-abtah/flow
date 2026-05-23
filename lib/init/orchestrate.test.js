// lib/init/orchestrate.test.js — integration test for the init chain.
//
// CRITICAL: every test runs with dryRun=true. The orchestrator chains
// real upstream installers (bmad → ecc → caveman → mcp) which shell out
// to `npx bmad-method`, `npx github:affaan-m/ECC`, etc. Running with
// dryRun=false in a unit-test context spawns 3+ minute network installs
// that hang the test harness. File-writing coverage lives in
// scaffold.test.js, which calls scaffold() directly with no upstream
// dispatch and is safe to run with dryRun=false.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../catalog.js';
import { runInit, defaultAnswersForProfile } from './orchestrate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const catalog = loadCatalog(REPO_ROOT);

/**
 * Test-only helper: pull defaults for a profile then force every upstream
 * subset to `none`. The `none` value makes each dispatcher (bmad, ecc,
 * caveman) take the short-circuit `skipped:subset-none` path WITHOUT
 * shelling out. minimal profile's caveman_subset defaults to `full`,
 * which under dryRun:true would still return ok=true but wouldn't show
 * as skipped — and a regression that flipped dryRun off would actually
 * run `npx -y github:.../caveman`. Forcing subsets to none gives the
 * chain test deterministic short-circuit behavior with zero network
 * exposure.
 */
function chainTestAnswers(catalog, profileName, overrides = {}) {
  return defaultAnswersForProfile(catalog, profileName, {
    bmadSubset: 'none',
    eccSubset: 'none',
    cavemanSubset: 'none',
    ...overrides,
  });
}

describe('runInit (dryRun)', () => {
  it('chains detect → questions → upstreams → scaffold for the minimal profile', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-init-orch-'));
    const homeDir = mkdtempSync(join(tmpdir(), 'flow-init-orch-home-'));
    try {
      const answers = chainTestAnswers(catalog, 'minimal');
      const result = await runInit({
        cwd, homeDir, catalog, flowVersion: '0.7.99-test',
        cliAnswers: answers, dryRun: true,
      });
      assert.equal(result.ok, true, result.haltReason);
      assert.ok(result.detection);
      assert.equal(result.detection.cwd, cwd);
      // All three upstream dispatchers got called and short-circuited via
      // the subset=none path (no shelling out, no network).
      assert.ok(result.upstreamResults.bmad);
      assert.ok(result.upstreamResults.ecc);
      assert.ok(result.upstreamResults.caveman);
      assert.equal(result.upstreamResults.bmad.stateRecord.skipped, true);
      assert.equal(result.upstreamResults.ecc.stateRecord.skipped, true);
      assert.equal(result.upstreamResults.caveman.stateRecord.skipped, true);
      // MCP list is empty for minimal profile.
      assert.deepEqual(result.mcpResults, []);
      // Scaffold reports files it WOULD write.
      assert.ok(result.scaffoldManifest.written.some(p => p.endsWith('flow.config.yaml')));
      assert.ok(result.scaffoldManifest.written.some(p => p.endsWith('sprint.yaml')));
      // dryRun → nothing actually written.
      assert.equal(existsSync(join(cwd, '.claude', 'flow.config.yaml')), false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('threads the resolved ecc_install_scope from team profile through to scaffold plan', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-init-orch-team-'));
    const homeDir = mkdtempSync(join(tmpdir(), 'flow-init-orch-team-home-'));
    try {
      const answers = chainTestAnswers(catalog, 'team');
      const result = await runInit({
        cwd, homeDir, catalog, flowVersion: '0.7.99-test',
        cliAnswers: answers, dryRun: true,
      });
      assert.equal(result.ok, true);
      assert.equal(result.answers.eccScope, 'project');
      // ECC dispatcher records install_scope even when skipped (subset=none
      // here because team's ecc_subset still has a value — confirm it's
      // wired through to the state record).
      assert.equal(result.upstreamResults.ecc.stateRecord.install_scope, 'project');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('honors --ecc-scope CLI override on top of profile default', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-init-orch-scope-'));
    const homeDir = mkdtempSync(join(tmpdir(), 'flow-init-orch-scope-home-'));
    try {
      // team default = project; override to user via cliAnswers.
      const answers = chainTestAnswers(catalog, 'team', { eccScope: 'user' });
      const result = await runInit({
        cwd, homeDir, catalog, flowVersion: '0.7.99-test',
        cliAnswers: answers, dryRun: true,
      });
      assert.equal(result.ok, true);
      assert.equal(result.answers.eccScope, 'user');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('triggers BMad migration when answers.migrateBmad=yes AND BMad is detected (still dryRun)', async () => {
    // Migration uses real fs writes (no network) so we can run with
    // dryRun=true on upstreams but let migration land. But scaffold +
    // upstreams stay dryRun=true. The orchestrator passes `dryRun` to
    // scaffold so migrated files DON'T persist in this test — we just
    // verify migrate-bmad got called by checking migrationResult is
    // present and ok.
    const cwd = mkdtempSync(join(tmpdir(), 'flow-init-orch-mig-'));
    const homeDir = mkdtempSync(join(tmpdir(), 'flow-init-orch-mig-home-'));
    try {
      // Seed a fake BMad install so detect() flags it.
      mkdirSync(join(cwd, '_bmad', '_config'), { recursive: true });
      writeFileSync(join(cwd, '_bmad', '_config', 'manifest.yaml'), 'version: 6.0.0\n');
      mkdirSync(join(cwd, 'docs', '_bmad-output', 'implementation-artifacts'), { recursive: true });
      writeFileSync(
        join(cwd, 'docs', '_bmad-output', 'implementation-artifacts', 'sprint-status.yaml'),
        'e1-s1-test:\n  title: Test story\n  status: backlog\n'
      );
      const answers = chainTestAnswers(catalog, 'mini', { migrateBmad: 'yes' });
      const result = await runInit({
        cwd, homeDir, catalog, flowVersion: '0.7.99-test',
        cliAnswers: answers, dryRun: true,
      });
      assert.equal(result.ok, true);
      // migrate-bmad doesn't currently respect a dryRun flag — it always
      // writes. So migrationResult should reflect a real successful
      // migration even though upstreams stayed dry.
      assert.ok(result.migrationResult);
      assert.equal(result.migrationResult.ok, true);
      assert.equal(result.migrationResult.storiesImported, 1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('defaultAnswersForProfile maps profile adapters into per-family answers', () => {
    const answers = defaultAnswersForProfile(catalog, 'mini');
    assert.equal(answers.profile, 'mini');
    assert.equal(answers.issueTracker, 'github-issues');
    assert.equal(answers.pr, 'github');
    assert.equal(answers.verify, 'make');
    assert.equal(answers.eccScope, 'user'); // mini inherits catalog default
  });

  it('defaultAnswersForProfile pulls team profile scope=project', () => {
    const answers = defaultAnswersForProfile(catalog, 'team');
    assert.equal(answers.eccScope, 'project');
  });
});
