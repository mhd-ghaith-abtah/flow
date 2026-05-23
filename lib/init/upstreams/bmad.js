// lib/init/upstreams/bmad.js — dispatch the BMad installer.
//
// Ports step 7 of /flow-init's workflow.md. BMad is the simplest of the
// three upstreams: just `npx bmad-method install` + the curated module
// list + any config kv pairs. No installer-path resolution, no scope
// routing, no inspect-first dance.

import { buildCommandFromString, runCommand, buildStateRecord } from './common.js';

/**
 * @typedef {Object} BmadPlan
 * @property {Object} catalog - parsed catalog.yaml
 * @property {string} subset - curated_subsets key (planning-only, full, etc.)
 * @property {Object} [configKvs] - { 'foo.bar': 'baz' } passed as --set foo.bar=baz
 * @property {string} [directory] - optional --directory override
 */

/**
 * Build the BMad install command from the plan. Pure function — safe to
 * call repeatedly from dry-run, doctor, tests.
 *
 * @param {BmadPlan} plan
 * @returns {import('./common.js').Command}
 */
export function buildCommand(plan) {
  const installer = plan.catalog?.upstreams?.bmad?.installer;
  if (!installer) throw new Error('catalog missing upstreams.bmad.installer');

  const subsetDef = plan.catalog.upstreams.bmad.curated_subsets?.[plan.subset];
  if (!subsetDef) throw new Error(`unknown bmad subset: ${plan.subset}`);

  const modules = Array.isArray(subsetDef.modules) ? subsetDef.modules : [];
  const extraArgs = [];

  // base_args (e.g. "--tools claude-code --yes") are space-separated in
  // catalog. Re-tokenize so we never emit `args: ["--tools claude-code"]`
  // as one combined arg (execa would treat it as a single literal token).
  if (installer.base_args) {
    for (const tok of installer.base_args.split(/\s+/).filter(Boolean)) {
      extraArgs.push(tok);
    }
  }

  if (modules.length > 0 && installer.module_arg) {
    extraArgs.push(installer.module_arg, modules.join(','));
  }

  if (plan.directory && installer.directory_arg) {
    extraArgs.push(installer.directory_arg, plan.directory);
  }

  if (plan.configKvs && installer.config_arg) {
    for (const [key, value] of Object.entries(plan.configKvs)) {
      extraArgs.push(installer.config_arg, `${key}=${value}`);
    }
  }

  return buildCommandFromString(installer.cmd, extraArgs, 'bmad:npx');
}

/**
 * Run the BMad installer. Returns the standard InstallResult shape so
 * the orchestrator can decide whether to continue with downstream
 * steps (ECC, MCPs, etc.) on failure.
 *
 * The subset=none case is handled as a no-op so callers don't need to
 * special-case it — they always call install() and get back a uniform
 * result.
 *
 * @param {BmadPlan} plan
 * @param {Object} [opts]
 * @returns {Promise<import('./common.js').InstallResult>}
 */
export async function install(plan, opts = {}) {
  if (plan.subset === 'none') {
    return {
      ok: true,
      exitCode: 0,
      command: { cmd: '', args: [], source: 'skipped:subset-none' },
      stateRecord: { installed: false, subset: 'none', skipped: true, ran_at: new Date().toISOString() },
    };
  }

  const command = buildCommand(plan);
  const result = await runCommand(command, opts);
  return {
    ok: result.ok,
    exitCode: result.exitCode,
    command,
    stateRecord: buildStateRecord(command, result, {
      subset: plan.subset,
      modules: plan.catalog.upstreams.bmad.curated_subsets[plan.subset].modules || [],
    }),
    ...(result.ok ? {} : { error: result.stderr || `bmad install exited ${result.exitCode}` }),
  };
}
