// lib/commands/install-skills.test.js — coverage for the slash-command
// bootstrap. All tests run against tmp directories so they don't touch
// the developer's real ~/.claude/skills/.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import installSkills from './install-skills.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SOURCE_SKILLS = join(REPO_ROOT, 'skills');

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

describe('flow install-skills', () => {
  it('rejects unknown scope with exit 1', async () => {
    const home = mkdtempSync(join(tmpdir(), 'flow-iskills-bad-'));
    try {
      const { rc, stderr } = await captureOutput(() =>
        installSkills({ scope: 'galaxy' }, { repoRoot: REPO_ROOT, cwd: home, home })
      );
      assert.equal(rc, 1);
      assert.match(stderr, /Unknown scope: galaxy/);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it('default scope=home creates symlinks into <home>/.claude/skills/', async () => {
    const home = mkdtempSync(join(tmpdir(), 'flow-iskills-home-'));
    try {
      const { rc, stdout } = await captureOutput(() =>
        installSkills({}, { repoRoot: REPO_ROOT, cwd: home, home })
      );
      assert.equal(rc, 0);
      for (const skill of ['flow-init', 'flow-sprint', 'flow-story', 'flow-doctor']) {
        const target = join(home, '.claude', 'skills', skill);
        assert.ok(existsSync(target), `${skill} should be linked`);
        const stat = lstatSync(target);
        assert.ok(stat.isSymbolicLink(), `${skill} should be a symlink, not a directory`);
        const resolved = resolve(dirname(target), readlinkSync(target));
        assert.equal(resolved, join(SOURCE_SKILLS, skill));
      }
      assert.match(stdout, /Done: 4 linked, 0 skipped/);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it('scope=project creates symlinks under <cwd>/.claude/skills/ (team-commit pattern)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-iskills-proj-'));
    const home = mkdtempSync(join(tmpdir(), 'flow-iskills-proj-home-'));
    try {
      const { rc } = await captureOutput(() =>
        installSkills({ scope: 'project' }, { repoRoot: REPO_ROOT, cwd, home })
      );
      assert.equal(rc, 0);
      for (const skill of ['flow-init', 'flow-sprint', 'flow-story', 'flow-doctor']) {
        const projectTarget = join(cwd, '.claude', 'skills', skill);
        assert.ok(existsSync(projectTarget), `project ${skill} should exist`);
        assert.ok(lstatSync(projectTarget).isSymbolicLink());
      }
      // Home scope should NOT have been touched.
      assert.equal(existsSync(join(home, '.claude', 'skills', 'flow-init')), false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('scope=both creates symlinks in BOTH home and project', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flow-iskills-both-'));
    const home = mkdtempSync(join(tmpdir(), 'flow-iskills-both-home-'));
    try {
      const { rc } = await captureOutput(() =>
        installSkills({ scope: 'both' }, { repoRoot: REPO_ROOT, cwd, home })
      );
      assert.equal(rc, 0);
      assert.ok(existsSync(join(home, '.claude', 'skills', 'flow-init')));
      assert.ok(existsSync(join(cwd, '.claude', 'skills', 'flow-init')));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('idempotent re-run skips already-correctly-linked skills', async () => {
    const home = mkdtempSync(join(tmpdir(), 'flow-iskills-idem-'));
    try {
      await captureOutput(() => installSkills({}, { repoRoot: REPO_ROOT, cwd: home, home }));
      const { rc, stdout } = await captureOutput(() =>
        installSkills({}, { repoRoot: REPO_ROOT, cwd: home, home })
      );
      assert.equal(rc, 0);
      // All four should now report "already-linked".
      assert.match(stdout, /Done: 0 linked, 4 skipped/);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it('refuses to clobber a real directory at the target without --force', async () => {
    const home = mkdtempSync(join(tmpdir(), 'flow-iskills-refuse-'));
    try {
      // Pre-create a real directory (not a symlink) at one target — simulates
      // a user who manually copied skill files in.
      mkdirSync(join(home, '.claude', 'skills', 'flow-init'), { recursive: true });
      writeFileSync(join(home, '.claude', 'skills', 'flow-init', 'sentinel.md'), 'hand-edited');

      const { rc, stdout } = await captureOutput(() =>
        installSkills({}, { repoRoot: REPO_ROOT, cwd: home, home })
      );
      assert.equal(rc, 0);
      // flow-init should be refused; the other three linked.
      assert.match(stdout, /flow-init.*real directory exists/);
      assert.match(stdout, /Done: 3 linked, 1 skipped/);
      // Sentinel still present — defensive non-clobber held.
      assert.ok(existsSync(join(home, '.claude', 'skills', 'flow-init', 'sentinel.md')));
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it('--force replaces a real directory at the target with a symlink', async () => {
    const home = mkdtempSync(join(tmpdir(), 'flow-iskills-force-'));
    try {
      mkdirSync(join(home, '.claude', 'skills', 'flow-init'), { recursive: true });
      writeFileSync(join(home, '.claude', 'skills', 'flow-init', 'old.md'), 'stale');

      const { rc } = await captureOutput(() =>
        installSkills({ force: true }, { repoRoot: REPO_ROOT, cwd: home, home })
      );
      assert.equal(rc, 0);
      const target = join(home, '.claude', 'skills', 'flow-init');
      assert.ok(lstatSync(target).isSymbolicLink(), 'target should now be a symlink');
      // Old content gone — the dir got replaced.
      assert.equal(existsSync(join(target, 'old.md')), false);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it('--dry-run reports what would link without actually creating symlinks', async () => {
    const home = mkdtempSync(join(tmpdir(), 'flow-iskills-dry-'));
    try {
      const { rc, stdout } = await captureOutput(() =>
        installSkills({ 'dry-run': true }, { repoRoot: REPO_ROOT, cwd: home, home })
      );
      assert.equal(rc, 0);
      assert.match(stdout, /dry-run: nothing was actually linked/);
      assert.equal(existsSync(join(home, '.claude', 'skills')), false, 'no fs writes during dry-run');
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it('replaces a wrong-source symlink without --force (safe — not user content)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'flow-iskills-wrong-'));
    const decoy = mkdtempSync(join(tmpdir(), 'flow-iskills-decoy-'));
    try {
      // Pre-create a symlink pointing somewhere irrelevant — the case where
      // a previous install left a stale symlink. Replacing this without
      // --force is safe because symlinks aren't user content.
      mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
      symlinkSync(decoy, join(home, '.claude', 'skills', 'flow-init'));

      const { rc, stdout } = await captureOutput(() =>
        installSkills({}, { repoRoot: REPO_ROOT, cwd: home, home })
      );
      assert.equal(rc, 0);
      // All four (including the wrong-pointing flow-init) should now be linked.
      assert.match(stdout, /Done: 4 linked/);
      const target = join(home, '.claude', 'skills', 'flow-init');
      const resolved = resolve(dirname(target), readlinkSync(target));
      assert.equal(resolved, join(SOURCE_SKILLS, 'flow-init'));
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(decoy, { recursive: true, force: true });
    }
  });
});
