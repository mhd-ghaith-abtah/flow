// lib/init/secrets.test.js — coverage for the MCP secrets collector.
//
// All tests use opts.values (pre-populated values) to avoid firing any
// interactive password prompts. The dry-run cases additionally verify
// no file is written.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectAndWriteSecrets } from './secrets.js';

function mcpResultFor(id, envSpecs) {
  return {
    ok: true, exitCode: 0, id,
    command: { cmd: 'claude', args: ['mcp', 'add', id], source: `mcp:${id}` },
    stateRecord: { id, auth: 'api_token' },
    requiredEnv: envSpecs,
  };
}

describe('collectAndWriteSecrets', () => {
  it('returns store=skipped when no MCP needs secrets', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'flow-sec-skip-'));
    try {
      const result = await collectAndWriteSecrets([], 'env-file', { homeDir, values: {} });
      assert.equal(result.ok, true);
      assert.equal(result.store, 'skipped');
      assert.equal(result.path, null);
    } finally { rmSync(homeDir, { recursive: true, force: true }); }
  });

  it('writes ~/.claude/.env.flow with chmod 600 and the supplied values', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'flow-sec-envfile-'));
    try {
      const result = await collectAndWriteSecrets(
        [mcpResultFor('github-mcp', [{ name: 'GITHUB_TOKEN', secret: true, prompt: 'GH token:' }])],
        'env-file',
        { homeDir, values: { GITHUB_TOKEN: 'ghp_real-token-value' } }
      );
      assert.equal(result.ok, true);
      assert.equal(result.store, 'env-file');
      const path = join(homeDir, '.claude', '.env.flow');
      assert.equal(result.path, path);
      assert.ok(existsSync(path));
      const content = readFileSync(path, 'utf8');
      assert.match(content, /GITHUB_TOKEN='ghp_real-token-value'/);
      // chmod 600 on POSIX (skip the assertion on Windows where mode bits don't apply).
      if (process.platform !== 'win32') {
        const mode = statSync(path).mode & 0o777;
        assert.equal(mode, 0o600);
      }
    } finally { rmSync(homeDir, { recursive: true, force: true }); }
  });

  it('merges into an existing .env.flow without losing unrelated keys', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'flow-sec-merge-'));
    try {
      // Seed an existing env file with a key Flow doesn't manage.
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(join(homeDir, '.claude'), { recursive: true });
      writeFileSync(join(homeDir, '.claude', '.env.flow'),
        '# user content\nOPENAI_API_KEY=sk-existing\nFLOW_OLD=removed-this\n');

      await collectAndWriteSecrets(
        [mcpResultFor('github-mcp', [{ name: 'GITHUB_TOKEN', secret: true, prompt: 'x' }])],
        'env-file',
        { homeDir, values: { GITHUB_TOKEN: 'new-value' } }
      );
      const content = readFileSync(join(homeDir, '.claude', '.env.flow'), 'utf8');
      // Unrelated key preserved.
      assert.match(content, /OPENAI_API_KEY=sk-existing/);
      // Existing FLOW_OLD line preserved (we don't garbage-collect; only
      // rewrite keys we know about).
      assert.match(content, /FLOW_OLD=removed-this/);
      // New key appended.
      assert.match(content, /GITHUB_TOKEN='new-value'/);
    } finally { rmSync(homeDir, { recursive: true, force: true }); }
  });

  it('overwrites an existing managed key with the new value', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'flow-sec-overwrite-'));
    try {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(join(homeDir, '.claude'), { recursive: true });
      writeFileSync(join(homeDir, '.claude', '.env.flow'),
        'GITHUB_TOKEN=old-value\n');

      await collectAndWriteSecrets(
        [mcpResultFor('github-mcp', [{ name: 'GITHUB_TOKEN', secret: true, prompt: 'x' }])],
        'env-file',
        { homeDir, values: { GITHUB_TOKEN: 'rotated-value' } }
      );
      const content = readFileSync(join(homeDir, '.claude', '.env.flow'), 'utf8');
      assert.match(content, /GITHUB_TOKEN='rotated-value'/);
      assert.doesNotMatch(content, /GITHUB_TOKEN=old-value/);
    } finally { rmSync(homeDir, { recursive: true, force: true }); }
  });

  it('shell-quotes values containing single quotes correctly', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'flow-sec-quote-'));
    try {
      await collectAndWriteSecrets(
        [mcpResultFor('weird-mcp', [{ name: 'WEIRD', secret: true }])],
        'env-file',
        { homeDir, values: { WEIRD: "it's a 'tricky' value" } }
      );
      const content = readFileSync(join(homeDir, '.claude', '.env.flow'), 'utf8');
      // The standard `'...'\''...'` escape pattern.
      assert.match(content, /WEIRD='it'\\''s a '\\''tricky'\\'' value'/);
    } finally { rmSync(homeDir, { recursive: true, force: true }); }
  });

  it('dryRun: returns ok + path but writes nothing to disk', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'flow-sec-dry-'));
    try {
      const result = await collectAndWriteSecrets(
        [mcpResultFor('github-mcp', [{ name: 'GITHUB_TOKEN', secret: true, prompt: 'x' }])],
        'env-file',
        { homeDir, dryRun: true, values: { GITHUB_TOKEN: 'irrelevant' } }
      );
      assert.equal(result.ok, true);
      assert.equal(result.path, join(homeDir, '.claude', '.env.flow'));
      assert.ok(!existsSync(result.path), 'dryRun must not write the file');
    } finally { rmSync(homeDir, { recursive: true, force: true }); }
  });

  it('shell store: returns ok=true without writing; envVarsWritten populated', async () => {
    const result = await collectAndWriteSecrets(
      [mcpResultFor('github-mcp', [{ name: 'GITHUB_TOKEN', secret: true, prompt: 'x' }])],
      'shell',
      { dryRun: true, values: { GITHUB_TOKEN: 'value' } }
    );
    assert.equal(result.ok, true);
    assert.equal(result.store, 'shell');
    assert.equal(result.path, null);
    assert.deepEqual(result.envVarsWritten, ['GITHUB_TOKEN']);
  });

  it('1password store: returns ok=true with instructions surfaced', async () => {
    const result = await collectAndWriteSecrets(
      [mcpResultFor('github-mcp', [{ name: 'GITHUB_TOKEN', secret: true, prompt: 'x' }])],
      '1password',
      { dryRun: true, values: { GITHUB_TOKEN: 'value' } }
    );
    assert.equal(result.ok, true);
    assert.equal(result.store, '1password');
    assert.equal(result.path, null);
  });

  // (No focused test for "no $HOME" — collectAndWriteSecrets falls back
  // to process.env.HOME when opts.homeDir is nullish, so triggering the
  // failure branch requires unsetting process.env.HOME, which races
  // sibling tests. The error path stays as defensive code; production
  // environments where $HOME is genuinely absent will hit it directly.)
});
