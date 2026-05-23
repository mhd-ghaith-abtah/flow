// lib/init/upstreams/common.js — shared helpers for upstream dispatchers.
//
// Each upstream module (bmad/ecc/caveman) exposes the same shape:
//   - buildCommand(plan) → { cmd, args, source }  (pure)
//   - install(plan, opts) → { ok, exitCode, command, stateRecord }
//
// `buildCommand` is the public surface for inspection (dry-run, doctor
// repair output, tests). It MUST NOT touch the filesystem or shell out.
// `install` does the actual work.
//
// `runCommand` is the only place we shell out. Everyone else routes
// through it so the timeout / streaming / exit-code handling lives in
// exactly one place and tests can stub one symbol.

import { execa } from 'execa';
import { existsSync, statSync } from 'node:fs';

/**
 * @typedef {Object} Command
 * @property {string} cmd
 * @property {string[]} args
 * @property {string} source - human label for which resolution path produced
 *                              this command (e.g. 'installer_path:/...',
 *                              'cmd_fallback', 'npx-from-fork')
 */

/**
 * @typedef {Object} InstallResult
 * @property {boolean} ok
 * @property {number|null} exitCode
 * @property {Command} command
 * @property {Object} stateRecord - safe-to-write fields for install-state.json
 * @property {string} [error] - present when ok=false
 */

/**
 * Resolve the first existing path from a list of candidates. Used by
 * upstream installers that prefer a local clone over an npm install
 * when one is available. Tildes (~) are expanded against $HOME.
 *
 * @param {string[]} candidates
 * @param {string} homeDir
 * @returns {string|null}
 */
export function firstExistingPath(candidates, homeDir) {
  if (!Array.isArray(candidates)) return null;
  for (const raw of candidates) {
    if (!raw) continue;
    const expanded = raw.startsWith('~/') && homeDir ? `${homeDir}${raw.slice(1)}` : raw;
    if (existsSync(expanded)) return expanded;
  }
  return null;
}

/**
 * Split a shell-style command string into cmd + args. Handles simple
 * quoted segments ("foo bar" or 'foo bar') so we can keep the catalog
 * field human-readable while still execa-safe.
 *
 * Intentionally NOT a full POSIX shell parser. The catalog only uses
 * quoted segments for github-pin syntax (`-p "github:owner/repo#ref"`),
 * which this handles. If the catalog ever grows shell metacharacters
 * (pipes, redirections), we should switch to execa-style array form
 * up front instead of parsing.
 *
 * @param {string} str
 * @returns {string[]}
 */
export function tokenizeCommand(str) {
  if (!str) return [];
  const tokens = [];
  let buf = '';
  let inDouble = false;
  let inSingle = false;
  for (const ch of str) {
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (/\s/.test(ch) && !inDouble && !inSingle) {
      if (buf) {
        tokens.push(buf);
        buf = '';
      }
      continue;
    }
    buf += ch;
  }
  if (buf) tokens.push(buf);
  return tokens;
}

/**
 * Build a Command from a raw command string plus an optional argument
 * list to append. Useful when the catalog gives us "npx bmad-method
 * install" and we want to add "--tools claude-code --yes" + module flags.
 *
 * @param {string} rawCmd
 * @param {string[]} extraArgs
 * @param {string} source
 * @returns {Command}
 */
export function buildCommandFromString(rawCmd, extraArgs, source) {
  const tokens = tokenizeCommand(rawCmd);
  if (tokens.length === 0) {
    throw new Error(`upstream installer command is empty (source: ${source})`);
  }
  const [cmd, ...baseArgs] = tokens;
  return {
    cmd,
    args: [...baseArgs, ...extraArgs.filter(a => a != null && a !== '')],
    source,
  };
}

/**
 * Execute a Command via execa with sane defaults. Streams stdout/stderr
 * by default so the user sees the upstream installer's own output in
 * real time; opts.silent suppresses streaming for tests.
 *
 * Never throws — returns { ok, exitCode } so callers can decide whether
 * to halt the broader install flow.
 *
 * @param {Command} command
 * @param {Object} [opts]
 * @param {boolean} [opts.silent=false]
 * @param {boolean} [opts.dryRun=false]
 * @param {number} [opts.timeoutMs=300000] - 5min default; installers can be slow
 * @param {Object} [opts.env] - extra env vars to merge
 * @returns {Promise<{ok: boolean, exitCode: number|null, stdout?: string, stderr?: string}>}
 */
export async function runCommand(command, opts = {}) {
  if (opts.dryRun) {
    return { ok: true, exitCode: 0, stdout: '', stderr: '' };
  }
  try {
    const result = await execa(command.cmd, command.args, {
      stdio: opts.silent ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      timeout: opts.timeoutMs ?? 300_000,
      reject: false,
      env: { ...process.env, ...(opts.env || {}) },
    });
    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  } catch (err) {
    return {
      ok: false,
      exitCode: null,
      stdout: '',
      stderr: err.message || String(err),
    };
  }
}

/**
 * Build the std stateRecord fields shared by all upstreams. Callers
 * extend this with upstream-specific keys (subset, modules, fork_tag, etc.).
 *
 * @param {Command} command
 * @param {{ok: boolean, exitCode: number|null}} result
 * @param {Object} extra
 * @returns {Object}
 */
export function buildStateRecord(command, result, extra = {}) {
  return {
    installed: result.ok,
    exit_code: result.exitCode,
    ran_at: new Date().toISOString(),
    command: `${command.cmd} ${command.args.join(' ')}`.trim(),
    source: command.source,
    ...extra,
  };
}
