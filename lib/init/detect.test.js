// lib/init/detect.test.js — coverage for project-shape detection.
//
// Detection runs against tmp directories so the tests are hermetic and
// don't depend on the developer's actual home dir / git config. Each
// test sets up the smallest filesystem shape that exercises the probe
// under test, then tears it down via after(). Probes that shell out to
// `git` and `claude` are not stubbed — they're allowed to return null
// when the CLI is missing, which is the same fallback behavior we want
// in production.

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detect } from './detect.js';

describe('detect()', () => {
  let tmpDir;
  let tmpHome;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'flow-detect-'));
    tmpHome = mkdtempSync(join(tmpdir(), 'flow-detect-home-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns nulls / false / [] for a bare empty directory', () => {
    const d = detect({ cwd: tmpDir, homeDir: tmpHome });
    assert.equal(d.cwd, tmpDir);
    assert.equal(d.pkgManager, null);
    assert.equal(d.primaryStack, null);
    assert.equal(d.framework, null);
    assert.equal(d.hasClaudeMd, false);
    assert.equal(d.flowAlreadyConfigured, false);
    assert.equal(d.bmad.installed, false);
    assert.equal(d.ecc.installed, false);
    assert.equal(d.caveman.installed, false);
  });

  it('detects pnpm + javascript from a pnpm-lock.yaml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flow-detect-pnpm-'));
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
    try {
      const d = detect({ cwd: dir, homeDir: tmpHome });
      assert.equal(d.pkgManager, 'pnpm');
      assert.equal(d.primaryStack, 'javascript');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to npm when package.json exists without a lockfile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flow-detect-bare-pkg-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
    try {
      const d = detect({ cwd: dir, homeDir: tmpHome });
      assert.equal(d.pkgManager, 'npm');
      assert.equal(d.primaryStack, 'javascript');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects next.js framework from package.json deps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flow-detect-next-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'next-app', dependencies: { next: '^14.0.0', react: '^18.0.0' },
    }));
    try {
      const d = detect({ cwd: dir, homeDir: tmpHome });
      assert.equal(d.framework, 'next');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects CLAUDE.md presence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flow-detect-claudemd-'));
    writeFileSync(join(dir, 'CLAUDE.md'), '# project notes');
    try {
      const d = detect({ cwd: dir, homeDir: tmpHome });
      assert.equal(d.hasClaudeMd, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flags flowAlreadyConfigured when .claude/flow.config.yaml exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flow-detect-flowconfig-'));
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'flow.config.yaml'), 'version: 1\n');
    try {
      const d = detect({ cwd: dir, homeDir: tmpHome });
      assert.equal(d.flowAlreadyConfigured, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects BMad when _bmad/_config/manifest.yaml is present + reads version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flow-detect-bmad-'));
    mkdirSync(join(dir, '_bmad', '_config'), { recursive: true });
    writeFileSync(join(dir, '_bmad', '_config', 'manifest.yaml'), 'version: 6.1.2\n');
    try {
      const d = detect({ cwd: dir, homeDir: tmpHome });
      assert.equal(d.bmad.installed, true);
      assert.equal(d.bmad.version, '6.1.2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects ECC user-scope install when ~/.claude/rules/ecc exists', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'flow-detect-ecc-home-'));
    mkdirSync(join(homeDir, '.claude', 'rules', 'ecc'), { recursive: true });
    try {
      const d = detect({ cwd: tmpDir, homeDir });
      assert.equal(d.ecc.installed, true);
      assert.equal(d.ecc.scope, 'user');
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('detects ECC project-scope install when <cwd>/.claude/rules/ecc exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flow-detect-ecc-project-'));
    const homeDir = mkdtempSync(join(tmpdir(), 'flow-detect-ecc-h2-'));
    mkdirSync(join(dir, '.claude', 'rules', 'ecc'), { recursive: true });
    try {
      const d = detect({ cwd: dir, homeDir });
      assert.equal(d.ecc.installed, true);
      assert.equal(d.ecc.scope, 'project');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('flags ecc.scope=both when both user and project have content (collision)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flow-detect-ecc-both-'));
    const homeDir = mkdtempSync(join(tmpdir(), 'flow-detect-ecc-bothH-'));
    mkdirSync(join(dir, '.claude', 'rules', 'ecc'), { recursive: true });
    mkdirSync(join(homeDir, '.claude', 'rules', 'ecc'), { recursive: true });
    try {
      const d = detect({ cwd: dir, homeDir });
      assert.equal(d.ecc.scope, 'both');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('detects Caveman from plugin-marketplace cache path', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'flow-detect-cave-'));
    mkdirSync(join(homeDir, '.claude', 'plugins', 'cache', 'caveman'), { recursive: true });
    try {
      const d = detect({ cwd: tmpDir, homeDir });
      assert.equal(d.caveman.installed, true);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('detects Caveman from legacy hook path when plugin cache absent', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'flow-detect-cave-hook-'));
    mkdirSync(join(homeDir, '.claude', 'hooks'), { recursive: true });
    writeFileSync(join(homeDir, '.claude', 'hooks', 'caveman-config.js'), '// stub');
    try {
      const d = detect({ cwd: tmpDir, homeDir });
      assert.equal(d.caveman.installed, true);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
