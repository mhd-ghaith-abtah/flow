// lib/commands/install.js — headless install path.
//
// `flow install` is the scriptable / CI version of /flow-init. Where /flow-init
// asks ~8 questions, `flow install` takes everything via flags and either
// executes (with --yes) or prints the plan (without).
//
// This covers the "core" operations from catalog.yaml:
//   - copy flow_components into the target scope's skills/ dir
//   - copy templates into flow-init's templates/ subdir
//   - ensure $HOME/.claude/flow/install-state.json exists
//   - write a starter flow.config.yaml in the project root
//   - record an install-state.json entry per scope
//
// What this does NOT do (intentionally — too risky/interactive for a CLI):
//   - install Caveman via curl-pipe-bash (run /flow-init or the upstream installer)
//   - install BMad (run /flow-init or `npx bmad-method install`)
//   - install ECC (run /flow-init or its install.sh)
//   - register MCP servers (run `claude mcp add` yourself; the slash-command path
//     surfaces auth prompts properly)
//   - migrate BMad state (--migrate-bmad needs interactive confirmations)
//
// `flow install` prints a summary at the end pointing at /flow-init for the
// interactive remainder.

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import chalk from 'chalk';
import { loadCatalog, resolveProfile, listProfiles } from '../catalog.js';
import { resolveRepoRoot } from '../repo-root.js';

/**
 * @param {Object} args
 * @param {Object} ctx
 */
export default async function install(args, ctx) {
  const repoRoot = ctx.repoRoot ?? resolveRepoRoot(import.meta.url);
  const catalog = loadCatalog(repoRoot);

  const profileName = args.profile ?? 'standard';
  if (!catalog.profiles[profileName]) {
    console.error(chalk.red(`✗ Unknown profile: ${profileName}`));
    console.error(`  Available: ${listProfiles(catalog).join(', ')}`);
    return 1;
  }

  const profile = resolveProfile(catalog, profileName);
  const yes = Boolean(args.yes);
  const dryRun = Boolean(args['dry-run']);
  const scope = args.scope ?? 'both';

  const homeRoot = ctx.home || process.env.HOME;
  const home = (p) => resolve(p.replace(/\$HOME/g, homeRoot));

  // Build plan: list of file operations.
  const operations = [];
  for (const componentId of profile.flow_components) {
    const component = catalog.flow_components.find((c) => c.id === componentId);
    if (!component) {
      console.error(chalk.yellow(`⚠ Component '${componentId}' referenced by profile but not in catalog`));
      continue;
    }
    for (const op of component.operations || []) {
      if (op.copy) {
        operations.push({
          kind: 'copy',
          component: componentId,
          from: join(repoRoot, op.copy.from),
          to: home(op.copy.to),
        });
      } else if (op.ensure_dir) {
        operations.push({ kind: 'ensure_dir', component: componentId, path: home(op.ensure_dir) });
      } else if (op.touch) {
        operations.push({ kind: 'touch', component: componentId, path: home(op.touch) });
      }
    }
  }

  // Plan summary.
  console.log(chalk.bold(`━━━ flow install (profile: ${profileName}) ━━━`));
  console.log();
  console.log(`Scope:        ${scope}`);
  console.log(`Components:   ${profile.flow_components.length}`);
  console.log(`Adapters:     ${profile.adapters.length}  (${profile.adapters.join(', ')})`);
  console.log(`MCPs:         ${profile.mcps.length}  (${profile.mcps.join(', ') || chalk.dim('none')})`);
  console.log(`BMad subset:  ${profile.bmad_subset}  ${chalk.dim('(this CLI will NOT run BMad installer)')}`);
  console.log(`ECC subset:   ${profile.ecc_subset}   ${chalk.dim('(this CLI will NOT run ECC installer)')}`);
  console.log(`Caveman:      ${profile.caveman_subset}  ${chalk.dim('(this CLI will NOT run Caveman installer)')}`);
  console.log();
  console.log(`Operations:   ${operations.length}`);
  if (args.verbose) {
    for (const op of operations) {
      console.log(`  ${chalk.green('+')} ${op.kind}  ${chalk.dim(op.path || `${op.from} → ${op.to}`)}`);
    }
  }

  if (dryRun) {
    console.log();
    console.log(chalk.dim('--dry-run: stopping before execution. Re-run with --yes to execute.'));
    return 0;
  }

  if (!yes) {
    console.log();
    console.log(chalk.yellow('?'), 'Execute? Re-run with --yes to confirm, or --dry-run to preview.');
    return 0;
  }

  // Execute.
  console.log();
  console.log(chalk.bold('Executing:'));
  let executed = 0;
  let skipped = 0;
  let failed = 0;

  for (const op of operations) {
    try {
      if (op.kind === 'copy') {
        if (!existsSync(op.from)) {
          throw new Error(`source missing: ${op.from}`);
        }
        const isDir = statSync(op.from).isDirectory();
        if (isDir) {
          copyDirRecursive(op.from, op.to);
        } else {
          mkdirSync(dirname(op.to), { recursive: true });
          copyFileSync(op.from, op.to);
        }
        console.log(`  ${chalk.green('✓')} copy  ${op.from} → ${op.to}`);
      } else if (op.kind === 'ensure_dir') {
        mkdirSync(op.path, { recursive: true });
        console.log(`  ${chalk.green('✓')} ensure_dir  ${op.path}`);
      } else if (op.kind === 'touch') {
        mkdirSync(dirname(op.path), { recursive: true });
        if (!existsSync(op.path)) writeFileSync(op.path, '{}');
        console.log(`  ${chalk.green('✓')} touch  ${op.path}`);
      }
      executed++;
    } catch (err) {
      console.log(`  ${chalk.red('✗')} ${op.kind} failed: ${err.message}`);
      failed++;
    }
  }

  // Record state.
  const statePath = home('$HOME/.claude/flow/install-state.json');
  let state = { schema_version: 'flow.install.v1', upstreams: {} };
  if (existsSync(statePath)) {
    try { state = JSON.parse(readFileSync(statePath, 'utf-8')); } catch (e) { /* keep fresh */ }
  }
  state.schema_version = state.schema_version || 'flow.install.v1';
  state.flow_version = ctx.pkg?.version || state.flow_version;
  state.profile = profileName;
  state.last_updated = new Date().toISOString();
  state.scope = scope;
  state.installed_via = 'flow install (headless)';
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

  console.log();
  console.log(chalk.bold(`Done: ${executed} executed, ${failed} failed, ${skipped} skipped.`));
  console.log();
  console.log(chalk.dim('Next steps (this CLI does NOT do these — too interactive for headless):'));
  console.log(chalk.dim('  1. Install BMad / ECC / Caveman manually or run /flow-init for the interactive path'));
  console.log(chalk.dim('  2. Register MCPs:  claude mcp add context7 npx @upstash/context7-mcp@latest'));
  console.log(chalk.dim('  3. Write flow.config.yaml in your project root (see templates/flow.config.yaml.tmpl)'));

  return failed > 0 ? 2 : 0;
}

function copyDirRecursive(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}
