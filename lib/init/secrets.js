// lib/init/secrets.js — collect MCP api_token secrets + persist them.
//
// MCP dispatchers (lib/init/mcp.js) report `requiredEnv` for `auth:
// api_token` MCPs (e.g. github-mcp wants GITHUB_PERSONAL_ACCESS_TOKEN).
// This module is the layer above: it walks those required-env entries,
// prompts the user for each value, and writes them to whichever secrets
// store the user picked at Q9.
//
// Store implementations:
//   - env-file (default): writes ~/.claude/.env.flow with chmod 600.
//     Loaded by shells via `set -a; . ~/.claude/.env.flow; set +a` in a
//     shell rc, or directly by Flow at runtime.
//   - shell: doesn't write anywhere. Prints the export lines so the
//     user can paste them into their shell rc / 1password / vault.
//   - 1password: prints `op` commands the user can run to stash the
//     secrets in their 1Password vault. Doesn't shell out to `op`
//     directly — that requires unlocked vault context the orchestrator
//     can't promise.
//
// dryRun honored throughout: no prompts, no writes, just report.

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { password } from '@inquirer/prompts';

const ENV_FILE_REL = join('.claude', '.env.flow');
const ENV_FILE_HEADER = `# Flow secrets — written by \`flow init\`.
# Loaded automatically by Flow at runtime. To load in your shell:
#   set -a; . ~/.claude/.env.flow; set +a
#
# chmod 600 — readable only by you. Do NOT commit this file anywhere.
`;

/**
 * @typedef {Object} SecretsResult
 * @property {boolean} ok
 * @property {string} store - 'env-file' | 'shell' | '1password' | 'skipped'
 * @property {string|null} path - destination path (env-file only)
 * @property {string[]} envVarsWritten
 * @property {string[]} mcpsCovered
 * @property {string|null} error
 */

/**
 * Top-level collector. Walks each MCP install result that surfaced
 * `requiredEnv`, prompts the user (unless dryRun OR opts.values is
 * pre-populated), and persists via the chosen store.
 *
 * @param {Array<import('./mcp.js').McpInstallResult>} mcpResults
 * @param {'env-file'|'shell'|'1password'} store
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=false]
 * @param {string} [opts.homeDir]
 * @param {Object<string,string>} [opts.values] - pre-populated env values
 *   keyed by env var name. Skips prompts when present. Useful for CI
 *   that wants to inject values without interactive input.
 * @returns {Promise<SecretsResult>}
 */
export async function collectAndWriteSecrets(mcpResults, store, opts = {}) {
  const homeDir = opts.homeDir ?? process.env.HOME;
  const needSecrets = mcpResults.filter(r => Array.isArray(r.requiredEnv) && r.requiredEnv.length > 0);
  if (needSecrets.length === 0) {
    return {
      ok: true, store: 'skipped', path: null,
      envVarsWritten: [], mcpsCovered: [], error: null,
    };
  }

  // Collect values: prompt OR use opts.values.
  const collected = {};
  const mcpsCovered = [];
  for (const result of needSecrets) {
    mcpsCovered.push(result.id);
    for (const envSpec of result.requiredEnv) {
      if (opts.values && Object.prototype.hasOwnProperty.call(opts.values, envSpec.name)) {
        collected[envSpec.name] = opts.values[envSpec.name];
        continue;
      }
      if (opts.dryRun) {
        // In dry-run we don't prompt; record the var as "would be asked".
        collected[envSpec.name] = '<would-prompt>';
        continue;
      }
      const message = envSpec.prompt || `Value for ${envSpec.name}:`;
      // @inquirer/prompts password masks input. mask: '*' instead of
      // hidden so the user sees their typing happen at all.
      const value = await password({ message, mask: '*' });
      collected[envSpec.name] = value;
    }
  }

  // Persist via the chosen store.
  if (store === 'shell') {
    return writeShell(collected, mcpsCovered, opts);
  }
  if (store === '1password') {
    return writeOnePasswordInstructions(collected, mcpsCovered, opts);
  }
  // Default: env-file.
  return writeEnvFile(collected, mcpsCovered, homeDir, opts);
}

/**
 * env-file store. Writes ~/.claude/.env.flow with chmod 600. Merges
 * with existing content — preserves comments + non-overwritten vars,
 * updates lines whose KEY matches an incoming key.
 */
function writeEnvFile(values, mcpsCovered, homeDir, opts) {
  if (!homeDir) {
    return {
      ok: false, store: 'env-file', path: null,
      envVarsWritten: [], mcpsCovered,
      error: 'env-file store requires $HOME to be set',
    };
  }
  const path = join(homeDir, ENV_FILE_REL);
  const envVarsWritten = Object.keys(values);

  if (opts.dryRun) {
    return {
      ok: true, store: 'env-file', path,
      envVarsWritten, mcpsCovered, error: null,
    };
  }

  // Merge with existing content so we don't blow away non-Flow vars
  // that the user added by hand.
  let merged = ENV_FILE_HEADER;
  const seen = new Set();
  if (existsSync(path)) {
    try {
      const existing = readFileSync(path, 'utf8');
      const lines = existing.split('\n');
      const out = [];
      for (const line of lines) {
        if (/^\s*#/.test(line) || /^\s*$/.test(line)) {
          out.push(line);
          continue;
        }
        const m = /^([A-Z_][A-Z0-9_]*)\s*=/.exec(line);
        if (m && Object.prototype.hasOwnProperty.call(values, m[1])) {
          out.push(`${m[1]}=${quoteShell(values[m[1]])}`);
          seen.add(m[1]);
        } else {
          out.push(line);
        }
      }
      merged = out.join('\n');
    } catch {
      // Fall through — treat as a fresh write.
      merged = ENV_FILE_HEADER;
    }
  }
  // Append any not-yet-seen keys.
  const trailing = [];
  for (const k of envVarsWritten) {
    if (!seen.has(k)) trailing.push(`${k}=${quoteShell(values[k])}`);
  }
  if (trailing.length > 0) {
    if (!merged.endsWith('\n')) merged += '\n';
    merged += trailing.join('\n') + '\n';
  }

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, merged);
    try { chmodSync(path, 0o600); } catch {
      // chmod can fail on some filesystems (Windows, network mounts).
      // Not fatal — the file landed; user can fix perms manually.
    }
  } catch (err) {
    return {
      ok: false, store: 'env-file', path,
      envVarsWritten, mcpsCovered,
      error: `failed to write ${path}: ${err.message}`,
    };
  }

  return {
    ok: true, store: 'env-file', path,
    envVarsWritten, mcpsCovered, error: null,
  };
}

/**
 * shell store. Prints export lines for the user to paste into their
 * shell rc / 1password / wherever. Doesn't write anywhere.
 */
function writeShell(values, mcpsCovered, opts) {
  if (!opts.dryRun) {
    // Print export lines for the user — the orchestrator's stdout is
    // the right channel here since they'll be copy-pasting from there.
    process.stdout.write('\n# Add these to your shell rc (e.g. ~/.zshrc / ~/.bashrc):\n');
    for (const [k, v] of Object.entries(values)) {
      process.stdout.write(`export ${k}=${quoteShell(v)}\n`);
    }
    process.stdout.write('\n');
  }
  return {
    ok: true, store: 'shell', path: null,
    envVarsWritten: Object.keys(values), mcpsCovered, error: null,
  };
}

/**
 * 1password store. Prints `op item create` commands the user can run
 * against their unlocked vault. Doesn't shell out to `op` because that
 * needs vault-name + unlocked context the orchestrator can't promise.
 */
function writeOnePasswordInstructions(values, mcpsCovered, opts) {
  if (!opts.dryRun) {
    process.stdout.write('\n# Run these against your unlocked 1Password vault:\n');
    for (const [k, v] of Object.entries(values)) {
      const safe = quoteShell(v);
      process.stdout.write(`op item create --category="API Credential" --title="${k}" credential=${safe}\n`);
    }
    process.stdout.write('\n# Then, to load at runtime:\n');
    process.stdout.write(`export ${Object.keys(values).map(k => `${k}=$(op item get ${k} --fields credential)`).join(' \\\n       ')}\n\n`);
  }
  return {
    ok: true, store: '1password', path: null,
    envVarsWritten: Object.keys(values), mcpsCovered, error: null,
  };
}

/**
 * Single-quote a value for shell safety. Replaces single-quotes inside
 * the value with the standard `'\''` escape so the result is always
 * parseable by sh / bash / zsh.
 */
function quoteShell(value) {
  const escaped = String(value).replace(/'/g, "'\\''");
  return `'${escaped}'`;
}
