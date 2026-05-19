#!/usr/bin/env node
// Flow CLI entry — dispatches to lib/commands/<cmd>.js
//
// Detects whether we're running inside a Claude Code session (CLAUDECODE=1 env)
// or from a terminal. The slash-command path uses the same lib/ functions; this
// binary is the headless / scriptable / CI path.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import yargsParser from 'yargs-parser';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const PKG = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf-8'));

const USAGE = `${chalk.bold('flow')} — ${PKG.description}

${chalk.bold('Usage:')}
  flow <command> [options]

${chalk.bold('Commands:')}
  init                          Interactive first-time setup (same as /flow-init in Claude Code)
  install                       Non-interactive install with flags
  plan                          Dry-run: show the resolved install plan
  status                        What's installed where
  doctor [--mcp <id>]           Health check
  add <component-id>            Add a single component
  remove <component-id>         Remove a single component
  uninstall                     Remove Flow from this project (or --scope home for global)
  list-profiles                 List available profiles
  list-components [--family X]  List available components
  list-mcps                     List MCP servers Flow tracks
  mcp <add|remove|reauth> ...   Manage MCP servers
  adapter <swap|list> ...       Manage active adapters
  help [command]                Show help

${chalk.bold('Common flags:')}
  --profile <name>              mini | standard | team | minimal | full
  --bmad-subset <name>          none | planning-only | planning-plus-research | creative-thinking | test-architecture | full | passthrough
  --ecc-subset <name>           none | flow-essentials | flow-essentials-plus-tdd | security-heavy | research-heavy | use-ecc-default | passthrough
  --with <component>            Add a component on top of the profile
  --without <component>         Remove a component from the profile
  --scope home|project|both     Install scope (default: both)
  --dry-run                     Print the plan, don't execute
  --json                        Machine-readable output
  --yes                         Skip prompts (for CI)
  --catalog-source <url|path>   Use an alternate catalog (advanced)

${chalk.bold('Examples:')}
  flow init                                        # interactive
  flow install --profile standard --yes            # scripted
  flow install --profile mini --with adapter:e2e-playwright-mcp --yes
  flow plan --profile team --json
  flow status
  flow doctor
  flow uninstall --scope project

${chalk.bold('Inside Claude Code (slash commands — hyphenated):')}
  /flow-init                                  first-time setup (interactive)
  /flow-sprint <subcommand> [args]            add | next | status | done | retro | ...
  /flow-story [story-id]                      advance the active story

Version ${PKG.version} · ${chalk.dim(PKG.homepage)}
`;

const COMMANDS = [
  'init', 'install', 'plan', 'status', 'doctor', 'add', 'remove', 'uninstall',
  'list-profiles', 'list-components', 'list-mcps', 'mcp', 'adapter', 'help', 'version', '--version'
];

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    console.log(USAGE);
    return 0;
  }

  if (argv[0] === 'version' || argv[0] === '--version' || argv[0] === '-v') {
    console.log(PKG.version);
    return 0;
  }

  const cmd = argv[0];
  if (!COMMANDS.includes(cmd)) {
    console.error(chalk.red(`Unknown command: ${cmd}`));
    console.error(`Run ${chalk.bold('flow help')} for usage.`);
    return 1;
  }

  // Parse remaining args. Note: no global `scope` default — each command sets
  // its own (install: both; uninstall: project, for safety).
  const args = yargsParser(argv.slice(1), {
    string: ['profile', 'bmad-subset', 'ecc-subset', 'with', 'without', 'scope', 'catalog-source', 'mcp', 'family', 'repair-upstream'],
    boolean: ['dry-run', 'json', 'yes', 'execute', 'remove-stories', 'remove-backups', 'archive-unused', 'migrate-bmad', 'verbose'],
    array: ['with', 'without'],
    alias: { y: 'yes' }
  });

  // Dispatch — each command module exports a default async function(args, ctx)
  const modulePath = resolve(__dirname, '..', 'lib', 'commands', `${cmd}.js`);
  if (!existsSync(modulePath)) {
    console.error(chalk.yellow(`⚠  Command ${chalk.bold(cmd)} not implemented yet (v0.0.1 scaffold).`));
    console.error(`   File ${chalk.dim(modulePath)} is missing.`);
    console.error(`   Track progress: https://github.com/mhd-ghaith-abtah/flow/issues`);
    return 2;
  }

  try {
    const mod = await import(modulePath);
    const ctx = {
      repoRoot: REPO_ROOT,
      pkg: PKG,
      cwd: process.cwd(),
      home: process.env.HOME,
      insideClaudeCode: Boolean(process.env.CLAUDECODE || process.env.CLAUDE_CODE),
    };
    return await mod.default(args, ctx);
  } catch (err) {
    console.error(chalk.red(`✗ ${cmd} failed: ${err.message}`));
    if (process.env.FLOW_DEBUG) console.error(err.stack);
    return 1;
  }
}

main().then(code => process.exit(code ?? 0));
