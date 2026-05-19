// lib/commands/uninstall.js — `flow uninstall` removal path.
//
// Removes Flow's own skills, adapters, and per-scope state. Does NOT touch
// BMad, ECC, or Caveman — those are owned by their own installers and Flow
// only records that they were used.
//
// Default: --scope project (only this project's .claude/flow/). Pass
// --scope home to remove the user-level install. Pass --scope both to do both.
//
// Default: dry-run. Prints what WOULD be removed. Pass --execute to actually
// remove. Refuses to run without --execute unless --yes is also passed.

import { existsSync, rmSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import chalk from 'chalk';
import { loadCatalog } from '../catalog.js';
import { resolveRepoRoot } from '../repo-root.js';

const HOME_PATHS = [
  '$HOME/.claude/skills/flow-init',
  '$HOME/.claude/skills/flow-sprint',
  '$HOME/.claude/skills/flow-story',
  '$HOME/.claude/skills/flow-doctor',
  '$HOME/.claude/flow'
];

const PROJECT_PATHS = [
  '.claude/flow',
  'flow.config.yaml',
  'flow.config.local.yaml'
];

const PROJECT_PATHS_KEEP_BY_DEFAULT = [
  // These are user content — keep unless --remove-stories is passed.
  'docs/flow'
];

/**
 * @param {Object} args
 * @param {Object} ctx
 */
export default async function uninstall(args, ctx) {
  const repoRoot = ctx.repoRoot ?? resolveRepoRoot(import.meta.url);
  loadCatalog(repoRoot);  // validate parseable

  const scope = args.scope ?? 'project';
  const execute = Boolean(args.execute);
  const yes = Boolean(args.yes);
  const removeStories = Boolean(args['remove-stories']);
  const removeBackups = Boolean(args['remove-backups']);

  if (!['project', 'home', 'both'].includes(scope)) {
    console.error(chalk.red(`✗ Unknown scope: ${scope}. Use project | home | both.`));
    return 1;
  }

  const plan = buildPlan({ scope, removeStories, removeBackups, cwd: ctx.cwd, home: ctx.home });

  renderPlan(plan, { execute });

  if (!execute) {
    console.log();
    console.log(chalk.dim('Dry run. Re-run with --execute to actually remove. Add --yes to skip the confirm.'));
    return 0;
  }

  if (!yes) {
    console.log();
    console.log(chalk.yellow('⚠'), 'About to remove the above. Re-run with --execute --yes to confirm.');
    return 0;
  }

  // Execute.
  console.log();
  console.log(chalk.bold('Removing:'));
  let removed = 0;
  let kept = 0;
  for (const item of plan.toRemove) {
    if (!existsSync(item.resolved)) {
      console.log(`  ${chalk.dim('skip (not present)')} ${item.path}`);
      kept++;
      continue;
    }
    try {
      rmSync(item.resolved, { recursive: true, force: true });
      console.log(`  ${chalk.green('removed')} ${item.path}`);
      removed++;
    } catch (err) {
      console.log(`  ${chalk.red('failed')} ${item.path}: ${err.message}`);
    }
  }

  console.log();
  console.log(chalk.bold(`Done: ${removed} removed, ${kept} not present.`));
  console.log();
  console.log(chalk.dim('Flow does NOT remove BMad, ECC, or Caveman — they were installed by their own'));
  console.log(chalk.dim('installers and Flow only recorded that they were used. Remove them via:'));
  console.log(chalk.dim('  BMad:    rm -rf _bmad/ docs/_bmad-output/ (or `npx bmad-method uninstall`)'));
  console.log(chalk.dim('  ECC:     ~/.claude/rules/uninstall.sh (or rm -rf ~/.claude/rules/)'));
  console.log(chalk.dim('  Caveman: rm -rf ~/.claude/plugins/cache/caveman/ and `claude mcp remove caveman-shrink`'));

  return 0;
}

function buildPlan({ scope, removeStories, removeBackups, cwd, home }) {
  const toRemove = [];

  if (scope === 'home' || scope === 'both') {
    for (const p of HOME_PATHS) {
      toRemove.push({ path: p, resolved: resolveHomePath(p, home), kind: 'home' });
    }
  }

  if (scope === 'project' || scope === 'both') {
    for (const p of PROJECT_PATHS) {
      toRemove.push({ path: p, resolved: resolve(cwd, p), kind: 'project' });
    }
    if (removeStories) {
      for (const p of PROJECT_PATHS_KEEP_BY_DEFAULT) {
        toRemove.push({ path: p, resolved: resolve(cwd, p), kind: 'project-user-content' });
      }
    }
  }

  const toKeep = [];
  if (scope !== 'home' && !removeStories) {
    for (const p of PROJECT_PATHS_KEEP_BY_DEFAULT) {
      toKeep.push({ path: p, resolved: resolve(cwd, p), reason: 'user content — pass --remove-stories to drop' });
    }
  }
  toKeep.push({ path: 'BMad', reason: 'owned by BMad installer; not removed' });
  toKeep.push({ path: 'ECC', reason: 'owned by ECC installer; not removed' });
  toKeep.push({ path: 'Caveman', reason: 'owned by Caveman installer; not removed' });

  return { scope, toRemove, toKeep, removeBackups };
}

function resolveHomePath(p, home) {
  return p.replace(/\$HOME/g, home);
}

function renderPlan(plan, { execute }) {
  console.log(chalk.bold(`━━━ flow uninstall plan (scope: ${plan.scope}) ━━━`));
  console.log();
  console.log(chalk.bold(execute ? 'Will remove:' : 'Would remove:'));
  for (const item of plan.toRemove) {
    const present = existsSync(item.resolved);
    const tag = present ? chalk.red('-') : chalk.dim('-');
    const suffix = present ? '' : chalk.dim('  (not present)');
    console.log(`  ${tag} ${item.path}${suffix}`);
  }
  console.log();
  console.log(chalk.bold('Keeping:'));
  for (const item of plan.toKeep) {
    console.log(`  ${chalk.green('+')} ${item.path}  ${chalk.dim('— ' + item.reason)}`);
  }
}
