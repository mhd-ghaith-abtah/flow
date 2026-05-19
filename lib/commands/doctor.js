// lib/commands/doctor.js — `flow doctor` health check CLI.
//
// Headless equivalent of the interactive /flow-doctor skill. Runs the subset
// of checks that don't require an LLM in the loop:
//   - catalog.yaml parses + validates against schema
//   - install-state.json exists + parses at each scope
//   - flow.config.yaml exists + parses + has required keys
//   - adapter files present at their expected paths
//   - required CLIs in $PATH (per active adapters)
//
// LLM-dependent checks (probing MCP responsiveness via tool calls, parsing
// recent review notes for severity labels) stay in the skill. CLI just gives
// scriptable yes/no for CI gates.
//
// Exit codes:
//   0 — all ✓ or only ℹ
//   1 — at least one ⚠
//   2 — at least one ✗

import { existsSync, readFileSync, statSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import chalk from 'chalk';
import { execaSync } from 'execa';
import { parse as parseYaml } from 'yaml';
import { loadCatalog } from '../catalog.js';
import { resolveRepoRoot } from '../repo-root.js';

/**
 * @param {Object} args - yargs-parser args
 * @param {Object} ctx
 */
export default async function doctor(args, ctx) {
  const repoRoot = ctx.repoRoot ?? resolveRepoRoot(import.meta.url);
  const json = Boolean(args.json);
  const verbose = Boolean(args.verbose);
  const repairUpstream = args['repair-upstream'];

  // --repair-upstream <name>: side-quest before the normal probe. Reads the
  // pinned version from install-state and prints the commands to reinstall it
  // (does NOT auto-run; upstream installs touch user-scope state).
  if (repairUpstream) {
    return runRepairUpstream(repairUpstream, ctx);
  }

  const report = {
    catalog: probeCatalog(repoRoot),
    state: probeState(ctx),
    config: probeConfig(ctx),
    adapters: [],
    clis: [],
    upstreams: [],
  };

  // Adapter + CLI checks depend on a parsed config.
  if (report.config.parsed) {
    report.adapters = probeAdapters(repoRoot, report.config.parsed);
    report.clis = probeClis(report.config.parsed, report.catalog.raw);
  }

  // Upstream presence — cheap detection from install-state.
  report.upstreams = probeUpstreams(ctx, report.state.home);

  if (json) {
    // Strip the internal `raw` catalog payload — JSON consumers want doctor
    // results, not the entire catalog dumped.
    const sanitized = {
      ...report,
      catalog: { ...report.catalog, raw: undefined },
    };
    delete sanitized.catalog.raw;
    console.log(JSON.stringify(sanitized, null, 2));
  } else {
    renderHuman(report, { verbose });
  }

  // Compute exit code.
  const counts = countSeverities(report);
  if (counts.fail > 0) return 2;
  if (counts.warn > 0) return 1;
  return 0;
}

function probeCatalog(repoRoot) {
  const r = { path: join(repoRoot, 'catalog.yaml'), status: '✗', error: null, raw: null };
  try {
    r.raw = loadCatalog(repoRoot, { validate: true });
    r.status = '✓';
  } catch (err) {
    r.error = err.message;
  }
  return r;
}

function probeState(ctx) {
  const home = ctx.home || process.env.HOME;
  const homePath = join(home, '.claude', 'flow', 'install-state.json');
  const projectPath = join(ctx.cwd, '.claude', 'flow', 'install-state.json');
  return {
    home: probeJson(homePath, 'home'),
    project: probeJson(projectPath, 'project'),
  };
}

function probeJson(path, scope) {
  const r = { path, scope, status: 'ℹ', error: null, parsed: null };
  if (!existsSync(path)) {
    r.error = 'not present (run /flow-init)';
    return r;
  }
  try {
    const content = readFileSync(path, 'utf-8').trim();
    if (!content) {
      r.status = '⚠';
      r.error = 'empty file';
      return r;
    }
    r.parsed = JSON.parse(content);
    r.status = '✓';
  } catch (err) {
    r.status = '✗';
    r.error = err.message;
  }
  return r;
}

function probeConfig(ctx) {
  const path = join(ctx.cwd, 'flow.config.yaml');
  const r = { path, status: '✗', error: null, parsed: null };
  if (!existsSync(path)) {
    r.status = 'ℹ';
    r.error = 'not present (run /flow-init)';
    return r;
  }
  try {
    r.parsed = parseYaml(readFileSync(path, 'utf-8'));
    if (!r.parsed || typeof r.parsed !== 'object') {
      r.status = '✗';
      r.error = 'parsed to non-object';
      return r;
    }
    if (!r.parsed.adapters) {
      r.status = '⚠';
      r.error = "missing required 'adapters' section";
      return r;
    }
    r.status = '✓';
  } catch (err) {
    r.error = err.message;
  }
  return r;
}

function probeAdapters(repoRoot, config) {
  const families = ['issue_tracker', 'pr', 'e2e', 'verify'];
  const results = [];
  for (const family of families) {
    const id = config.adapters?.[family];
    if (!id) {
      results.push({ family, id: null, status: 'ℹ', detail: 'not configured' });
      continue;
    }
    const adapterPath = join(repoRoot, 'adapters', family.replace('_', '-'), `${id}.md`);
    if (!existsSync(adapterPath)) {
      results.push({
        family,
        id,
        status: '⚠',
        detail: `adapter file missing: ${adapterPath}`,
      });
      continue;
    }
    // Detect mixed-state (issue #28): project-side symlink vs regular file.
    const projectAdapter = join(process.cwd(), '.claude', 'flow', 'adapters', `${family.replace('_', '-')}.md`);
    let kind = 'absent';
    if (existsSync(projectAdapter)) {
      try {
        kind = lstatSync(projectAdapter).isSymbolicLink() ? 'symlink' : 'regular_file';
      } catch (e) {
        kind = 'unknown';
      }
    }
    results.push({
      family,
      id,
      status: kind === 'regular_file' ? '⚠' : '✓',
      kind,
      detail: kind === 'regular_file'
        ? 'project-side adapter is a regular file (not a Flow symlink); upstream updates will not propagate'
        : `adapter file present at ${adapterPath}`,
    });
  }
  return results;
}

function probeClis(config, catalog) {
  if (!catalog) return [];
  const required = new Set();
  for (const family of ['issue_tracker', 'pr', 'e2e', 'verify']) {
    const id = config.adapters?.[family];
    if (!id) continue;
    const adapter = catalog.adapters?.find((a) => a.id === id);
    if (adapter?.needs_cli) {
      for (const cli of adapter.needs_cli) required.add(cli);
    }
  }
  const results = [];
  for (const cli of required) {
    let status = '✗';
    let path = null;
    try {
      path = execaSync('which', [cli]).stdout.trim();
      if (path) status = '✓';
    } catch (e) { /* not in PATH */ }
    results.push({ cli, status, path, detail: status === '✓' ? path : 'not in $PATH' });
  }
  return results;
}

function probeUpstreams(ctx, homeState) {
  if (!homeState.parsed?.upstreams) return [];
  const out = [];
  for (const [name, rec] of Object.entries(homeState.parsed.upstreams)) {
    const entry = {
      name,
      status: rec.installed ? '✓' : 'ℹ',
      subset: rec.subset,
      version: rec.version || 'not pinned',
    };
    // Surface the Caveman fork status so users know we're shipping from a
    // pinned fork tag pending JuliusBrussee/caveman#407 merging upstream.
    // Hint level (ℹ) on purpose — it's expected state, not a problem.
    if (name === 'caveman' && rec.source === 'npx-from-fork') {
      entry.note = `installed from fork (${rec.fork_tag || 'pinned'}); tracking upstream PR #${rec.upstream_pr || 407}`;
    }
    out.push(entry);
  }
  return out;
}

function countSeverities(report) {
  const counts = { ok: 0, info: 0, warn: 0, fail: 0 };
  const items = [
    report.catalog,
    report.state.home,
    report.state.project,
    report.config,
    ...report.adapters,
    ...report.clis,
    ...report.upstreams,
  ];
  for (const item of items) {
    if (!item) continue;
    if (item.status === '✓') counts.ok++;
    else if (item.status === 'ℹ') counts.info++;
    else if (item.status === '⚠') counts.warn++;
    else if (item.status === '✗') counts.fail++;
  }
  return counts;
}

function renderHuman(report, { verbose }) {
  const lines = [];
  lines.push(chalk.bold('━━━ flow doctor ━━━'));
  lines.push('');
  lines.push(`Catalog:    ${tag(report.catalog.status)}  ${report.catalog.path}`);
  if (report.catalog.error) lines.push(`            ${chalk.dim(report.catalog.error)}`);

  lines.push('');
  lines.push('State:');
  lines.push(`  Home:     ${tag(report.state.home.status)}  ${report.state.home.path}`);
  if (report.state.home.error) lines.push(`            ${chalk.dim(report.state.home.error)}`);
  lines.push(`  Project:  ${tag(report.state.project.status)}  ${report.state.project.path}`);
  if (report.state.project.error) lines.push(`            ${chalk.dim(report.state.project.error)}`);
  lines.push(`  Config:   ${tag(report.config.status)}  ${report.config.path}`);
  if (report.config.error) lines.push(`            ${chalk.dim(report.config.error)}`);

  if (report.adapters.length > 0) {
    lines.push('');
    lines.push('Adapters:');
    for (const a of report.adapters) {
      lines.push(`  ${a.family}:  ${tag(a.status)}  ${a.id || chalk.dim('—')}  ${chalk.dim(a.detail || '')}`);
    }
  }

  if (report.clis.length > 0) {
    lines.push('');
    lines.push('CLIs:');
    for (const c of report.clis) {
      lines.push(`  ${c.cli}:  ${tag(c.status)}  ${chalk.dim(c.detail)}`);
    }
  }

  if (report.upstreams.length > 0) {
    lines.push('');
    lines.push('Upstreams:');
    for (const u of report.upstreams) {
      lines.push(`  ${u.name}:  ${tag(u.status)}  subset=${u.subset || '—'}  version=${u.version}`);
      if (u.note) lines.push(`          ${chalk.dim(u.note)}`);
    }
  }

  const c = countSeverities(report);
  lines.push('');
  lines.push(chalk.bold(`Summary: ${c.ok} ✓ · ${c.info} ℹ · ${c.warn} ⚠ · ${c.fail} ✗`));

  if (verbose) {
    lines.push('');
    lines.push(chalk.dim('For LLM-dependent checks (MCP responsiveness, severity-label preservation,'));
    lines.push(chalk.dim('Caveman global-scope detection), run /flow-doctor inside Claude Code.'));
  }

  console.log(lines.join('\n'));
}

function tag(s) {
  if (s === '✓') return chalk.green('✓');
  if (s === '⚠') return chalk.yellow('⚠');
  if (s === '✗') return chalk.red('✗');
  if (s === 'ℹ') return chalk.cyan('ℹ');
  return s;
}

/**
 * --repair-upstream <name>: print the exact commands to reinstall the pinned
 * version of an upstream after drift. Does NOT auto-run — upstream installs
 * touch user-scope state and curl-pipe-bash should never be triggered
 * implicitly by a CLI subcommand.
 *
 * Reads pinned version from $HOME/.claude/flow/install-state.json.
 *
 * @param {string} name - bmad | ecc | caveman
 * @param {Object} ctx
 * @returns {Promise<number>} exit code
 */
async function runRepairUpstream(name, ctx) {
  const validNames = ['bmad', 'ecc', 'caveman'];
  if (!validNames.includes(name)) {
    console.error(chalk.red(`✗ Unknown upstream: ${name}`));
    console.error(`  Available: ${validNames.join(', ')}`);
    return 1;
  }

  const homePath = join(ctx.home || process.env.HOME, '.claude', 'flow', 'install-state.json');
  if (!existsSync(homePath)) {
    console.error(chalk.red(`✗ No install-state.json at ${homePath}`));
    console.error('  Run /flow-init first.');
    return 1;
  }

  let state;
  try {
    state = JSON.parse(readFileSync(homePath, 'utf-8'));
  } catch (err) {
    console.error(chalk.red(`✗ Could not parse install-state.json: ${err.message}`));
    return 1;
  }

  const record = state.upstreams?.[name];
  if (!record || !record.version) {
    console.error(chalk.yellow(`⚠ No pinned version recorded for ${name}.`));
    console.error('  Either /flow-init pre-dates pinning, or this upstream was never installed via Flow.');
    console.error(`  Re-run /flow-init --update --pin-upstream ${name} to capture the current version.`);
    return 1;
  }

  console.log(chalk.bold(`━━━ flow doctor --repair-upstream ${name} ━━━`));
  console.log();
  console.log(`Pinned version (from install-state): ${chalk.cyan(record.version)}`);
  console.log(`Subset:                              ${record.subset || '—'}`);
  console.log();
  console.log(chalk.bold('Run these commands yourself to repair (Flow refuses to auto-run upstream installers):'));
  console.log();

  if (name === 'bmad') {
    const v = record.version.replace(/^v/, '');
    console.log(`  ${chalk.cyan(`npx bmad-method@${v} install --tools claude-code --yes`)}`);
    console.log();
    console.log(chalk.dim('  Notes:'));
    console.log(chalk.dim(`  - npx will install the exact pinned version.`));
    console.log(chalk.dim(`  - If the pinned version was a commit hash (e.g. "unknown@<date>"), use git checkout in _bmad/ instead.`));
  } else if (name === 'ecc') {
    console.log(`  ${chalk.cyan(`cd ~/.claude/rules && git fetch --all && git checkout ${record.version}`)}`);
    console.log();
    console.log(chalk.dim('  Notes:'));
    console.log(chalk.dim(`  - ECC ships as a git checkout under ~/.claude/rules. The pinned value is a git ref.`));
    console.log(chalk.dim(`  - If ~/.claude/rules/ isn't a git checkout, re-run the ECC installer:`));
    console.log(chalk.dim(`    npx @everything-claude-code/ecc install --target claude --profile ${record.subset}`));
  } else if (name === 'caveman') {
    console.log(`  ${chalk.cyan(`npx -y "github:mhd-ghaith-abtah/caveman#flow-pin-v0.1"`)}`);
    console.log();
    console.log(chalk.dim('  Notes:'));
    console.log(chalk.dim(`  - Flow installs Caveman from a temporary fork (mhd-ghaith-abtah/caveman @ flow-pin-v0.1).`));
    console.log(chalk.dim(`    Fork = upstream main + JuliusBrussee/caveman#407 (project-scope gating) patches.`));
    console.log(chalk.dim(`  - Pinned version: ${record.version}. When #407 merges upstream Flow will swap back.`));
    console.log(chalk.dim(`  - To inspect first: gh repo view mhd-ghaith-abtah/caveman --branch flow-pin-v0.1`));
    console.log(chalk.dim(`    or set FLOW_INSPECT_INSTALL_SCRIPTS=1 and re-run /flow-init.`));
    console.log(chalk.dim(`  - Track upstream merge status: gh pr view 407 --repo JuliusBrussee/caveman`));
  }

  console.log();
  console.log(chalk.dim('After repair, re-run `flow doctor` to verify the drift warning clears.'));
  return 0;
}
