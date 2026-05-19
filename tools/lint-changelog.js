#!/usr/bin/env node
// tools/lint-changelog.js — enforce CONTRIBUTING.md's "one-line entries" rule.
//
// CHANGELOG entries under ### Added / ### Changed / ### Fixed / ### Removed
// must each be a single line. A wrapped entry (a continuation line that
// doesn't start with `- `, `#`, or a blank line) is a violation. Excludes
// indented continuation under fenced code blocks and list-of-list bullets.
//
// Exit codes:
//   0 — all entries one-line
//   1 — at least one wrapped entry
//   2 — usage error / file not found

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const path = process.argv[2];
if (!path) {
  console.error('usage: lint-changelog.js <CHANGELOG.md>');
  process.exit(2);
}
if (!existsSync(path)) {
  console.error(`✗ File not found: ${path}`);
  process.exit(2);
}

const text = readFileSync(resolve(path), 'utf-8');
const lines = text.split('\n');

let inEntrySection = false;
let inCodeBlock = false;
let currentEntryStart = -1;  // line number of the most recent `- ` entry, or -1
const violations = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // Track fenced code blocks — entries inside them are not subject to the rule.
  if (line.trim().startsWith('```')) {
    inCodeBlock = !inCodeBlock;
    continue;
  }
  if (inCodeBlock) continue;

  // Entry sections start with `### Added | Changed | Fixed | Removed | Deprecated | Security`.
  const sectionMatch = line.match(/^###\s+(Added|Changed|Fixed|Removed|Deprecated|Security)\b/);
  if (sectionMatch) {
    inEntrySection = true;
    currentEntryStart = -1;
    continue;
  }

  // Any other heading ends the entry section.
  if (line.startsWith('#')) {
    inEntrySection = false;
    currentEntryStart = -1;
    continue;
  }

  if (!inEntrySection) continue;

  // Blank line ends the current entry (no continuation).
  if (line.trim() === '') {
    currentEntryStart = -1;
    continue;
  }

  // Entry line starts with `- ` (top-level bullet).
  if (line.startsWith('- ')) {
    currentEntryStart = i + 1;  // 1-indexed
    continue;
  }

  // Indented sub-bullet or literal block — allowed for nested lists.
  if (line.startsWith(' ') || line.startsWith('\t')) {
    continue;
  }

  // Otherwise it's wrapped prose (starts at column 0, follows a `- ` entry).
  if (currentEntryStart > 0) {
    violations.push({ entryLine: currentEntryStart, wrapLine: i + 1, sample: line.slice(0, 80) });
    currentEntryStart = -1;  // only flag once per entry
  }
}

if (violations.length === 0) {
  console.log(`✓ CHANGELOG entries are one-line (${path})`);
  process.exit(0);
}

console.error(`✗ Found ${violations.length} wrapped CHANGELOG entr${violations.length === 1 ? 'y' : 'ies'} in ${path}:`);
for (const v of violations) {
  console.error(`  Line ${v.wrapLine} continues the entry that started at line ${v.entryLine}:`);
  console.error(`    "${v.sample}${v.sample.length === 80 ? '…' : ''}"`);
}
console.error('');
console.error('CONTRIBUTING.md requires one-line entries. Move detail into a referenced doc or split into multiple entries.');
process.exit(1);
