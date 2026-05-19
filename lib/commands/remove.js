// lib/commands/remove.js — `flow remove <component-id>` removes an adapter.
//
// Counterpart to `flow add`. For adapters, sets the family back to the `none`
// variant (which keeps Flow's flow-story phase decision happy — it expects
// SOME adapter per family). Does NOT remove the adapter file from disk (other
// projects might still use it via the home-scope install).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import chalk from 'chalk';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { loadCatalog } from '../catalog.js';
import { resolveRepoRoot } from '../repo-root.js';

export default async function remove(args, ctx) {
  const repoRoot = ctx.repoRoot ?? resolveRepoRoot(import.meta.url);
  const catalog = loadCatalog(repoRoot);
  const yes = Boolean(args.yes);
  const dryRun = Boolean(args['dry-run']);

  const componentId = args._?.[0];
  if (!componentId) {
    console.error(chalk.red('✗ Missing component id. Example: flow remove adapter:e2e-playwright-mcp'));
    return 1;
  }

  const adapter = catalog.adapters?.find((a) => a.id === componentId);
  if (!adapter) {
    console.error(chalk.red(`✗ Unknown adapter (or not an adapter — only adapters are removable via this command): ${componentId}`));
    return 1;
  }

  // Find the "none" sibling for the same family.
  const noneId = `adapter:${adapter.family}-none`;
  const noneExists = catalog.adapters?.some((a) => a.id === noneId);
  if (!noneExists) {
    console.error(chalk.red(`✗ No '${noneId}' fallback in catalog. Refusing to remove without a fallback.`));
    return 1;
  }

  console.log(chalk.bold(`━━━ flow remove ${componentId} ━━━`));
  console.log();
  console.log(`Family:    ${adapter.family}`);
  console.log(`Fallback:  ${noneId}  (flow-story expects SOME adapter per family)`);
  console.log();

  const configPath = join(ctx.cwd, 'flow.config.yaml');
  if (!existsSync(configPath)) {
    console.error(chalk.yellow('⚠'), `No flow.config.yaml in ${ctx.cwd}. Nothing to update.`);
    return 0;
  }

  const config = parseYaml(readFileSync(configPath, 'utf-8')) || {};
  config.adapters = config.adapters || {};
  const configKey = adapter.family.replace(/-/g, '_');
  const currentShort = config.adapters[configKey];
  const shortIdOfThis = adapter.id.replace(`adapter:${adapter.family}-`, '');

  if (currentShort !== shortIdOfThis) {
    console.log(chalk.yellow('ℹ'), `flow.config.yaml.adapters.${configKey} is '${currentShort}', not '${shortIdOfThis}'.`);
    console.log(chalk.dim('  Nothing to remove.'));
    return 0;
  }

  console.log(`Would set flow.config.yaml.adapters.${configKey}: ${shortIdOfThis} → none`);

  if (dryRun) {
    console.log();
    console.log(chalk.dim('--dry-run: stopping before write.'));
    return 0;
  }

  if (!yes) {
    console.log();
    console.log(chalk.yellow('?'), 'Re-run with --yes to confirm.');
    return 0;
  }

  config.adapters[configKey] = 'none';
  writeFileSync(configPath, stringifyYaml(config));
  console.log();
  console.log(`  ${chalk.cyan('↻')} flow.config.yaml: adapters.${configKey} ${shortIdOfThis} → none`);
  console.log();
  console.log(chalk.dim(`Note: ${adapter.id}'s files at ~/.claude/skills/flow-story/adapters/${adapter.family}/`));
  console.log(chalk.dim(`were NOT removed — other projects may still use them. Re-add with: flow add ${adapter.id}`));
  return 0;
}
