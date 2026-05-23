// lib/init/upstreams/ecc.js — dispatch the ECC installer.
//
// Ports step 8 of /flow-init's workflow.md and consumes the scope
// plumbing from E7-002/E7-003: chooses --target by ecc_install_scope
// (user → claude, project → claude-project).
//
// Resolution order for which command to run:
//   1. First-existing entry from `installer_path_candidates` (local
//      ECC clone for contributors).
//   2. Otherwise `cmd_fallback` from catalog — currently the github-pin
//      `npx -y -p "github:affaan-m/ECC#98bd5174" ecc-install` until ECC
//      cuts a 2.x release with the claude-project target in it.

import { buildCommandFromString, runCommand, buildStateRecord, firstExistingPath } from './common.js';

/**
 * @typedef {Object} EccPlan
 * @property {Object} catalog
 * @property {string} subset - curated_subsets key (flow-essentials, etc.)
 * @property {string} profile - the resolved profile name (--profile arg value)
 * @property {'user'|'project'} scope - install_scope from resolveProfile + CLI override
 * @property {string[]} [withList] - component ids to add via --with
 * @property {string[]} [withoutList] - component ids to remove via --without
 * @property {string} [homeDir]
 */

/**
 * Build the ECC install command. Pure — safe for dry-run + doctor.
 *
 * @param {EccPlan} plan
 * @returns {import('./common.js').Command}
 */
export function buildCommand(plan) {
  const installer = plan.catalog?.upstreams?.ecc?.installer;
  if (!installer) throw new Error('catalog missing upstreams.ecc.installer');

  const homeDir = plan.homeDir ?? process.env.HOME ?? '';
  const candidates = plan.catalog.upstreams.ecc.detect?.installer_path_candidates || [];
  const localPath = firstExistingPath(candidates, homeDir);

  const rawCmd = localPath
    ? installer.cmd.replace('{installer_path}', localPath)
    : installer.cmd_fallback;
  if (!rawCmd) {
    throw new Error('catalog upstreams.ecc.installer missing both cmd ({installer_path}) and cmd_fallback');
  }

  const source = localPath ? `installer_path:${localPath}` : 'cmd_fallback';

  // Resolve target by scope (E7-003 plumbing).
  const target = installer.target_by_scope?.[plan.scope];
  if (!target) {
    throw new Error(`ECC scope "${plan.scope}" has no target_by_scope mapping`);
  }

  const extraArgs = [];
  if (installer.target_arg) {
    extraArgs.push(installer.target_arg, target);
  }
  if (installer.base_args) {
    for (const tok of installer.base_args.split(/\s+/).filter(Boolean)) {
      extraArgs.push(tok);
    }
  }
  if (plan.profile && installer.profile_arg) {
    extraArgs.push(installer.profile_arg, plan.profile);
  }
  if (Array.isArray(plan.withList) && installer.with_arg) {
    for (const id of plan.withList) {
      extraArgs.push(installer.with_arg, id);
    }
  }
  if (Array.isArray(plan.withoutList) && installer.without_arg) {
    for (const id of plan.withoutList) {
      extraArgs.push(installer.without_arg, id);
    }
  }

  return buildCommandFromString(rawCmd, extraArgs, source);
}

/**
 * Run the ECC installer. Skipped (no-op success) when subset=none.
 *
 * @param {EccPlan} plan
 * @param {Object} [opts]
 * @returns {Promise<import('./common.js').InstallResult>}
 */
export async function install(plan, opts = {}) {
  if (plan.subset === 'none') {
    return {
      ok: true,
      exitCode: 0,
      command: { cmd: '', args: [], source: 'skipped:subset-none' },
      stateRecord: {
        installed: false,
        subset: 'none',
        skipped: true,
        install_scope: plan.scope,
        ran_at: new Date().toISOString(),
      },
    };
  }

  const command = buildCommand(plan);
  const result = await runCommand(command, opts);
  const target = plan.catalog.upstreams.ecc.installer.target_by_scope?.[plan.scope];
  return {
    ok: result.ok,
    exitCode: result.exitCode,
    command,
    stateRecord: buildStateRecord(command, result, {
      subset: plan.subset,
      profile: plan.profile,
      install_scope: plan.scope,
      target,
    }),
    ...(result.ok ? {} : { error: result.stderr || `ecc install exited ${result.exitCode}` }),
  };
}
