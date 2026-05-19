// tools/lint-changelog.test.js — coverage for the CHANGELOG linter.

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execaSync } from 'execa';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LINTER = resolve(__dirname, 'lint-changelog.js');

function run(filePath) {
  try {
    const r = execaSync('node', [LINTER, filePath]);
    return { rc: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (err) {
    return { rc: err.exitCode, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

describe('lint-changelog', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'flow-lint-changelog-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes on a clean changelog', () => {
    const path = join(tmpDir, 'good.md');
    writeFileSync(path, `# Changelog

## [Unreleased]

### Added
- One-line entry A.
- One-line entry B with [a link](https://example.com).

### Fixed
- One-line fix.
`);
    const { rc, stdout } = run(path);
    assert.equal(rc, 0);
    assert.match(stdout, /one-line/);
  });

  it('flags a wrapped entry', () => {
    const path = join(tmpDir, 'wrapped.md');
    writeFileSync(path, `# Changelog

## [Unreleased]

### Added
- This entry wraps
onto a second line which is wrong.
`);
    const { rc, stderr } = run(path);
    assert.equal(rc, 1);
    assert.match(stderr, /1 wrapped CHANGELOG entry/);
  });

  it('allows indented continuation (nested lists, literal blocks)', () => {
    const path = join(tmpDir, 'nested.md');
    writeFileSync(path, `# Changelog

## [Unreleased]

### Added
- Entry with nested list:
  - sub-bullet one
  - sub-bullet two
- Entry with literal block:
    code line 1
    code line 2
`);
    const { rc } = run(path);
    assert.equal(rc, 0);
  });

  it('allows entries inside fenced code blocks', () => {
    const path = join(tmpDir, 'fenced.md');
    writeFileSync(path, `# Changelog

## [Unreleased]

### Added
- Entry referencing a code example:

  \`\`\`
  This is inside a code block
  and would otherwise look wrapped
  \`\`\`
- Another entry.
`);
    const { rc } = run(path);
    assert.equal(rc, 0);
  });

  it('exits 2 on missing file', () => {
    const { rc, stderr } = run('/nonexistent/changelog.md');
    assert.equal(rc, 2);
    assert.match(stderr, /not found/);
  });

  it('flags multiple wrapped entries with line numbers', () => {
    const path = join(tmpDir, 'multi.md');
    writeFileSync(path, `# Changelog

## [Unreleased]

### Added
- First wraps
here.
- Second is fine.

### Fixed
- Third wraps
too.
`);
    const { rc, stderr } = run(path);
    assert.equal(rc, 1);
    assert.match(stderr, /2 wrapped CHANGELOG entries/);
  });
});
