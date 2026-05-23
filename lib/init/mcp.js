// lib/init/mcp.js — register MCP servers with Claude Code.
//
// Headless equivalent of step 9 of /flow-init's workflow.md. Each MCP
// definition in catalog.mcps[] knows its install command, detect command,
// auth model, and (when api_token auth) the env vars it needs. This
// module turns those entries into runnable claude-mcp-add invocations.
//
// Auth handling stays out of this module on purpose. We surface what an
// MCP NEEDS (env var names + prompts, oauth instructions) in the result
// — the orchestrator decides where to source secrets from (Q9 answer:
// env-file vs shell vs 1password). That separation lets `flow doctor`
// reuse the same dispatcher to report MCP state without ever touching
// the user's secrets.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  tokenizeCommand,
  runCommand,
  buildCommandFromString,
  buildStateRecord,
} from './upstreams/common.js';

/**
 * @typedef {Object} McpDefinition
 * @property {string} id
 * @property {string} name
 * @property {string} install_cmd
 * @property {string} [detect_cmd]
 * @property {'home'|'project'} [scope_default]
 * @property {'none'|'api_token'|'oauth_browser'|'oauth_device'} [auth]
 * @property {string} [auth_instructions]
 * @property {Array<{name: string, secret?: boolean, prompt?: string}>} [env]
 */

/**
 * @typedef {Object} McpInstallResult
 * @property {boolean} ok
 * @property {number|null} exitCode
 * @property {string} id
 * @property {import('./upstreams/common.js').Command} command
 * @property {Object} stateRecord
 * @property {Array<{name: string, secret?: boolean, prompt?: string}>} [requiredEnv]
 * @property {string} [authInstructions]
 * @property {string} [error]
 */

/**
 * Build the install command for an MCP. Pure — safe to call from
 * dry-run + doctor + tests. The catalog's install_cmd is a full shell
 * string ("claude mcp add NAME npx PACKAGE"); we tokenize it so execa
 * can spawn without involving the shell.
 *
 * @param {McpDefinition} mcp
 * @returns {import('./upstreams/common.js').Command}
 */
export function buildCommand(mcp) {
  if (!mcp?.install_cmd) {
    throw new Error(`mcp ${mcp?.id ?? '<unknown>'} missing install_cmd`);
  }
  return buildCommandFromString(mcp.install_cmd, [], `mcp:${mcp.id}`);
}

/**
 * Check whether the MCP is already registered. Uses detect_cmd if the
 * catalog supplies one (and it doesn't start with `claude mcp list` —
 * that's a shell pipeline we can't safely tokenize); otherwise calls
 * `claude mcp list` directly and looks for the id in the output.
 *
 * Returns false on any error (missing claude CLI, network glitch,
 * etc.) — installing a second time is idempotent on Claude Code's
 * side, so a false-negative just causes a redundant install attempt.
 *
 * @param {McpDefinition} mcp
 * @param {Object} [opts]
 * @returns {Promise<boolean>}
 */
export async function isInstalled(mcp, opts = {}) {
  if (opts.dryRun) return false;
  // detect_cmd in the catalog is a shell pipeline (`claude mcp list |
  // grep -q ^name`). Easier and more portable to call `claude mcp list`
  // ourselves and pattern-match on the output.
  const result = await runCommand(
    { cmd: 'claude', args: ['mcp', 'list'], source: 'mcp:list' },
    { silent: true, timeoutMs: 5_000 }
  );
  if (!result.ok) return false;
  const lines = (result.stdout || '').split('\n').map(l => l.trim());
  return lines.some(line => line === mcp.id || line.startsWith(`${mcp.id} `));
}

/**
 * Install a single MCP. Skips the actual exec when already registered
 * unless opts.force === true.
 *
 * @param {McpDefinition} mcp
 * @param {Object} [opts]
 * @param {boolean} [opts.force=false]
 * @param {boolean} [opts.dryRun=false]
 * @param {boolean} [opts.silent=false]
 * @returns {Promise<McpInstallResult>}
 */
export async function install(mcp, opts = {}) {
  const command = buildCommand(mcp);

  // Idempotency: don't reinstall a registered MCP unless forced.
  // Claude Code's `mcp add` is technically idempotent but emits a
  // confusing duplicate-key warning we'd rather avoid.
  if (!opts.force) {
    const present = await isInstalled(mcp, opts);
    if (present) {
      return {
        ok: true,
        exitCode: 0,
        id: mcp.id,
        command,
        stateRecord: {
          installed: true,
          skipped: true,
          reason: 'already-registered',
          ran_at: new Date().toISOString(),
          source: command.source,
          auth: mcp.auth || 'none',
          scope: mcp.scope_default || 'home',
        },
      };
    }
  }

  const result = await runCommand(command, opts);
  const stateRecord = buildStateRecord(command, result, {
    id: mcp.id,
    auth: mcp.auth || 'none',
    scope: mcp.scope_default || 'home',
    // oauth_browser MCPs aren't usable until the user finishes the
    // browser dance. Record auth state so doctor can warn until done.
    ...(mcp.auth === 'oauth_browser' ? { auth_state: 'pending' } : {}),
  });

  const out = { ok: result.ok, exitCode: result.exitCode, id: mcp.id, command, stateRecord };

  if (mcp.auth === 'api_token' && Array.isArray(mcp.env) && mcp.env.length > 0) {
    out.requiredEnv = mcp.env.map(e => ({ name: e.name, secret: !!e.secret, prompt: e.prompt }));
    stateRecord.required_env = out.requiredEnv.map(e => e.name);
  }
  if (mcp.auth_instructions) {
    out.authInstructions = mcp.auth_instructions;
  }
  if (!result.ok) {
    out.error = result.stderr || `mcp ${mcp.id} install exited ${result.exitCode}`;
  }
  return out;
}

/**
 * Install a list of MCPs in sequence. Stops on the first failure when
 * opts.stopOnError === true (default: continue, collecting all results).
 *
 * Sequential because `claude mcp add` mutates the same on-disk config
 * file; parallel writes would race.
 *
 * @param {McpDefinition[]} mcps
 * @param {Object} [opts]
 * @returns {Promise<McpInstallResult[]>}
 */
export async function installAll(mcps, opts = {}) {
  const results = [];
  for (const mcp of mcps) {
    const r = await install(mcp, opts);
    results.push(r);
    if (!r.ok && opts.stopOnError) break;
  }
  return results;
}

/**
 * Resolve MCP definitions from the catalog by id. Throws if an id is
 * unknown so callers can fail fast instead of silently skipping.
 *
 * @param {Object} catalog
 * @param {string[]} ids
 * @returns {McpDefinition[]}
 */
export function resolveMcps(catalog, ids) {
  const known = catalog?.mcps || [];
  const byId = new Map(known.map(m => [m.id, m]));
  const out = [];
  for (const id of ids) {
    const mcp = byId.get(id);
    if (!mcp) {
      throw new Error(`unknown MCP id: ${id} (available: ${[...byId.keys()].join(', ')})`);
    }
    out.push(mcp);
  }
  return out;
}
