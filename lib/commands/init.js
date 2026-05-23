// lib/commands/init.js — `flow init` entry point.
//
// Two paths:
//
//   1. **Interactive (default inside Claude Code):** the rich Q&A lives
//      in skills/flow-init/workflow.md. The CLI just prints the
//      slash-command nudge so the user runs /flow-init in-session
//      where the LLM can drive the prompts, error recovery, and
//      multi-step ceremony.
//
//   2. **Headless (--yes outside Claude Code, npx-first):** chain
//      detect → questions (pre-populated) → upstream dispatch → MCP
//      registration → optional BMad migration → scaffold the project
//      via lib/init/orchestrate.js. This is the v0.8 npx-first install
//      path. Tests + CI scripts hit this branch.
//
// --dry-run shows the plan + halts before any execution in either path.

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { execa } from 'execa';
import { loadCatalog } from '../catalog.js';
import { resolveRepoRoot } from '../repo-root.js';
import plan from './plan.js';
import { runInit, defaultAnswersForProfile } from '../init/orchestrate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_PATH = resolve(__dirname, '..', '..', 'package.json');

function readFlowVersion() {
  try { return JSON.parse(readFileSync(PKG_PATH, 'utf8')).version; }
  catch { return 'unknown'; }
}

/**
 * @param {Object} args
 * @param {Object} ctx
 */
export default async function init(args, ctx) {
  const repoRoot = ctx.repoRoot ?? resolveRepoRoot(import.meta.url);
  const catalog = loadCatalog(repoRoot);
  const profileName = args.profile ?? 'standard';
  const yes = Boolean(args.yes);
  const dryRun = Boolean(args['dry-run']);
  const cwd = ctx.cwd || process.cwd();

  // Repair mode: skip everything except scaffold. Useful when the user
  // accidentally deleted docs/flow/sprint.yaml or .claude/flow.config.yaml
  // and wants Flow to put them back without re-running upstream installers
  // (which would re-fetch BMad/ECC/Caveman from network for no reason).
  if (args.repair) {
    return runRepair({ catalog, cwd, args });
  }

  // Always show the plan first.
  console.log(chalk.dim(`Resolving plan for profile '${profileName}'…`));
  console.log();
  await plan({ ...args, profile: profileName }, ctx);
  console.log();

  if (dryRun && !yes) {
    // dry-run without --yes is plan-only.
    console.log(chalk.dim('(--dry-run: stopping before execution)'));
    return 0;
  }

  // Headless path: --yes (or --yes + --dry-run for the integration-test path).
  if (yes) {
    return runHeadless({ catalog, cwd, profileName, args, dryRun });
  }

  // Interactive path inside Claude Code: nudge to slash command.
  if (ctx.insideClaudeCode) {
    console.log(chalk.bold('Inside Claude Code — run the slash command:'));
    console.log(`  ${chalk.cyan('/flow-init')}${profileName !== 'standard' ? ` --profile ${profileName}` : ''}`);
    return 0;
  }

  // Outside Claude Code, no --yes: show both paths.
  console.log(chalk.bold('Choose an installation path:'));
  console.log();
  console.log(`  ${chalk.cyan('flow init --profile ' + profileName + ' --yes')}    # headless install (this CLI)`);
  console.log(`  ${chalk.cyan('claude')} → ${chalk.cyan('/flow-init')}                          # interactive install (Claude Code)`);
  console.log();
  console.log(chalk.dim('Re-run with --dry-run for a preview, or --yes to install headlessly.'));
  return 0;
}

/**
 * Run the orchestrator end-to-end with pre-populated answers from the
 * resolved profile + CLI overrides.
 */
async function runHeadless({ catalog, cwd, profileName, args, dryRun }) {
  // Pre-populate every Q&A slot from the profile defaults so askAll()
  // never fires an interactive prompt. Honor --ecc-scope override.
  const overrides = {};
  if (args['ecc-scope']) overrides.eccScope = args['ecc-scope'];
  if (args['bmad-subset']) overrides.bmadSubset = args['bmad-subset'];
  if (args['ecc-subset']) overrides.eccSubset = args['ecc-subset'];
  const cliAnswers = defaultAnswersForProfile(catalog, profileName, overrides);

  console.log(chalk.bold('━━━ flow init (headless) ━━━'));
  console.log(chalk.dim(`  profile=${profileName}  cwd=${cwd}  dry-run=${dryRun}`));
  console.log();

  const result = await runInit({
    cwd,
    catalog,
    flowVersion: readFlowVersion(),
    cliAnswers,
    dryRun,
    force: Boolean(args.force),
    continueOnUpstreamError: Boolean(args['continue-on-error']),
  });

  if (!result.ok) {
    console.error(chalk.red(`✗ init halted: ${result.haltReason}`));
    for (const [name, r] of Object.entries(result.upstreamResults)) {
      if (r && !r.ok && r.error) console.error(chalk.dim(`  ${name}: ${r.error}`));
    }
    return 1;
  }

  // Render the manifest.
  console.log(chalk.bold('Upstream installers:'));
  for (const [name, r] of Object.entries(result.upstreamResults)) {
    const tag = r.stateRecord?.skipped ? chalk.dim('skipped') : (r.ok ? chalk.green('✓') : chalk.red('✗'));
    console.log(`  ${name}:  ${tag}  ${chalk.dim(r.command?.source || '')}`);
  }
  console.log();
  if (result.mcpResults.length > 0) {
    console.log(chalk.bold('MCPs:'));
    for (const m of result.mcpResults) {
      const tag = m.stateRecord?.skipped ? chalk.dim('already-registered') : (m.ok ? chalk.green('✓') : chalk.red('✗'));
      console.log(`  ${m.id}:  ${tag}`);
    }
    console.log();
  }
  if (result.secretsResult && result.secretsResult.store !== 'skipped') {
    console.log(chalk.bold('Secrets:'));
    if (result.secretsResult.ok) {
      const tag = result.secretsResult.store === 'env-file' ? chalk.green('✓') : chalk.dim('printed');
      const where = result.secretsResult.path
        ? chalk.dim(` → ${result.secretsResult.path}`)
        : chalk.dim(` (${result.secretsResult.store} — copy lines above)`);
      console.log(`  ${tag} ${result.secretsResult.envVarsWritten.length} var(s) for ${result.secretsResult.mcpsCovered.join(', ')}${where}`);
    } else {
      console.log(`  ${chalk.red('✗')} ${result.secretsResult.error}`);
    }
    console.log();
  }
  if (result.migrationResult) {
    console.log(chalk.bold('BMad migration:'));
    console.log(`  ${chalk.green('✓')}  ${result.migrationResult.storiesImported} stories, ${result.migrationResult.epicsImported} epics`);
    console.log();
  }
  console.log(chalk.bold('Files:'));
  for (const p of result.scaffoldManifest.written) console.log(`  ${chalk.green('+')} ${p}`);
  for (const p of result.scaffoldManifest.skipped) console.log(`  ${chalk.dim('=')} ${p} ${chalk.dim('(exists; use --force to overwrite)')}`);
  console.log();
  console.log(chalk.green('✓ flow init complete'));
  if (dryRun) console.log(chalk.yellow('  (--dry-run: nothing was actually written)'));
  return 0;
}

/**
 * Repair mode: recreate missing project-scope scaffold files
 * (.claude/flow.config.yaml, docs/flow/sprint.yaml, deferred.md,
 * .claude/flow/install-state.json) without re-running upstream
 * installers or MCPs. Reads the profile + answers from the existing
 * install-state.json so the regenerated config matches what the user
 * picked at install time.
 *
 * Refuses to run if no install-state.json exists — there's nothing
 * authoritative to repair from. User should run `flow init --yes`
 * instead.
 */
async function runRepair({ catalog, cwd, args }) {
  const statePath = join(cwd, '.claude', 'flow', 'install-state.json');
  if (!existsSync(statePath)) {
    console.error(chalk.red('✗ flow init --repair: no .claude/flow/install-state.json found'));
    console.error(chalk.dim('  Repair needs a prior install to read profile + answers from.'));
    console.error(chalk.dim('  Run `flow init --profile <name> --yes` to do a fresh install instead.'));
    return 1;
  }

  let state;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch (err) {
    console.error(chalk.red(`✗ flow init --repair: failed to parse install-state.json: ${err.message}`));
    return 2;
  }
  if (!state.profile || !state.answers) {
    console.error(chalk.red('✗ flow init --repair: install-state.json missing required profile/answers fields'));
    return 2;
  }

  const profileName = state.profile;
  const answers = state.answers;
  const dryRun = Boolean(args['dry-run']);

  console.log(chalk.bold('━━━ flow init (repair) ━━━'));
  console.log(chalk.dim(`  profile=${profileName}  cwd=${cwd}  dry-run=${dryRun}`));
  console.log();

  // Import scaffold lazily so the regular init path doesn't pay for it.
  const { scaffold } = await import('../init/scaffold.js');
  const { resolveProfile } = await import('../catalog.js');
  const resolved = resolveProfile(catalog, profileName);

  const manifest = scaffold({
    cwd,
    profile: profileName,
    answers,
    resolvedProfile: resolved,
    catalog,
    flowVersion: readFlowVersion(),
    upstreamResults: state.upstreams || {},
    migrationResult: state.migration || null,
  }, { dryRun, force: false });

  if (manifest.written.length === 0 && manifest.skipped.length > 0 && manifest.dirs.length === 0) {
    console.log(chalk.green('✓ Nothing to repair — all scaffold files already present.'));
    return 0;
  }

  console.log(chalk.bold('Files:'));
  for (const p of manifest.written) console.log(`  ${chalk.green('+')} ${p} ${chalk.dim('(recreated)')}`);
  for (const p of manifest.skipped) console.log(`  ${chalk.dim('=')} ${p} ${chalk.dim('(present, untouched)')}`);
  if (manifest.dirs.length > 0) {
    for (const d of manifest.dirs) console.log(`  ${chalk.green('+')} ${d}/ ${chalk.dim('(directory created)')}`);
  }
  console.log();
  console.log(chalk.green('✓ flow init --repair complete'));
  if (dryRun) console.log(chalk.yellow('  (--dry-run: nothing was actually written)'));
  return 0;
}
