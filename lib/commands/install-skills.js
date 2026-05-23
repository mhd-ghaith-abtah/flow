// lib/commands/install-skills.js — bootstrap Flow's slash commands.
//
// Symlinks the four flow-* skills (flow-init, flow-sprint, flow-story,
// flow-doctor) from the Flow package source into a Claude Code skill
// directory so /flow-init / /flow-sprint / etc. resolve.
//
// This closes the bootstrap gap: `npm install -g @mhd-ghaith-abtah/flow`
// puts `flow` on $PATH but does NOT make slash commands work in Claude
// Code — those need to live under ~/.claude/skills/ (home scope) or
// <project>/.claude/skills/ (project scope, team-commit pattern).
//
// Idempotent: re-running is safe. Symlinks pointing at the correct
// source are skipped. Real directories at the target path refuse
// overwrite without --force (defensive — could be hand-edited content).
//
// Why symlinks (not copies):
//   - Updates to the package propagate automatically. Bug fix in the
//     skill workflow? `npm install -g @latest` and the slash command
//     immediately picks it up — no re-bootstrap.
//   - Disk footprint: 4× <1 kB symlinks instead of 4× ~30 kB copies.
// The tradeoff: deleting the npm package breaks the slash commands.
// That's a correct failure mode — uninstalling Flow SHOULD break /flow-*.

import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { resolveRepoRoot } from '../repo-root.js';

const SKILLS = Object.freeze(['flow-init', 'flow-sprint', 'flow-story', 'flow-doctor']);

/**
 * @param {Object} args - yargs-parser output
 * @param {Object} ctx
 */
export default async function installSkills(args, ctx) {
  const repoRoot = ctx.repoRoot ?? resolveRepoRoot(import.meta.url);
  const sourceSkillsDir = join(repoRoot, 'skills');
  const scope = args.scope ?? 'home';
  const force = Boolean(args.force);
  const dryRun = Boolean(args['dry-run']);
  const cwd = ctx.cwd || process.cwd();
  const homeDir = ctx.home || process.env.HOME;

  if (!existsSync(sourceSkillsDir)) {
    console.error(chalk.red(`✗ source skills not found at ${sourceSkillsDir}`));
    console.error(chalk.dim('  Repo root or package install path is wrong.'));
    return 2;
  }

  if (!['home', 'project', 'both'].includes(scope)) {
    console.error(chalk.red(`✗ Unknown scope: ${scope}. Use home | project | both.`));
    return 1;
  }

  const targets = resolveTargets({ scope, homeDir, cwd });
  if (targets.length === 0) {
    console.error(chalk.red(`✗ no target directories resolved for scope=${scope}`));
    if (scope !== 'project' && !homeDir) console.error(chalk.dim('  $HOME is not set; cannot resolve home scope.'));
    return 1;
  }

  console.log(chalk.bold('━━━ flow install-skills ━━━'));
  console.log(chalk.dim(`  source: ${sourceSkillsDir}`));
  console.log(chalk.dim(`  scope:  ${scope}  ${force ? '(force)' : ''}${dryRun ? ' (dry-run)' : ''}`));
  console.log();

  let linked = 0;
  let skipped = 0;
  let failed = 0;
  for (const targetDir of targets) {
    console.log(chalk.bold(`Target: ${targetDir}`));
    if (!dryRun) mkdirSync(targetDir, { recursive: true });
    for (const skill of SKILLS) {
      const src = join(sourceSkillsDir, skill);
      const dst = join(targetDir, skill);
      const result = linkOne({ src, dst, force, dryRun });
      if (result.status === 'linked') {
        console.log(`  ${chalk.green('+')} ${skill}  ${chalk.dim('→ ' + src)}`);
        linked++;
      } else if (result.status === 'already-linked') {
        console.log(`  ${chalk.dim('=')} ${skill}  ${chalk.dim('(symlink already points to source)')}`);
        skipped++;
      } else if (result.status === 'refused') {
        console.log(`  ${chalk.yellow('!')} ${skill}  ${chalk.dim('(real directory exists; pass --force to replace)')}`);
        skipped++;
      } else {
        console.log(`  ${chalk.red('✗')} ${skill}  ${chalk.red(result.error)}`);
        failed++;
      }
    }
    console.log();
  }

  if (failed > 0) {
    console.error(chalk.red(`✗ ${failed} skill(s) failed to link.`));
    return 1;
  }

  console.log(chalk.bold(`Done: ${linked} linked, ${skipped} skipped${failed ? `, ${failed} failed` : ''}.`));
  if (dryRun) {
    console.log(chalk.yellow('  (--dry-run: nothing was actually linked)'));
  } else if (linked > 0) {
    console.log();
    console.log(chalk.dim('Slash commands /flow-init, /flow-sprint, /flow-story, /flow-doctor are now'));
    console.log(chalk.dim('available in any Claude Code session for the chosen scope.'));
  }
  return 0;
}

/**
 * Resolve the absolute target dirs based on the scope flag.
 *
 * - home → ~/.claude/skills/    (default; user-wide)
 * - project → <cwd>/.claude/skills/  (team-commit pattern; the skill
 *   dir gets committed to the repo so contributors don't each have
 *   to bootstrap)
 * - both → both of the above
 */
function resolveTargets({ scope, homeDir, cwd }) {
  const out = [];
  if (scope === 'home' || scope === 'both') {
    if (homeDir) out.push(join(homeDir, '.claude', 'skills'));
  }
  if (scope === 'project' || scope === 'both') {
    if (cwd) out.push(join(cwd, '.claude', 'skills'));
  }
  return out;
}

/**
 * Attempt to symlink one skill. Possible outcomes:
 *   - linked          — fresh symlink created (or dry-run no-op)
 *   - already-linked  — symlink already points to the right source
 *   - refused         — target exists and isn't ours; need --force
 *   - replaced        — target was a wrong-source link or (under
 *                       --force) a real dir; removed + re-linked
 *   - error           — fs op failed; result.error has the message
 *
 * @returns {{status: 'linked'|'already-linked'|'refused'|'replaced'|'error', error?: string}}
 */
function linkOne({ src, dst, force, dryRun }) {
  if (existsSync(dst) || lstatSafe(dst)) {
    const stat = lstatSafe(dst);
    if (stat?.isSymbolicLink()) {
      try {
        const current = readlinkSync(dst);
        if (resolve(dirname(dst), current) === src) {
          return { status: 'already-linked' };
        }
        // Wrong-source symlink → safe to replace (it's already a link, not user content).
        // Use unlinkSync rather than rmSync — rmSync on a symlink-to-dir follows
        // the link on macOS and tries to delete the target dir, failing with
        // "Path is a directory".
        if (!dryRun) {
          unlinkSync(dst);
          symlinkSync(src, dst);
        }
        return { status: 'linked' };
      } catch (err) {
        return { status: 'error', error: err.message };
      }
    }
    // Real directory or file at the target.
    if (!force) {
      return { status: 'refused' };
    }
    // --force: replace.
    try {
      if (!dryRun) {
        rmSync(dst, { recursive: true, force: true });
        symlinkSync(src, dst);
      }
      return { status: 'linked' };
    } catch (err) {
      return { status: 'error', error: err.message };
    }
  }
  // Nothing at target → fresh link.
  try {
    if (!dryRun) symlinkSync(src, dst);
    return { status: 'linked' };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

function lstatSafe(path) {
  try { return lstatSync(path); } catch { return null; }
}
