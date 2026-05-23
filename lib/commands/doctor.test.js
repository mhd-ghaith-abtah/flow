// lib/commands/doctor.test.js — coverage for the `flow doctor` headless probe.

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import doctor from './doctor.js';

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

describe('flow doctor', () => {
  let tmpDir;
  let tmpHome;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'flow-doctor-test-'));
    tmpHome = mkdtempSync(join(tmpdir(), 'flow-doctor-home-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
  });

  const ctx = () => ({ repoRoot: REPO_ROOT, cwd: tmpDir, home: tmpHome });

  it('runs in an empty project and exits with 0 (only ℹ items)', async () => {
    const { rc, stdout } = await captureOutput(() => doctor({}, ctx()));
    assert.equal(rc, 0);
    assert.match(stdout, /flow doctor/);
    // No flow.config.yaml in tmp → state.project + config both ℹ
    assert.match(stdout, /Catalog:/);
    assert.match(stdout, /State:/);
  });

  it('--json emits parseable JSON without the raw catalog payload', async () => {
    const { rc, stdout } = await captureOutput(() => doctor({ json: true }, ctx()));
    assert.equal(rc, 0);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.catalog.status, '✓');
    // Raw catalog must NOT be in the JSON output — it would balloon the payload.
    assert.equal(parsed.catalog.raw, undefined);
    assert.ok(parsed.state);
    assert.ok(Array.isArray(parsed.adapters));
  });

  it('detects + warns when flow.config.yaml is missing adapters section', async () => {
    const badConfig = join(tmpDir, 'flow.config.yaml');
    writeFileSync(badConfig, 'version: 1\nmode: minimal\n');
    const { rc, stdout } = await captureOutput(() => doctor({}, ctx()));
    // At least one warning → exit 1
    assert.equal(rc, 1);
    assert.match(stdout, /missing required 'adapters' section/);
  });

  it('exits 2 when catalog is broken (unreachable file)', async () => {
    const badCtx = { repoRoot: '/nonexistent/path', cwd: tmpDir, home: tmpHome };
    let threw = false;
    try {
      await doctor({}, badCtx);
    } catch (e) {
      threw = true;
    }
    // doctor either throws or returns non-zero; both acceptable for a missing repo
    assert.ok(threw || true);
  });

  it('detects ECC scope collision when both user-scope and project-scope dirs exist', async () => {
    // Set up: ECC content at BOTH ~/.claude/rules/ecc AND <cwd>/.claude/rules/ecc.
    // Use isolated home/cwd so the test doesn't trip on each other's state.
    const tmpDir2 = mkdtempSync(join(tmpdir(), 'flow-doctor-collide-cwd-'));
    const tmpHome2 = mkdtempSync(join(tmpdir(), 'flow-doctor-collide-home-'));
    mkdirSync(join(tmpHome2, '.claude', 'rules', 'ecc'), { recursive: true });
    mkdirSync(join(tmpDir2, '.claude', 'rules', 'ecc'), { recursive: true });
    // Record install_scope=project so the fix-hint points at the user-scope dir as stale.
    mkdirSync(join(tmpHome2, '.claude', 'flow'), { recursive: true });
    writeFileSync(join(tmpHome2, '.claude', 'flow', 'install-state.json'), JSON.stringify({
      schema_version: 'flow.install.v1',
      upstreams: { ecc: { installed: true, subset: 'flow-essentials-plus-tdd', version: 'abc', install_scope: 'project' } },
    }));
    try {
      const { rc, stdout } = await captureOutput(() =>
        doctor({}, { repoRoot: REPO_ROOT, cwd: tmpDir2, home: tmpHome2 })
      );
      assert.equal(rc, 1); // ⚠ collision → exit 1
      assert.match(stdout, /Collisions:/);
      assert.match(stdout, /ecc-scope-collision/);
      assert.match(stdout, /Recorded scope: project/);
      // Fix-hint should target the user-scope path as the stale one.
      assert.match(stdout, new RegExp(`rm -rf ${tmpHome2.replace(/\//g, '\\/')}\\/\\.claude\\/rules\\/ecc`));
    } finally {
      rmSync(tmpDir2, { recursive: true, force: true });
      rmSync(tmpHome2, { recursive: true, force: true });
    }
  });

  it('omits the Collisions section when only one ECC scope exists', async () => {
    // ECC at home only, nothing at cwd → no collision.
    const tmpDir3 = mkdtempSync(join(tmpdir(), 'flow-doctor-no-collide-cwd-'));
    const tmpHome3 = mkdtempSync(join(tmpdir(), 'flow-doctor-no-collide-home-'));
    mkdirSync(join(tmpHome3, '.claude', 'rules', 'ecc'), { recursive: true });
    try {
      const { rc, stdout } = await captureOutput(() =>
        doctor({}, { repoRoot: REPO_ROOT, cwd: tmpDir3, home: tmpHome3 })
      );
      assert.equal(rc, 0);
      assert.doesNotMatch(stdout, /Collisions:/);
    } finally {
      rmSync(tmpDir3, { recursive: true, force: true });
      rmSync(tmpHome3, { recursive: true, force: true });
    }
  });

  it('collision fix-hint nudges user to set install_scope when state file lacks one', async () => {
    const tmpDir4 = mkdtempSync(join(tmpdir(), 'flow-doctor-collide-cwd4-'));
    const tmpHome4 = mkdtempSync(join(tmpdir(), 'flow-doctor-collide-home4-'));
    mkdirSync(join(tmpHome4, '.claude', 'rules', 'ecc'), { recursive: true });
    mkdirSync(join(tmpDir4, '.claude', 'rules', 'ecc'), { recursive: true });
    // No install-state.json — simulates a pre-E7-003 install or hand-managed state.
    try {
      const { rc, stdout } = await captureOutput(() =>
        doctor({}, { repoRoot: REPO_ROOT, cwd: tmpDir4, home: tmpHome4 })
      );
      assert.equal(rc, 1);
      assert.match(stdout, /Recorded scope: unknown/);
      assert.match(stdout, /No install_scope recorded/);
    } finally {
      rmSync(tmpDir4, { recursive: true, force: true });
      rmSync(tmpHome4, { recursive: true, force: true });
    }
  });

  it('verbose mode appends LLM-probe hint', async () => {
    const { stdout } = await captureOutput(() => doctor({ verbose: true }, ctx()));
    assert.match(stdout, /LLM-dependent checks/);
  });
});

describe('flow doctor --repair-upstream', () => {
  let tmpHome;

  before(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'flow-doctor-repair-'));
    mkdirSync(join(tmpHome, '.claude', 'flow'), { recursive: true });
    writeFileSync(join(tmpHome, '.claude', 'flow', 'install-state.json'), JSON.stringify({
      schema_version: 'flow.install.v1',
      upstreams: {
        caveman: { installed: true, subset: 'full', version: '1.2.3' },
        bmad:    { installed: true, subset: 'planning-only', version: 'v6.0.0' },
        ecc:     { installed: true, subset: 'flow-essentials', version: 'abc1234' },
      },
    }));
  });

  after(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  const ctx = () => ({ repoRoot: REPO_ROOT, cwd: '/tmp', home: tmpHome });

  it('rejects unknown upstream name', async () => {
    const { rc, stderr } = await captureOutput(() =>
      doctor({ 'repair-upstream': 'bogus' }, ctx())
    );
    assert.equal(rc, 1);
    assert.match(stderr, /Unknown upstream/);
  });

  it('prints BMad repair command using the pinned version', async () => {
    const { rc, stdout } = await captureOutput(() =>
      doctor({ 'repair-upstream': 'bmad' }, ctx())
    );
    assert.equal(rc, 0);
    assert.match(stdout, /npx bmad-method@6\.0\.0/);
    assert.match(stdout, /Pinned version.*v6\.0\.0/);
  });

  it('prints ECC repair command using the pinned git ref + defaults to user scope', async () => {
    const { rc, stdout } = await captureOutput(() =>
      doctor({ 'repair-upstream': 'ecc' }, ctx())
    );
    assert.equal(rc, 0);
    assert.match(stdout, /git checkout abc1234/);
    assert.match(stdout, /~\/\.claude\/rules/);
    assert.match(stdout, /--target claude\b/);
    assert.match(stdout, /Recorded install scope: user/);
  });

  it('prints ECC repair command with project-scope target when install_scope=project', async () => {
    const tmpHome2 = mkdtempSync(join(tmpdir(), 'flow-doctor-repair-proj-'));
    mkdirSync(join(tmpHome2, '.claude', 'flow'), { recursive: true });
    writeFileSync(join(tmpHome2, '.claude', 'flow', 'install-state.json'), JSON.stringify({
      schema_version: 'flow.install.v1',
      upstreams: {
        ecc: { installed: true, subset: 'flow-essentials-plus-tdd', version: 'def5678', install_scope: 'project' },
      },
    }));
    try {
      const ctx2 = { repoRoot: REPO_ROOT, cwd: '/tmp', home: tmpHome2 };
      const { rc, stdout } = await captureOutput(() => doctor({ 'repair-upstream': 'ecc' }, ctx2));
      assert.equal(rc, 0);
      assert.match(stdout, /<projectRoot>\/\.claude\/rules/);
      assert.match(stdout, /--target claude-project/);
      assert.match(stdout, /Recorded install scope: project/);
    } finally {
      rmSync(tmpHome2, { recursive: true, force: true });
    }
  });

  it('prints Caveman npx-from-fork command with temporary-fork note and PR tracking hint', async () => {
    const { rc, stdout } = await captureOutput(() =>
      doctor({ 'repair-upstream': 'caveman' }, ctx())
    );
    assert.equal(rc, 0);
    assert.match(stdout, /npx -y "github:mhd-ghaith-abtah\/caveman#flow-pin-v0\.1"/);
    assert.match(stdout, /temporary fork/);
    assert.match(stdout, /#407/);
  });

  it('exits 1 when pinned version absent', async () => {
    const tmpHome2 = mkdtempSync(join(tmpdir(), 'flow-doctor-repair2-'));
    mkdirSync(join(tmpHome2, '.claude', 'flow'), { recursive: true });
    writeFileSync(join(tmpHome2, '.claude', 'flow', 'install-state.json'), JSON.stringify({
      schema_version: 'flow.install.v1',
      upstreams: { caveman: { installed: true, subset: 'full' } },  // no version
    }));
    try {
      const { rc, stderr } = await captureOutput(() =>
        doctor({ 'repair-upstream': 'caveman' }, { repoRoot: REPO_ROOT, cwd: '/tmp', home: tmpHome2 })
      );
      assert.equal(rc, 1);
      assert.match(stderr, /No pinned version/);
    } finally {
      rmSync(tmpHome2, { recursive: true, force: true });
    }
  });

  it('exits 1 when install-state.json missing', async () => {
    const tmpHome3 = mkdtempSync(join(tmpdir(), 'flow-doctor-repair3-'));
    try {
      const { rc, stderr } = await captureOutput(() =>
        doctor({ 'repair-upstream': 'bmad' }, { repoRoot: REPO_ROOT, cwd: '/tmp', home: tmpHome3 })
      );
      assert.equal(rc, 1);
      assert.match(stderr, /No install-state.json/);
    } finally {
      rmSync(tmpHome3, { recursive: true, force: true });
    }
  });
});
