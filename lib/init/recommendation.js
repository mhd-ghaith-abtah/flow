// lib/init/recommendation.js — pick a sensible default profile from Detection.
//
// Used by `flow init` (and the /flow-init skill workflow) to pre-select an
// answer for Q1 (Profile). The user can always override; this is a hint,
// not a decision.
//
// Rules (in order — first match wins):
//   1. No git, no package.json → minimal (bare Flow, no upstream wiring)
//   2. Multi-repo signal: parent dir has 3+ sibling repos → team
//   3. Has Linear MCP already registered → team
//   4. Has Playwright MCP + framework detected → standard
//   5. Has any framework + lockfile → mini
//   6. Has lockfile but no framework → mini
//   7. Default → standard
//
// Rationale: matches the at-a-glance table in docs/profiles.md. The two
// strong "team" signals (Linear or 3+ sibling repos) are conservative on
// purpose; team profile is heavier and shouldn't be the default unless
// there's an unambiguous reason to pick it.

import { readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const STOCK_PROFILES = Object.freeze(['minimal', 'mini', 'standard', 'team']);

/**
 * Best-effort count of sibling repos: directories next to the current
 * project's git root that themselves contain a `.git` directory.
 *
 * @param {string|null} gitRoot
 * @returns {number}
 */
function countSiblingRepos(gitRoot) {
  if (!gitRoot) return 0;
  const parent = dirname(gitRoot);
  if (!existsSync(parent)) return 0;
  try {
    const entries = readdirSync(parent, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = join(parent, entry.name);
      if (candidate === gitRoot) continue;
      if (existsSync(join(candidate, '.git'))) count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Recommend a profile for the given detection. Returns the recommended
 * profile id (always one of STOCK_PROFILES) plus a one-line `reason`
 * the caller can show to the user ("Recommended: standard — has
 * lockfile + react framework").
 *
 * @param {import('./detect.js').Detection} detection
 * @returns {{profile: string, reason: string}}
 */
export function recommendProfile(detection) {
  // 1. Bare project — minimal
  if (!detection.gitRoot && !detection.pkgManager) {
    return {
      profile: 'minimal',
      reason: 'no git + no package manager detected; minimal keeps Flow in pure-state mode',
    };
  }

  // 2. Multi-repo signal
  const siblings = countSiblingRepos(detection.gitRoot);
  if (siblings >= 3) {
    return {
      profile: 'team',
      reason: `${siblings} sibling git repos in parent dir; team profile is built for cross-repo work`,
    };
  }

  // 3. Linear MCP registered
  if (detection.existingMcps.includes('linear')) {
    return {
      profile: 'team',
      reason: 'Linear MCP already registered; team profile is the Linear-integrated bundle',
    };
  }

  // 4. Playwright MCP + framework → standard
  if (detection.existingMcps.includes('playwright') && detection.framework) {
    return {
      profile: 'standard',
      reason: `Playwright MCP + ${detection.framework} framework; standard adds E2E + formal review`,
    };
  }

  // 5/6. Has lockfile (with or without framework) → mini
  if (detection.pkgManager) {
    const frag = detection.framework
      ? `${detection.framework} on ${detection.pkgManager}`
      : `${detection.pkgManager} project`;
    return {
      profile: 'mini',
      reason: `${frag}; mini covers GitHub + light review`,
    };
  }

  // 7. Default fallback
  return {
    profile: 'standard',
    reason: 'no strong signals; standard is the safe default',
  };
}

export { STOCK_PROFILES };
