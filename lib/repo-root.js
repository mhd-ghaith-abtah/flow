// lib/repo-root.js — resolve Flow's repo root the same way the skills do.
//
// Resolution order (matches skills/flow-init/workflow.md step 1):
//   1. $FLOW_REPO_ROOT env (explicit override).
//   2. Walk up from import.meta.url's directory looking for catalog.yaml
//      (works whether installed via npm at ~/.npm-global/lib/node_modules/...
//      or via dev-link symlinks to a checked-out clone).
//   3. CWD if it contains catalog.yaml (dev mode).

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * @param {string} startDir
 * @returns {string|null}
 */
function walkUpForCatalog(startDir) {
  let dir = startDir;
  while (dir && dir !== dirname(dir)) {
    if (existsSync(resolve(dir, 'catalog.yaml'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

/**
 * @param {string} importMetaUrl - typically `import.meta.url` from the caller
 * @returns {string}
 */
export function resolveRepoRoot(importMetaUrl) {
  if (process.env.FLOW_REPO_ROOT) {
    if (!existsSync(resolve(process.env.FLOW_REPO_ROOT, 'catalog.yaml'))) {
      throw new Error(`FLOW_REPO_ROOT=${process.env.FLOW_REPO_ROOT} but no catalog.yaml found there`);
    }
    return process.env.FLOW_REPO_ROOT;
  }

  // Walk up from the caller's file location (works for npm install + symlinks).
  const callerPath = new URL(importMetaUrl).pathname;
  const fromCaller = walkUpForCatalog(dirname(callerPath));
  if (fromCaller) return fromCaller;

  // Fall back to CWD (dev mode).
  const fromCwd = walkUpForCatalog(process.cwd());
  if (fromCwd) return fromCwd;

  throw new Error(
    "Couldn't locate catalog.yaml. Either:\n" +
    "  • Set FLOW_REPO_ROOT to the directory containing catalog.yaml, or\n" +
    "  • Run `flow` from inside a Flow clone, or\n" +
    "  • Re-install Flow (clone https://github.com/mhd-ghaith-abtah/flow; tools/dev-link.sh)."
  );
}
