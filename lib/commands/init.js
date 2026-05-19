// lib/commands/init.js — `flow init` headless entry point.
//
// v0.7 scope: the *interactive* installer lives in skills/flow-init/workflow.md
// (Claude Code reads the workflow and runs it). The headless `flow init` CLI
// path is intentionally thin — it prints the plan, then either:
//   • dispatches to `claude` CLI to run /flow-init (if `claude` is in $PATH), or
//   • prints clear instructions for running /flow-init manually.
//
// Why thin: porting the full interactive workflow to Node duplicates ~800 LOC
// of decision logic already in workflow.md. Better to have one source of truth.

import chalk from 'chalk';
import { execa } from 'execa';
import { loadCatalog, resolveProfile } from '../catalog.js';
import { resolveRepoRoot } from '../repo-root.js';
import plan from './plan.js';

/**
 * @param {Object} args
 * @param {Object} ctx
 */
export default async function init(args, ctx) {
  const repoRoot = ctx.repoRoot ?? resolveRepoRoot(import.meta.url);
  loadCatalog(repoRoot);  // validate parseable; throws on bad catalog

  const profileName = args.profile ?? 'standard';
  const yes = Boolean(args.yes);
  const dryRun = Boolean(args['dry-run']);

  // Always show the plan first.
  console.log(chalk.dim(`Resolving plan for profile '${profileName}'…`));
  console.log();
  await plan({ ...args, profile: profileName }, ctx);
  console.log();

  if (dryRun) {
    console.log(chalk.dim('(--dry-run: stopping before execution)'));
    return 0;
  }

  // Inside Claude Code: just tell the user to run /flow-init. Don't fork.
  if (ctx.insideClaudeCode) {
    console.log(chalk.bold('Inside Claude Code — run the slash command:'));
    console.log(`  ${chalk.cyan('/flow-init')}${profileName !== 'standard' ? ` --profile ${profileName}` : ''}`);
    return 0;
  }

  // Outside Claude Code: try to dispatch to `claude` CLI.
  if (!yes) {
    console.log(chalk.yellow('?'), `Run the interactive installer via the \`claude\` CLI? [y/N]`);
    console.log(chalk.dim('  (Re-run with --yes to skip this prompt, or use --dry-run to preview only.)'));
    return 0;  // Non-interactive default: stop. CI scripts use --yes.
  }

  const claudeAvailable = await hasClaudeCli();
  if (!claudeAvailable) {
    console.error(chalk.yellow('⚠'), 'The `claude` CLI is not on $PATH.');
    console.error('  Install Claude Code (https://claude.com/claude-code), then:');
    console.error(`    ${chalk.cyan('claude')}    # start a session`);
    console.error(`    ${chalk.cyan('/flow-init')}  # inside the session`);
    return 2;
  }

  // Dispatch: open `claude` with /flow-init prefilled.
  console.log(chalk.dim('Dispatching to `claude` CLI…'));
  try {
    await execa('claude', ['/flow-init', ...(profileName !== 'standard' ? ['--profile', profileName] : [])], {
      stdio: 'inherit',
      env: { ...process.env, FLOW_REPO_ROOT: repoRoot }
    });
    return 0;
  } catch (err) {
    if (err.exitCode != null) return err.exitCode;
    console.error(chalk.red(`✗ Failed to launch claude: ${err.message}`));
    return 1;
  }
}

async function hasClaudeCli() {
  try {
    await execa('which', ['claude']);
    return true;
  } catch {
    return false;
  }
}
