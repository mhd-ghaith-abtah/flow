// lib/commands/remove.test.js — coverage for `flow remove`.

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import remove from './remove.js';

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

describe('flow remove', () => {
  let tmpDir;
  let tmpHome;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'flow-remove-test-'));
    tmpHome = mkdtempSync(join(tmpdir(), 'flow-remove-home-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
  });

  const ctx = () => ({ repoRoot: REPO_ROOT, cwd: tmpDir, home: tmpHome });

  it('rejects when no component-id positional', async () => {
    const { rc, stderr } = await captureOutput(() => remove({ _: [] }, ctx()));
    assert.equal(rc, 1);
    assert.match(stderr, /Missing component id/);
  });

  it('rejects unknown adapter id', async () => {
    const { rc, stderr } = await captureOutput(() =>
      remove({ _: ['adapter:bogus'] }, ctx())
    );
    assert.equal(rc, 1);
    assert.match(stderr, /Unknown adapter/);
  });

  it('no-ops when flow.config.yaml does not exist in cwd', async () => {
    const { rc, stdout, stderr } = await captureOutput(() =>
      remove({ _: ['adapter:e2e-playwright-mcp'] }, ctx())
    );
    assert.equal(rc, 0);
    // remove.js prints to stderr when no config (yellow ⚠)
    assert.match(stdout + stderr, /No flow.config.yaml/);
  });

  it('no-ops when active adapter for family is not the one being removed', async () => {
    const configPath = join(tmpDir, 'flow.config.yaml');
    writeFileSync(configPath, 'version: 1\nadapters:\n  e2e: none\n');
    const { rc, stdout } = await captureOutput(() =>
      remove({ _: ['adapter:e2e-playwright-mcp'] }, ctx())
    );
    assert.equal(rc, 0);
    assert.match(stdout, /Nothing to remove/);
  });

  it('flips active adapter to none family fallback with --yes', async () => {
    const configPath = join(tmpDir, 'flow.config.yaml');
    writeFileSync(configPath, 'version: 1\nadapters:\n  e2e: playwright-mcp\n');
    const { rc, stdout } = await captureOutput(() =>
      remove({ _: ['adapter:e2e-playwright-mcp'], yes: true }, ctx())
    );
    assert.equal(rc, 0);
    assert.match(stdout, /adapters.e2e playwright-mcp → none/);
    const parsed = parseYaml(readFileSync(configPath, 'utf-8'));
    assert.equal(parsed.adapters.e2e, 'none');
  });

  it('--dry-run shows the change without writing', async () => {
    const configPath = join(tmpDir, 'flow.config.yaml');
    writeFileSync(configPath, 'version: 1\nadapters:\n  e2e: playwright-mcp\n');
    const { rc, stdout } = await captureOutput(() =>
      remove({ _: ['adapter:e2e-playwright-mcp'], 'dry-run': true }, ctx())
    );
    assert.equal(rc, 0);
    assert.match(stdout, /--dry-run/);
    const parsed = parseYaml(readFileSync(configPath, 'utf-8'));
    assert.equal(parsed.adapters.e2e, 'playwright-mcp');  // unchanged
  });
});
