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

  // Update mode: re-run the chain against an existing install. Reads
  // recorded answers from install-state.json, lets CLI flags override
  // (e.g. swap profile, change --ecc-scope), then runs the chain. The
  // upstream dispatchers + mcp.js are already idempotent (skip when
  // already-installed), so --update is mostly about computing the
  // delta + force-rewriting flow.config.yaml.
  if (args.update) {
    return runUpdate({ catalog, cwd, args });
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

/**
 * Update mode: re-run the install chain against an existing install,
 * with CLI flags taking precedence over recorded answers. The chain
 * itself is idempotent (upstream dispatchers + mcp.js skip on already-
 * installed state), so most of this function is about loading the prior
 * state, computing the delta, and force-rewriting flow.config.yaml so
 * the on-disk config reflects whatever changed.
 *
 * Behavior:
 *   - No install-state.json → exit 1 (nothing to update from; hint
 *     toward `flow init --yes` for a fresh install).
 *   - install_scope change (user → project or vice-versa) → exit 1
 *     with hint. Scope swaps need uninstall + reinstall because the
 *     filesystem layout is fundamentally different; mid-flight swap
 *     would leave stale content at the old scope's location.
 *   - Otherwise: run the chain with the new resolved answers + force=true
 *     on scaffold. Emit a delta summary at the end.
 */
async function runUpdate({ catalog, cwd, args }) {
  const statePath = join(cwd, '.claude', 'flow', 'install-state.json');
  if (!existsSync(statePath)) {
    console.error(chalk.red('✗ flow init --update: no .claude/flow/install-state.json found'));
    console.error(chalk.dim('  Update needs a prior install to read from.'));
    console.error(chalk.dim('  Run `flow init --profile <name> --yes` to do a fresh install.'));
    return 1;
  }

  let state;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch (err) {
    console.error(chalk.red(`✗ flow init --update: failed to parse install-state.json: ${err.message}`));
    return 2;
  }
  if (!state.profile || !state.answers) {
    console.error(chalk.red('✗ flow init --update: install-state.json missing required profile/answers fields'));
    return 2;
  }

  const prevProfile = state.profile;
  const prevAnswers = state.answers;
  const dryRun = Boolean(args['dry-run']);

  // Apply CLI overrides on top of recorded answers. We DON'T re-derive
  // from defaultAnswersForProfile because the user may have customized
  // individual adapter / subset values via --with / --without at install
  // time and we shouldn't blow those away.
  const newProfileName = args.profile || prevProfile;
  const newAnswers = { ...prevAnswers, profile: newProfileName };
  if (args['ecc-scope']) newAnswers.eccScope = args['ecc-scope'];
  if (args['bmad-subset']) newAnswers.bmadSubset = args['bmad-subset'];
  if (args['ecc-subset']) newAnswers.eccSubset = args['ecc-subset'];

  // If the profile changed, re-derive adapter/subset defaults from the
  // new profile UNLESS the user explicitly overrode them. This is the
  // "swap profile" use case (e.g. mini → team) where the user expects
  // team's adapters + subsets to take effect.
  if (newProfileName !== prevProfile) {
    const newDefaults = defaultAnswersForProfile(catalog, newProfileName);
    for (const key of ['issueTracker', 'pr', 'e2e', 'verify', 'bmadSubset', 'eccSubset', 'eccScope', 'cavemanSubset']) {
      // Only update if the user didn't already pin it via CLI override above.
      const cliKey = ({
        eccScope: 'ecc-scope', bmadSubset: 'bmad-subset', eccSubset: 'ecc-subset',
      })[key];
      if (cliKey && args[cliKey]) continue;
      newAnswers[key] = newDefaults[key];
    }
  }

  // Hard halt on install_scope change — too destructive to do mid-flight.
  if (prevAnswers.eccScope && newAnswers.eccScope !== prevAnswers.eccScope) {
    console.error(chalk.red(`✗ flow init --update: install_scope change (${prevAnswers.eccScope} → ${newAnswers.eccScope}) is not supported mid-flight`));
    console.error(chalk.dim('  Scope swaps need uninstall + reinstall to avoid stale content at the old location.'));
    console.error(chalk.dim('  Suggested:'));
    console.error(chalk.dim(`    flow uninstall --execute --yes${prevAnswers.eccScope === 'project' ? ' --remove-project-ecc' : ''}`));
    console.error(chalk.dim(`    flow init --profile ${newProfileName} --ecc-scope ${newAnswers.eccScope} --yes`));
    return 1;
  }

  // Compute + show the delta before running anything.
  const deltas = computeDeltas(prevAnswers, newAnswers);

  console.log(chalk.bold('━━━ flow init (update) ━━━'));
  console.log(chalk.dim(`  was: profile=${prevProfile}  →  now: profile=${newProfileName}  cwd=${cwd}  dry-run=${dryRun}`));
  console.log();
  if (deltas.length === 0) {
    console.log(chalk.green('✓ No changes — install matches the requested state.'));
    console.log(chalk.dim('  (Re-run with --force to refresh flow.config.yaml anyway.)'));
    if (!args.force) return 0;
  } else {
    console.log(chalk.bold('Changes:'));
    for (const d of deltas) console.log(`  ${chalk.yellow('Δ')} ${d.key}: ${chalk.dim(`${formatVal(d.from)} → ${formatVal(d.to)}`)}`);
    console.log();
  }

  const result = await runInit({
    cwd,
    catalog,
    flowVersion: readFlowVersion(),
    cliAnswers: newAnswers,
    dryRun,
    // Force scaffold rewrite so flow.config.yaml picks up the new answers.
    // Without this, the existing flow.config.yaml would be preserved and
    // the on-disk config would drift from install-state.json.
    force: true,
    continueOnUpstreamError: Boolean(args['continue-on-error']),
  });

  if (!result.ok) {
    console.error(chalk.red(`✗ update halted: ${result.haltReason}`));
    return 1;
  }

  console.log(chalk.green('✓ flow init --update complete'));
  if (dryRun) console.log(chalk.yellow('  (--dry-run: nothing was actually written)'));
  return 0;
}

/**
 * Compute a flat list of {key, from, to} deltas between two answer sets.
 * Used by --update to surface what changed before running the chain.
 *
 * @param {Object} prev
 * @param {Object} next
 * @returns {Array<{key: string, from: any, to: any}>}
 */
function computeDeltas(prev, next) {
  const out = [];
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    if (prev[key] !== next[key]) {
      out.push({ key, from: prev[key], to: next[key] });
    }
  }
  return out;
}

function formatVal(v) {
  if (v == null) return '∅';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}
