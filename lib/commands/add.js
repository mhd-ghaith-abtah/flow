// lib/commands/add.js — `flow add <component-id>` adds a single component.
//
// Most useful for adapter swaps: `flow add adapter:e2e-playwright-mcp` to
// install the Playwright E2E adapter alongside the existing setup. Updates
// flow.config.yaml's adapters block too — picking the new adapter as active
// for its family (replacing the previous one for that family).
//
// Refuses without --yes. Refuses if catalog has no such component.

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import chalk from 'chalk';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { loadCatalog } from '../catalog.js';
import { resolveRepoRoot } from '../repo-root.js';

export default async function add(args, ctx) {
  const repoRoot = ctx.repoRoot ?? resolveRepoRoot(import.meta.url);
  const catalog = loadCatalog(repoRoot);
  const yes = Boolean(args.yes);
  const dryRun = Boolean(args['dry-run']);

  // The component id is the first positional. bin/flow.js strips `add` from
  // argv before passing to yargs-parser, so args._[0] is the component id.
  const componentId = args._?.[0];
  if (!componentId) {
    console.error(chalk.red('✗ Missing component id. Example: flow add adapter:e2e-playwright-mcp'));
    return 1;
  }

  // Find it in the catalog. Could be in flow_components or adapters.
  const adapter = catalog.adapters?.find((a) => a.id === componentId);
  const component = catalog.flow_components?.find((c) => c.id === componentId);
  const item = adapter || component;
  if (!item) {
    console.error(chalk.red(`✗ Unknown component: ${componentId}`));
    console.error(`  Available adapters: ${catalog.adapters?.map((a) => a.id).join(', ') || '(none)'}`);
    return 1;
  }

  const homeRoot = ctx.home || process.env.HOME;
  const home = (p) => resolve(p.replace(/\$HOME/g, homeRoot));

  console.log(chalk.bold(`━━━ flow add ${componentId} ━━━`));
  console.log();
  console.log(`Description: ${item.description}`);
  if (adapter) {
    console.log(`Family:      ${adapter.family}`);
    if (adapter.needs_mcp?.length) console.log(`Needs MCPs:  ${adapter.needs_mcp.join(', ')}`);
    if (adapter.needs_cli?.length) console.log(`Needs CLIs:  ${adapter.needs_cli.join(', ')}`);
  }
  console.log();

  const operations = [];
  for (const op of item.operations || []) {
    if (op.copy) {
      operations.push({
        kind: 'copy',
        from: join(repoRoot, op.copy.from),
        to: home(op.copy.to),
      });
    }
  }

  console.log(chalk.bold('Operations:'));
  for (const op of operations) {
    console.log(`  ${chalk.green('+')} ${op.kind}  ${chalk.dim(`${op.from} → ${op.to}`)}`);
  }
  console.log();

  if (dryRun) {
    console.log(chalk.dim('--dry-run: stopping before execution.'));
    return 0;
  }

  if (!yes) {
    console.log(chalk.yellow('?'), 'Re-run with --yes to execute.');
    return 0;
  }

  // Execute file ops.
  let executed = 0;
  for (const op of operations) {
    try {
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
      console.log(`  ${chalk.green('✓')} copy  ${op.to}`);
      executed++;
    } catch (err) {
      console.error(`  ${chalk.red('✗')} ${op.kind} failed: ${err.message}`);
      return 2;
    }
  }

  // If it's an adapter, update flow.config.yaml's adapters block.
  if (adapter) {
    const configPath = join(ctx.cwd, 'flow.config.yaml');
    if (existsSync(configPath)) {
      const config = parseYaml(readFileSync(configPath, 'utf-8')) || {};
      config.adapters = config.adapters || {};
      // The family in catalog is hyphenated (e.g. "issue-tracker"); the config
      // key is snake_case (e.g. "issue_tracker"). Normalize.
      const configKey = adapter.family.replace(/-/g, '_');
      // Strip "adapter:" prefix and the family prefix to get the short id.
      // e.g. "adapter:issue-tracker-linear" → "linear"
      const shortId = adapter.id.replace(`adapter:${adapter.family}-`, '');
      const previous = config.adapters[configKey];
      config.adapters[configKey] = shortId;
      writeFileSync(configPath, stringifyYaml(config));
      console.log();
      if (previous && previous !== shortId) {
        console.log(`  ${chalk.cyan('↻')} flow.config.yaml: adapters.${configKey} ${previous} → ${shortId}`);
      } else {
        console.log(`  ${chalk.cyan('+')} flow.config.yaml: adapters.${configKey} = ${shortId}`);
      }
    } else {
      console.log();
      console.log(chalk.yellow('⚠'), `No flow.config.yaml in ${ctx.cwd}. Add this manually:`);
      console.log(`    adapters.${adapter.family.replace(/-/g, '_')}: ${adapter.id.replace(`adapter:${adapter.family}-`, '')}`);
    }
  }

  console.log();
  console.log(chalk.bold(`Done: ${executed} operations executed.`));
  return 0;
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
