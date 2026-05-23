// lib/init/orchestrate.js — chain detect → questions → scaffold →
// upstream dispatch → MCP registration → optional BMad migration into
// one `runInit(args, ctx)` flow.
//
// This is the headless equivalent of the WHOLE /flow-init skill — what
// E6 has been building up to. Each step is delegated to a focused
// module (detect.js, questions.js, upstreams/*, mcp.js, scaffold.js,
// migrate-bmad.js) and the orchestrator's job is solely to wire them
// in the right order and short-circuit cleanly on failure.
//
// Failure semantics:
//   - Detection / question failures abort BEFORE any write.
//   - An upstream installer failure ABORTS the orchestrator (subsequent
//     upstream + MCP + migration steps are skipped) unless
//     opts.continueOnUpstreamError = true. We bias toward halting because
//     downstream steps (especially MCP registration) often depend on the
//     upstream having landed.
//   - Migration failure auto-rolls-back per migrate-bmad.js contract and
//     leaves the rest of the install intact (Flow's own files have
//     already been written; the user's BMad state is restored).
//
// All steps respect opts.dryRun. In dry-run the orchestrator builds
// commands + state records but never actually shells out or writes
// files. Integration tests use --dry-run to exercise the full path
// without polluting the developer's MCP config / installed upstreams.

import { resolveProfile } from '../catalog.js';
import { detect } from './detect.js';
import { askAll } from './questions.js';
import { recommendProfile } from './recommendation.js';
import * as bmad from './upstreams/bmad.js';
import * as ecc from './upstreams/ecc.js';
import * as caveman from './upstreams/caveman.js';
import * as mcpModule from './mcp.js';
import { scaffold } from './scaffold.js';
import { migrate as migrateBmad } from './migrate-bmad.js';
import { collectAndWriteSecrets } from './secrets.js';
import { applyEccScopeOverride } from '../commands/plan.js';

/**
 * @typedef {Object} InitResult
 * @property {boolean} ok
 * @property {Object} detection
 * @property {Object} answers
 * @property {Object} upstreamResults - keyed by id: { bmad?, ecc?, caveman? }
 * @property {Array} mcpResults
 * @property {Object|null} migrationResult
 * @property {Object} scaffoldManifest - { written: [], skipped: [], dirs: [] }
 * @property {string|null} haltReason - non-null when ok=false
 */

/**
 * Run the full init flow. Returns an InitResult (never throws for
 * expected failure paths so callers can render structured errors).
 *
 * @param {Object} opts
 * @param {string} opts.cwd
 * @param {string} [opts.homeDir]
 * @param {Object} opts.catalog
 * @param {string} opts.flowVersion
 * @param {Object} [opts.cliAnswers] - pre-populated answers from CLI flags
 * @param {boolean} [opts.dryRun=false]
 * @param {boolean} [opts.silent=false]
 * @param {boolean} [opts.continueOnUpstreamError=false]
 * @returns {Promise<InitResult>}
 */
export async function runInit(opts) {
  const cwd = opts.cwd;
  const homeDir = opts.homeDir ?? process.env.HOME;
  const catalog = opts.catalog;
  if (!catalog) throw new Error('runInit: opts.catalog is required');

  // 1. Detect.
  const detection = detect({ cwd, homeDir });

  // 2. Questions. Pre-populated answers + recommendation seed the prompts.
  const baseAnswers = { ...(opts.cliAnswers || {}) };
  const state = { detection, catalog, answers: baseAnswers };
  // In non-interactive mode (all answers pre-populated for the chosen
  // profile's defaults), askAll short-circuits each prompt and just
  // resolves the profile's defaults. The test harness exercises this
  // path by pre-filling all answers via cliAnswers.
  await askAll(state);

  // 3. Resolve the profile + apply --ecc-scope override (E7-002.5).
  const profile = resolveProfile(catalog, state.answers.profile);
  state.answers.eccScope = applyEccScopeOverride(profile.ecc_install_scope, state.answers.eccScope);

  // 4. Upstream dispatch in declared order: bmad → ecc → caveman.
  // BMad first so its planning artifacts exist before ECC can reference
  // them; Caveman last because it's the only upstream Flow can't
  // operate without (so failing early on bmad/ecc is more informative).
  const upstreamResults = {};
  const subOpts = { dryRun: opts.dryRun, silent: opts.silent };

  upstreamResults.bmad = await bmad.install({ catalog, subset: state.answers.bmadSubset || profile.bmad_subset }, subOpts);
  if (!upstreamResults.bmad.ok && !opts.continueOnUpstreamError) {
    return halt('bmad upstream failed', { detection, state, upstreamResults });
  }

  upstreamResults.ecc = await ecc.install({
    catalog,
    subset: state.answers.eccSubset || profile.ecc_subset,
    profile: state.answers.profile,
    scope: state.answers.eccScope,
    homeDir,
  }, subOpts);
  if (!upstreamResults.ecc.ok && !opts.continueOnUpstreamError) {
    return halt('ecc upstream failed', { detection, state, upstreamResults });
  }

  upstreamResults.caveman = await caveman.install({ catalog, subset: state.answers.cavemanSubset || profile.caveman_subset }, subOpts);
  if (!upstreamResults.caveman.ok && !opts.continueOnUpstreamError) {
    return halt('caveman upstream failed', { detection, state, upstreamResults });
  }

  // 5. MCP registration. Resolved from profile.mcps; idempotent per mcp.js.
  const mcpIds = Array.isArray(profile.mcps) ? profile.mcps : [];
  const mcpDefs = mcpModule.resolveMcps(catalog, mcpIds);
  const mcpResults = await mcpModule.installAll(mcpDefs, { ...subOpts, force: false });

  // 5b. Secrets. Any MCP that surfaced requiredEnv (auth: api_token MCPs
  // like github-mcp) needs the actual token before it's usable. Prompt
  // the user + persist via the chosen secrets store (env-file / shell /
  // 1password). dryRun: no prompts, no writes — just record what
  // would be asked.
  // Pre-populated `opts.secretValues` skips prompts entirely; CI uses
  // this to inject values from a secret manager.
  const secretsResult = await collectAndWriteSecrets(mcpResults, state.answers.secretsStore || 'env-file', {
    dryRun: opts.dryRun,
    homeDir,
    values: opts.secretValues,
  });

  // 6. Optional BMad migration. Only when user answered yes AND BMad is
  // detected (the prompt only fires under those conditions, but guard
  // here too for headless --yes mode). Pass dryRun through so a preview
  // run doesn't actually rewrite the user's docs/flow/ tree.
  let migrationResult = null;
  if (state.answers.migrateBmad === 'yes' && detection.bmad.installed) {
    migrationResult = migrateBmad(cwd, {
      projectName: state.answers.projectName,
      dryRun: opts.dryRun,
    });
  }

  // 7. Scaffold the project-side files. This is the only step that
  // writes Flow's OWN files (vs. upstream installers writing to ~/.claude
  // etc.). Run last so it can record the upstream + migration results.
  const scaffoldManifest = scaffold({
    cwd,
    profile: state.answers.profile,
    answers: state.answers,
    resolvedProfile: profile,
    catalog,
    flowVersion: opts.flowVersion,
    upstreamResults,
    migrationResult,
  }, { dryRun: opts.dryRun, force: opts.force });

  return {
    ok: true,
    detection,
    answers: state.answers,
    upstreamResults,
    mcpResults,
    secretsResult,
    migrationResult,
    scaffoldManifest,
    haltReason: null,
  };
}

function halt(reason, partial) {
  return {
    ok: false,
    detection: partial.detection,
    answers: partial.state?.answers || {},
    upstreamResults: partial.upstreamResults || {},
    mcpResults: [],
    secretsResult: null,
    migrationResult: null,
    scaffoldManifest: { written: [], skipped: [], dirs: [] },
    haltReason: reason,
  };
}

/**
 * Helper for non-interactive callers (CI, integration tests):
 * pre-populate every answer from a profile's defaults so askAll() never
 * fires an interactive prompt.
 *
 * @param {Object} catalog
 * @param {string} profileName
 * @param {Object} [overrides] - additional answer overrides
 * @returns {Object} - Answers suitable for opts.cliAnswers
 */
export function defaultAnswersForProfile(catalog, profileName, overrides = {}) {
  const prof = resolveProfile(catalog, profileName);
  // Map adapter ids in the profile to their (family, id-without-prefix).
  const adapters = Array.isArray(prof.adapters) ? prof.adapters : [];
  const byFamily = {};
  for (const id of adapters) {
    const def = catalog.adapters.find(a => a.id === id);
    if (!def) continue;
    const stripped = def.id.replace(/^adapter:/, '').replace(new RegExp(`^${def.family}-`), '');
    byFamily[def.family] = stripped;
  }
  return {
    profile: profileName,
    issueTracker: byFamily['issue-tracker'] || 'none',
    pr: byFamily.pr || 'none',
    e2e: byFamily.e2e || 'none',
    verify: byFamily.verify || 'custom',
    bmadSubset: prof.bmad_subset,
    eccSubset: prof.ecc_subset,
    eccScope: prof.ecc_install_scope,
    cavemanSubset: prof.caveman_subset,
    migrateBmad: 'skip',
    secretsStore: 'env-file',
    ...overrides,
  };
}
