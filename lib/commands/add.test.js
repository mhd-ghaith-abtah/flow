// lib/commands/add.test.js — coverage for `flow add`.

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import add from './add.js';

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

describe('flow add', () => {
  let tmpDir;
  let tmpHome;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'flow-add-test-'));
    tmpHome = mkdtempSync(join(tmpdir(), 'flow-add-home-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
  });

  const ctx = () => ({ repoRoot: REPO_ROOT, cwd: tmpDir, home: tmpHome });

  it('rejects when no component-id positional', async () => {
    const { rc, stderr } = await captureOutput(() => add({ _: [] }, ctx()));
    assert.equal(rc, 1);
    assert.match(stderr, /Missing component id/);
  });

  it('rejects unknown component id', async () => {
    const { rc, stderr } = await captureOutput(() =>
      add({ _: ['adapter:bogus'] }, ctx())
    );
    assert.equal(rc, 1);
    assert.match(stderr, /Unknown component/);
  });

  it('--dry-run shows operations without touching disk', async () => {
    const { rc, stdout } = await captureOutput(() =>
      add({ _: ['adapter:e2e-playwright-mcp'], 'dry-run': true }, ctx())
    );
    assert.equal(rc, 0);
    assert.match(stdout, /Headless browser/);
    assert.match(stdout, /Operations:/);
    assert.ok(!existsSync(join(tmpHome, '.claude', 'skills', 'flow-story', 'adapters', 'e2e', 'playwright-mcp.md')));
  });

  it('warns when no flow.config.yaml exists in cwd', async () => {
    const { rc, stdout } = await captureOutput(() =>
      add({ _: ['adapter:e2e-playwright-mcp'], yes: true }, ctx())
    );
    assert.equal(rc, 0);
    assert.match(stdout, /No flow.config.yaml/);
  });

  it('updates flow.config.yaml adapters when present + --yes', async () => {
    const configPath = join(tmpDir, 'flow.config.yaml');
    writeFileSync(configPath, 'version: 1\nadapters:\n  e2e: none\n');
    const { rc, stdout } = await captureOutput(() =>
      add({ _: ['adapter:e2e-playwright-mcp'], yes: true }, ctx())
    );
    assert.equal(rc, 0);
    assert.match(stdout, /adapters.e2e none → playwright-mcp/);
    const parsed = parseYaml(readFileSync(configPath, 'utf-8'));
    assert.equal(parsed.adapters.e2e, 'playwright-mcp');
  });
});
