// lib/commands/plan.js — `flow plan` dry-run resolver.
//
// Prints the resolved install plan for a given profile: which Flow components,
// adapters, MCPs, and upstream subsets would be installed. Does NOT execute
// anything — purely a preview / scriptable plan emitter.
//
// Usage:
//   flow plan --profile standard
//   flow plan --profile team --json
//   flow plan --profile mini --without adapter:e2e-playwright-mcp

import chalk from 'chalk';
import { loadCatalog, resolveProfile, listProfiles } from '../catalog.js';
import { resolveRepoRoot } from '../repo-root.js';

/**
 * @param {Object} args - parsed yargs args
 * @param {Object} ctx
 */
export default async function plan(args, ctx) {
  const repoRoot = ctx.repoRoot ?? resolveRepoRoot(import.meta.url);
  const catalog = loadCatalog(repoRoot);

  const profileName = args.profile ?? 'standard';
  if (!catalog.profiles[profileName]) {
    console.error(chalk.red(`✗ Unknown profile: ${profileName}`));
    console.error(`  Available: ${listProfiles(catalog).join(', ')}`);
    return 1;
  }

  const profile = resolveProfile(catalog, profileName);

  // Apply --with / --without overrides (no-op if empty).
  const withList = toArray(args.with);
  const withoutList = toArray(args.without);
  const adapters = applyOverrides(profile.adapters, withList, withoutList, catalog);

  // CLI override for ECC install scope. Validates against the same enum
  // the catalog schema accepts so a typo never silently corrupts the plan.
  const eccScope = applyEccScopeOverride(profile.ecc_install_scope, args['ecc-scope']);

  const planSpec = {
    profile: profileName,
    description: profile.description,
    flow_components: profile.flow_components,
    adapters,
    mcps: profile.mcps,
    upstreams: {
      bmad: profile.bmad_subset,
      ecc: profile.ecc_subset,
      ecc_install_scope: eccScope,
      caveman: profile.caveman_subset
    },
    features: profile.features ?? {}
  };

  if (args.json) {
    console.log(JSON.stringify(planSpec, null, 2));
    return 0;
  }

  renderHuman(planSpec, ctx);
  return 0;
}

function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Apply the optional --ecc-scope CLI flag on top of the profile's resolved
 * ecc_install_scope. Throws on invalid value so a typo doesn't silently
 * leave the profile default in place (would be a confusing UX — user
 * typed --ecc-scope=projet and got user-scope without warning).
 *
 * @param {'user'|'project'} fromProfile
 * @param {string|undefined} fromFlag
 * @returns {'user'|'project'}
 */
export function applyEccScopeOverride(fromProfile, fromFlag) {
  if (fromFlag == null || fromFlag === '') return fromProfile;
  if (fromFlag !== 'user' && fromFlag !== 'project') {
    throw new Error(`--ecc-scope must be "user" or "project" (got "${fromFlag}")`);
  }
  return fromFlag;
}

function applyOverrides(adapters, withList, withoutList, catalog) {
  let result = [...adapters];
  for (const id of withList) result.push(id);
  result = result.filter(id => !withoutList.includes(id));

  // De-dupe by family (later wins).
  const byFamily = new Map();
  for (const id of result) {
    const a = catalog.adapters.find(x => x.id === id);
    const family = a?.family ?? id;
    byFamily.set(family, id);
  }
  return [...byFamily.values()];
}

function renderHuman(p, ctx) {
  const lines = [];
  lines.push(chalk.bold(`━━━ flow plan ━━━`));
  lines.push(`Profile:      ${chalk.cyan(p.profile)} — ${p.description}`);
  lines.push('');
  lines.push(chalk.bold('Flow components:'));
  for (const c of p.flow_components) lines.push(`  ${chalk.green('+')} ${c}`);
  lines.push('');
  lines.push(chalk.bold('Adapters:'));
  for (const a of p.adapters) lines.push(`  ${chalk.green('+')} ${a}`);
  lines.push('');
  lines.push(chalk.bold('MCPs:'));
  if (p.mcps.length === 0) lines.push(`  ${chalk.dim('(none)')}`);
  for (const m of p.mcps) lines.push(`  ${chalk.green('+')} ${m}`);
  lines.push('');
  lines.push(chalk.bold('Upstreams:'));
  lines.push(`  BMad:     ${p.upstreams.bmad}`);
  lines.push(`  ECC:      ${p.upstreams.ecc}  ${chalk.dim(`(scope: ${p.upstreams.ecc_install_scope})`)}`);
  lines.push(`  Caveman:  ${p.upstreams.caveman}`);
  if (Object.keys(p.features).length > 0) {
    lines.push('');
    lines.push(chalk.bold('Features:'));
    for (const [k, v] of Object.entries(p.features)) lines.push(`  ${k}: ${v}`);
  }
  lines.push('');
  lines.push(chalk.dim('This is a preview. Run `/flow-init` inside Claude Code to execute.'));
  console.log(lines.join('\n'));
}
