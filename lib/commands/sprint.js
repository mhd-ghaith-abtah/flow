// lib/commands/sprint.js — `flow sprint <subcommand>` CLI dispatcher.
//
// Headless port of the LLM-free portion of /flow-sprint. Six subcommands:
//   add | next | status | done | deferred | import-bmad
//
// LLM-driven subcommands (retro, scope-review, init Q&A) stay in the
// skill workflow per ROADMAP principle #6 ("one source of truth per
// behavior"). The CLI is for scripts, CI, and headless flows; the
// skill is for in-Claude-Code work.

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import chalk from 'chalk';
import { findSprintFile, loadSprint, saveSprint } from '../sprint/store.js';
import {
  addStory,
  nextStory,
  setStatus,
  summarize,
  parseDeferred,
} from '../sprint/operations.js';
import { migrate as migrateBmad } from '../init/migrate-bmad.js';

const STATUS_ICON = Object.freeze({
  backlog: '○',
  doing: '◐',
  review: '⏳',
  done: '✓',
  cancelled: '✗',
});

function toList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * @param {Object} args
 * @param {Object} ctx
 */
export default async function sprint(args, ctx) {
  // First positional after the subcommand is the subcommand id.
  const positional = args._ || [];
  const sub = positional[0];
  if (!sub) {
    console.error(chalk.red('flow sprint: missing subcommand'));
    console.error('usage: flow sprint <add|next|status|done|deferred|import-bmad> [args...]');
    return 1;
  }

  const cwd = ctx.cwd || process.cwd();
  const sprintPath = findSprintFile(cwd) || join(cwd, 'docs', 'flow', 'sprint.yaml');

  switch (sub) {
    case 'status':       return runStatus({ args, sprintPath });
    case 'add':          return runAdd({ args, sprintPath });
    case 'next':         return runNext({ args, sprintPath });
    case 'done':         return runDone({ args, sprintPath });
    case 'deferred':     return runDeferred({ args, sprintPath, cwd });
    case 'import-bmad':  return runImportBmad({ args, cwd });
    default:
      console.error(chalk.red(`flow sprint: unknown subcommand "${sub}"`));
      console.error('valid: add, next, status, done, deferred, import-bmad');
      return 1;
  }
}

function loadOrReport(sprintPath) {
  if (!existsSync(sprintPath)) {
    console.error(chalk.red(`sprint.yaml not found at ${sprintPath}`));
    console.error(chalk.dim('Run `flow init` (or `flow sprint import-bmad`) to create one.'));
    return null;
  }
  try {
    return loadSprint(sprintPath);
  } catch (err) {
    console.error(chalk.red(`failed to load sprint.yaml: ${err.message}`));
    return null;
  }
}

function runStatus({ args, sprintPath }) {
  const store = loadOrReport(sprintPath);
  if (!store) return 2;
  const { epics, counts } = summarize(store);

  if (args.json) {
    console.log(JSON.stringify({ epics, counts, path: sprintPath }, null, 2));
    return 0;
  }

  console.log(chalk.bold('━━━ flow sprint status ━━━'));
  console.log(chalk.dim(sprintPath));
  console.log();
  for (const epic of epics) {
    const head = `${chalk.bold(epic.id)} — ${epic.title}  (${epic.done}/${epic.total})`;
    console.log(epic.done === epic.total && epic.total > 0 ? `${head} ${chalk.green('✓')}` : head);
    for (const s of epic.stories) {
      const icon = STATUS_ICON[s.status] || '?';
      const issue = s.issue ? chalk.dim(`  ·  ${s.issue}`) : '';
      console.log(`  ${icon} ${s.id}  ${s.title}${issue}`);
    }
    console.log();
  }
  console.log(chalk.bold('Counts: ') +
    `${counts.backlog} backlog · ${counts.doing} doing · ${counts.review} review · ${counts.done} done · ${counts.cancelled} cancelled`);
  return 0;
}

function runAdd({ args, sprintPath }) {
  const store = loadOrReport(sprintPath);
  if (!store) return 2;
  const result = addStory(store, {
    id: args.id,
    title: args.title,
    epic: args.epic,
    status: args.status,
    tags: toList(args.tags),
    why: args.why,
    issue: args.issue,
  });
  if (!result.ok) {
    console.error(chalk.red(`✗ ${result.error}`));
    return 1;
  }
  saveSprint(store);
  if (args.json) {
    console.log(JSON.stringify({ ok: true, story: result.story }, null, 2));
    return 0;
  }
  console.log(chalk.green(`✓ added ${result.story.id} — ${result.story.title}`));
  console.log(chalk.dim(`  epic: ${result.story.epic} · status: ${result.story.status}`));
  return 0;
}

function runNext({ args, sprintPath }) {
  const store = loadOrReport(sprintPath);
  if (!store) return 2;
  const result = nextStory(store, { epic: args.epic });
  if (!result.ok) {
    console.error(chalk.yellow(`⚠ ${result.error}`));
    return 1;
  }
  saveSprint(store);
  if (args.json) {
    console.log(JSON.stringify({ ok: true, story: result.story }, null, 2));
    return 0;
  }
  console.log(chalk.green(`▶ next: ${result.story.id} — ${result.story.title}`));
  console.log(chalk.dim(`  epic: ${result.story.epic} · status: doing`));
  return 0;
}

function runDone({ args, sprintPath }) {
  const id = args.id || (args._ || [])[1];
  if (!id) {
    console.error(chalk.red('flow sprint done: missing story id'));
    console.error(chalk.dim('usage: flow sprint done <story-id> [--note "..."] [--force]'));
    return 1;
  }
  const store = loadOrReport(sprintPath);
  if (!store) return 2;
  const result = setStatus(store, id, 'done', { note: args.note, force: Boolean(args.force) });
  if (!result.ok) {
    console.error(chalk.red(`✗ ${result.error}`));
    return 1;
  }
  saveSprint(store);
  if (args.json) {
    console.log(JSON.stringify({ ok: true, story: result.story }, null, 2));
    return 0;
  }
  console.log(chalk.green(`✓ ${result.story.id} done`));
  if (args.note) console.log(chalk.dim(`  note: ${args.note}`));
  return 0;
}

function runDeferred({ args, sprintPath, cwd }) {
  const deferredPath = join(dirname(sprintPath), 'deferred.md');
  if (!existsSync(deferredPath)) {
    if (args.json) {
      console.log(JSON.stringify({ ok: true, open: [], resolved: [], path: deferredPath }, null, 2));
      return 0;
    }
    console.log(chalk.dim(`No deferred-work file at ${deferredPath}.`));
    console.log(chalk.dim('Create one with: echo "- first item" > docs/flow/deferred.md'));
    return 0;
  }
  const text = readFileSync(deferredPath, 'utf8');
  const { open, resolved } = parseDeferred(text);
  if (args.json) {
    console.log(JSON.stringify({ ok: true, open, resolved, path: deferredPath }, null, 2));
    return 0;
  }
  console.log(chalk.bold(`━━━ deferred work (${open.length} open · ${resolved.length} resolved) ━━━`));
  for (const item of open) console.log(`  ${chalk.yellow('○')} ${item}`);
  for (const item of resolved) console.log(`  ${chalk.green('✓')} ${chalk.dim(item)}`);
  return 0;
}

function runImportBmad({ args, cwd }) {
  const result = migrateBmad(cwd, { projectName: args.project });
  if (!result.ok) {
    console.error(chalk.red(`✗ import-bmad failed: ${result.error}`));
    if (result.backups?.length) {
      console.error(chalk.dim(`  backups (preserved for inspection): ${result.backups.join(', ')}`));
    }
    return 1;
  }
  if (args.json) {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return 0;
  }
  console.log(chalk.green(`✓ migrated from BMad`));
  console.log(chalk.dim(`  stories: ${result.storiesImported} across ${result.epicsImported} epic(s)`));
  console.log(chalk.dim(`  deferred: ${result.deferredImported} item(s)`));
  console.log(chalk.dim(`  backups: ${result.backups.length} file(s) staged as .flow-backup-${result.backupTs}`));
  return 0;
}
