// lib/commands/plan.test.js — coverage for the `flow plan` resolver.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import plan from './plan.js';

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

describe('flow plan', () => {
  const ctx = { repoRoot: REPO_ROOT, cwd: REPO_ROOT, home: process.env.HOME, insideClaudeCode: false };

  it('emits valid JSON for every shipped profile', async () => {
    for (const profile of ['minimal', 'mini', 'standard', 'team']) {
      const { rc, stdout } = await captureOutput(() => plan({ profile, json: true }, ctx));
      assert.equal(rc, 0, `profile ${profile} should exit 0`);
      const parsed = JSON.parse(stdout);
      assert.equal(parsed.profile, profile);
      assert.ok(Array.isArray(parsed.adapters), `${profile}: adapters is array`);
      assert.ok(Array.isArray(parsed.flow_components));
      assert.ok(parsed.upstreams);
    }
  });

  it('returns exit code 1 for unknown profile', async () => {
    const { rc, stderr } = await captureOutput(() => plan({ profile: 'bogus' }, ctx));
    assert.equal(rc, 1);
    assert.match(stderr, /Unknown profile/);
  });

  it('--with adds an adapter outside the profile bundle', async () => {
    const { rc, stdout } = await captureOutput(() =>
      plan({ profile: 'minimal', json: true, with: ['adapter:e2e-playwright-mcp'] }, ctx)
    );
    assert.equal(rc, 0);
    const parsed = JSON.parse(stdout);
    assert.ok(parsed.adapters.includes('adapter:e2e-playwright-mcp'),
      '--with should add the adapter');
    // Should override the same-family default (e2e-none from minimal).
    assert.ok(!parsed.adapters.includes('adapter:e2e-none'),
      '--with should override the same-family default');
  });

  it('--without removes an adapter from the profile bundle', async () => {
    const { rc, stdout } = await captureOutput(() =>
      plan({ profile: 'team', json: true, without: ['adapter:e2e-playwright-mcp'] }, ctx)
    );
    assert.equal(rc, 0);
    const parsed = JSON.parse(stdout);
    assert.ok(!parsed.adapters.includes('adapter:e2e-playwright-mcp'),
      '--without should remove the adapter');
  });

  it('--with single string (not array) still works', async () => {
    // yargs-parser sometimes hands a single string when only one --with is passed
    const { rc, stdout } = await captureOutput(() =>
      plan({ profile: 'minimal', json: true, with: 'adapter:e2e-playwright-mcp' }, ctx)
    );
    assert.equal(rc, 0);
    const parsed = JSON.parse(stdout);
    assert.ok(parsed.adapters.includes('adapter:e2e-playwright-mcp'));
  });
});
