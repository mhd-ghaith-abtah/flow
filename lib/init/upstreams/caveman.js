// lib/init/upstreams/caveman.js — dispatch the Caveman installer.
//
// Ports step 8b of /flow-init's workflow.md. Caveman ships from a
// Flow-maintained fork pinned at `github:mhd-ghaith-abtah/caveman#flow-pin-v0.1`
// (see catalog.yaml TEMPORARY FORK NOTICE) until JuliusBrussee/caveman#407
// merges upstream.
//
// Inspect-first behavior:
//   - If FLOW_INSPECT_INSTALL_SCRIPTS=1, do NOT auto-run. Just print the
//     command + commit hash + a one-line note pointing the user at the
//     fork tag for manual review, then return skipped:inspect-only.
//   - Otherwise run normally.
// The skill workflow does its own interactive Y/n confirmation; the
// headless CLI relies on `--yes` (no confirm) or treats unset as
// confirmed-by-default (CI mode). Future work: wire an `opts.confirm`
// hook so the CLI orchestrator can ask interactively too.

import { buildCommandFromString, runCommand, buildStateRecord } from './common.js';

/**
 * @typedef {Object} CavemanPlan
 * @property {Object} catalog
 * @property {string} subset - none | lite | full | ultra (or wenyan variants)
 */

/**
 * Build the Caveman install command. Pure.
 *
 * @param {CavemanPlan} plan
 * @returns {import('./common.js').Command}
 */
export function buildCommand(plan) {
  const installer = plan.catalog?.upstreams?.caveman?.installer;
  if (!installer) throw new Error('catalog missing upstreams.caveman.installer');
  if (!installer.cmd) throw new Error('catalog upstreams.caveman.installer.cmd missing');

  const extraArgs = [];
  if (installer.base_args) {
    for (const tok of installer.base_args.split(/\s+/).filter(Boolean)) {
      extraArgs.push(tok);
    }
  }

  // Source label reflects the fork-pin reality so doctor + JSON output
  // surface "npx-from-fork" instead of just "caveman:npx" — matches the
  // doctor.js probe established in E2-006 / Caveman fork strategy.
  return buildCommandFromString(installer.cmd, extraArgs, 'npx-from-fork');
}

/**
 * Run the Caveman installer. Returns a result + a state record that
 * includes the fork-tag metadata the doctor probe consumes.
 *
 * @param {CavemanPlan} plan
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

  // FLOW_INSPECT_INSTALL_SCRIPTS=1 → halt before running so the user
  // can review the fork's source manually. Mirrors the inspect prompt
  // in skills/flow-init/workflow.md.
  if (process.env.FLOW_INSPECT_INSTALL_SCRIPTS === '1') {
    return {
      ok: true,
      exitCode: 0,
      command,
      stateRecord: {
        installed: false,
        subset: plan.subset,
        skipped: true,
        inspect_only: true,
        ran_at: new Date().toISOString(),
        command: `${command.cmd} ${command.args.join(' ')}`.trim(),
        source: command.source,
      },
      error: 'FLOW_INSPECT_INSTALL_SCRIPTS=1; install paused for inspection. Review the fork: gh repo view mhd-ghaith-abtah/caveman --branch flow-pin-v0.1',
    };
  }

  const result = await runCommand(command, opts);

  // Extract fork tag from the command for state recording. The catalog
  // pins via `github:owner/repo#TAG`; we surface that tag so doctor can
  // tell users which pin is active without grepping the command string.
  const tagMatch = command.args.find(arg => /github:[^#]+#/.test(arg));
  const forkTag = tagMatch ? tagMatch.split('#').pop().replace(/['"]/g, '') : null;

  return {
    ok: result.ok,
    exitCode: result.exitCode,
    command,
    stateRecord: buildStateRecord(command, result, {
      subset: plan.subset,
      fork_tag: forkTag,
      upstream_pr: 407,
    }),
    ...(result.ok ? {} : { error: result.stderr || `caveman install exited ${result.exitCode}` }),
  };
}
