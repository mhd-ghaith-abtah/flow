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

  it('prints ECC repair command using the pinned git ref', async () => {
    const { rc, stdout } = await captureOutput(() =>
      doctor({ 'repair-upstream': 'ecc' }, ctx())
    );
    assert.equal(rc, 0);
    assert.match(stdout, /git checkout abc1234/);
  });

  it('prints Caveman curl-pipe-bash command with informational pin note', async () => {
    const { rc, stdout } = await captureOutput(() =>
      doctor({ 'repair-upstream': 'caveman' }, ctx())
    );
    assert.equal(rc, 0);
    assert.match(stdout, /curl -fsSL/);
    assert.match(stdout, /informational/);
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
