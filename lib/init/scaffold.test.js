// lib/init/scaffold.test.js — coverage for the file-writing scaffolder.
//
// scaffold() doesn't shell out, so these tests can safely run with
// dryRun=false and assert on actual file content. The orchestrator
// chain coverage lives in orchestrate.test.js and stays dryRun=true to
// avoid network installers.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { loadCatalog, resolveProfile } from '../catalog.js';
import { scaffold, buildFlowConfig } from './scaffold.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const catalog = loadCatalog(REPO_ROOT);

function makePlan(cwd, profileName, overrides = {}) {
  const profile = resolveProfile(catalog, profileName);
  return {
    cwd,
    profile: profileName,
    answers: {
      profile: profileName,
      issueTracker: 'github-issues',
      pr: 'github',
      e2e: 'none',
      verify: 'make',
      bmadSubset: profile.bmad_subset,
      eccSubset: profile.ecc_subset,
      eccScope: profile.ecc_install_scope,
      cavemanSubset: profile.caveman_subset,
      migrateBmad: 'skip',
      secretsStore: 'env-file',
    },
    resolvedProfile: profile,
    catalog,
    flowVersion: '0.7.99-test',
    upstreamResults: {},
    migrationResult: null,
    ...overrides,
  };
}

describe('buildFlowConfig', () => {
  it('produces a config matching the chosen profile mode + adapters', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-scaffold-cfg-'));
    try {
      const plan = makePlan(cwd, 'mini');
      const cfg = buildFlowConfig(plan);
      assert.equal(cfg.mode, 'mini');
      assert.equal(cfg.adapters.issue_tracker, 'github-issues');
      assert.equal(cfg.adapters.pr, 'github');
      assert.equal(cfg.adapters.verify, 'make');
      assert.equal(cfg.review.use_separate_model, false); // mini ≠ team
      assert.equal(cfg.upstreams.ecc.install_scope, 'user');
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('team profile turns on use_separate_model + use_tdd + docs_auto_trigger', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-scaffold-team-'));
    try {
      const plan = makePlan(cwd, 'team');
      const cfg = buildFlowConfig(plan);
      assert.equal(cfg.review.use_separate_model, true);
      assert.equal(cfg.implement.use_tdd, true);
      assert.equal(cfg.implement.docs_auto_trigger, true);
      assert.equal(cfg.upstreams.ecc.install_scope, 'project');
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('records install_scope from answers (after --ecc-scope override)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-scaffold-scope-'));
    try {
      const plan = makePlan(cwd, 'team');
      plan.answers.eccScope = 'user'; // simulating --ecc-scope user override
      const cfg = buildFlowConfig(plan);
      assert.equal(cfg.upstreams.ecc.install_scope, 'user');
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});

describe('scaffold (writes)', () => {
  it('creates docs/flow/* dirs + writes flow.config.yaml + sprint.yaml + install-state.json', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-scaffold-write-'));
    try {
      const plan = makePlan(cwd, 'minimal');
      const manifest = scaffold(plan);
      // Directories.
      for (const d of ['docs/flow', 'docs/flow/stories', 'docs/flow/journeys', 'docs/flow/retros', 'docs/flow/archive']) {
        assert.ok(existsSync(join(cwd, d)), `expected dir ${d}`);
      }
      // Files.
      const configPath = join(cwd, '.claude', 'flow.config.yaml');
      assert.ok(existsSync(configPath));
      assert.ok(existsSync(join(cwd, 'docs', 'flow', 'sprint.yaml')));
      assert.ok(existsSync(join(cwd, 'docs', 'flow', 'deferred.md')));
      assert.ok(existsSync(join(cwd, '.claude', 'flow', 'install-state.json')));
      // Manifest mentions what got written.
      assert.ok(manifest.written.some(p => p.endsWith('flow.config.yaml')));
      // Sprint yaml content shape.
      const sprint = parseYaml(readFileSync(join(cwd, 'docs', 'flow', 'sprint.yaml'), 'utf8'));
      assert.equal(sprint.version, 1);
      assert.deepEqual(sprint.epics, []);
      assert.deepEqual(sprint.stories, []);
      // Install-state shape.
      const state = JSON.parse(readFileSync(join(cwd, '.claude', 'flow', 'install-state.json'), 'utf8'));
      assert.equal(state.profile, 'minimal');
      assert.equal(state.schema_version, 'flow.install.v1');
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('dryRun=true reports what would be written without touching disk', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-scaffold-dry-'));
    try {
      const plan = makePlan(cwd, 'minimal');
      const manifest = scaffold(plan, { dryRun: true });
      assert.ok(manifest.written.length > 0, 'manifest should still describe the plan');
      // Nothing actually exists.
      assert.equal(existsSync(join(cwd, '.claude', 'flow.config.yaml')), false);
      assert.equal(existsSync(join(cwd, 'docs', 'flow', 'sprint.yaml')), false);
      assert.equal(existsSync(join(cwd, '.claude', 'flow', 'install-state.json')), false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('skips pre-existing flow.config.yaml without --force', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-scaffold-skip-'));
    try {
      // Seed an existing config with hand-edits the user shouldn't lose.
      mkdirSync(join(cwd, '.claude'), { recursive: true });
      const configPath = join(cwd, '.claude', 'flow.config.yaml');
      writeFileSync(configPath, '# user hand-edits\nversion: 1\nmode: mini\ncustom_key: keep-me\n');

      const plan = makePlan(cwd, 'minimal');
      const manifest = scaffold(plan);
      assert.ok(manifest.skipped.some(p => p === configPath), 'config should be in skipped list');
      // File content preserved.
      const content = readFileSync(configPath, 'utf8');
      assert.match(content, /custom_key: keep-me/);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('--force overwrites pre-existing flow.config.yaml', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-scaffold-force-'));
    try {
      mkdirSync(join(cwd, '.claude'), { recursive: true });
      const configPath = join(cwd, '.claude', 'flow.config.yaml');
      writeFileSync(configPath, '# old content\n');
      const plan = makePlan(cwd, 'minimal');
      const manifest = scaffold(plan, { force: true });
      assert.ok(manifest.written.some(p => p === configPath));
      const content = readFileSync(configPath, 'utf8');
      assert.doesNotMatch(content, /^# old content$/m);
      assert.match(content, /generated by `flow init`/);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});
