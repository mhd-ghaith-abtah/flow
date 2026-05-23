// lib/init/detect.js — project shape detection for `flow init`.
//
// Pure synchronous probes (filesystem + a small number of child_process
// calls). Headless equivalent of step 2 of the /flow-init skill workflow.
// Returns a Detection object that downstream init logic (questions.js,
// upstreams/*, mcp.js) reads to compute defaults and recommendations.
//
// Design notes:
// - All probes have a fallback. A missing tool, a non-git directory, an
//   unreadable manifest — none of these should crash detection. They
//   surface as `null` / `false` / `[]` in the result.
// - Probes that need an external CLI (`git`, `claude`) use execaSync with
//   short timeouts and never throw; on failure they return the same shape
//   they'd return on success-with-empty-output.
// - The Detection shape is intentionally flat. Future consumers can read
//   `detection.bmad.installed` or `detection.framework` without walking
//   nested config maps.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { parse as parseYaml } from 'yaml';

/**
 * @typedef {Object} UpstreamPresence
 * @property {boolean} installed
 * @property {string|null} version
 * @property {string|null} path - filesystem path used to detect presence
 */

/**
 * @typedef {Object} EccPresence
 * @property {boolean} installed
 * @property {string|null} version
 * @property {'user'|'project'|'both'|null} scope - which install root has content
 * @property {string|null} userPath
 * @property {string|null} projectPath
 */

/**
 * @typedef {Object} Detection
 * @property {string} cwd
 * @property {string|null} gitRoot
 * @property {string|null} originUrl
 * @property {string|null} pkgManager - npm | pnpm | yarn | cargo | go | pip | poetry | null
 * @property {string|null} primaryStack - javascript | typescript | rust | go | python | null
 * @property {string|null} framework - next | astro | react | vue | svelte | nestjs | null
 * @property {boolean} hasClaudeMd
 * @property {UpstreamPresence} bmad
 * @property {EccPresence} ecc
 * @property {UpstreamPresence} caveman
 * @property {string[]} existingMcps - names of MCPs registered with claude
 * @property {string[]} availableClis - subset of probed CLI names found in PATH
 * @property {boolean} flowAlreadyConfigured
 */

const PROBED_CLIS = ['git', 'gh', 'glab', 'jq', 'yq', 'make', 'pnpm', 'npm', 'yarn', 'op', 'claude'];

const LOCKFILE_TO_MANAGER = Object.freeze({
  'pnpm-lock.yaml': { pkgManager: 'pnpm', primaryStack: 'javascript' },
  'yarn.lock': { pkgManager: 'yarn', primaryStack: 'javascript' },
  'package-lock.json': { pkgManager: 'npm', primaryStack: 'javascript' },
  'Cargo.lock': { pkgManager: 'cargo', primaryStack: 'rust' },
  'go.sum': { pkgManager: 'go', primaryStack: 'go' },
  'poetry.lock': { pkgManager: 'poetry', primaryStack: 'python' },
  'requirements.txt': { pkgManager: 'pip', primaryStack: 'python' },
  'Pipfile.lock': { pkgManager: 'pipenv', primaryStack: 'python' },
});

const FRAMEWORK_DEPS = Object.freeze({
  next: 'next',
  astro: 'astro',
  nuxt: 'nuxt',
  remix: '@remix-run/react',
  sveltekit: '@sveltejs/kit',
  nestjs: '@nestjs/core',
  react: 'react',
  vue: 'vue',
  svelte: 'svelte',
});

function safeExec(cmd, args, opts = {}) {
  try {
    const result = execaSync(cmd, args, {
      timeout: 3000,
      reject: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
    if (result.exitCode !== 0) return null;
    return result.stdout?.trim() || null;
  } catch {
    return null;
  }
}

function safeRead(path) {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function safeParseYaml(text) {
  if (!text) return null;
  try {
    return parseYaml(text);
  } catch {
    return null;
  }
}

function safeParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Detect package manager + primary stack from lockfile presence.
 * First match wins (LOCKFILE_TO_MANAGER iteration order = pnpm > yarn > npm
 * > rust > go > python). A repo with both pnpm-lock.yaml and Cargo.lock
 * resolves as pnpm/javascript, which is the right call for monorepos
 * where the JS surface is the development driver.
 *
 * @param {string} cwd
 * @returns {{pkgManager: string|null, primaryStack: string|null}}
 */
function detectPkgManager(cwd) {
  for (const [lockfile, meta] of Object.entries(LOCKFILE_TO_MANAGER)) {
    if (existsSync(join(cwd, lockfile))) {
      return { pkgManager: meta.pkgManager, primaryStack: meta.primaryStack };
    }
  }
  // No lockfile but package.json suggests JS without a specific manager.
  if (existsSync(join(cwd, 'package.json'))) {
    return { pkgManager: 'npm', primaryStack: 'javascript' };
  }
  return { pkgManager: null, primaryStack: null };
}

/**
 * Look at the dependencies of package.json (if present) and pick the
 * first framework that matches. Returns null when no recognized framework
 * is found — caller can fall back to primaryStack for display.
 *
 * @param {string} cwd
 * @returns {string|null}
 */
function detectFramework(cwd) {
  const pkg = safeParseJson(safeRead(join(cwd, 'package.json')));
  if (!pkg) return null;
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const [name, depKey] of Object.entries(FRAMEWORK_DEPS)) {
    if (allDeps[depKey]) return name;
  }
  return null;
}

/**
 * BMad presence + version. BMad ships its manifest at one of two paths;
 * we try both. Version is pulled from manifest.yaml's `version` key,
 * falling back to a git ref if the manifest is missing or unparseable.
 *
 * @param {string} cwd
 * @returns {UpstreamPresence}
 */
function detectBmad(cwd) {
  const manifestPath = join(cwd, '_bmad', '_config', 'manifest.yaml');
  const outputDir = join(cwd, 'docs', '_bmad-output');
  const installed = existsSync(manifestPath) || existsSync(outputDir);
  if (!installed) return { installed: false, version: null, path: null };

  const manifest = safeParseYaml(safeRead(manifestPath));
  let version = manifest?.version || null;
  if (!version) {
    const ref = safeExec('git', ['-C', join(cwd, '_bmad'), 'rev-parse', 'HEAD']);
    version = ref ? `git:${ref.slice(0, 7)}` : null;
  }
  return { installed: true, version, path: existsSync(manifestPath) ? manifestPath : outputDir };
}

/**
 * ECC presence + scope. Probes the user-scope install root
 * (~/.claude/rules/ecc) AND the project-scope root
 * (<cwd>/.claude/rules/ecc) and reports which one(s) have content.
 *
 * `scope: 'both'` is the collision state — also detected by flow-doctor
 * E7-004 probe. Surfacing it here lets `flow init` warn early instead of
 * silently picking a side.
 *
 * @param {string} cwd
 * @param {string} homeDir
 * @returns {EccPresence}
 */
function detectEcc(cwd, homeDir) {
  const userPath = homeDir ? join(homeDir, '.claude', 'rules', 'ecc') : null;
  const projectPath = join(cwd, '.claude', 'rules', 'ecc');
  const userPresent = userPath ? existsSync(userPath) : false;
  const projectPresent = existsSync(projectPath);
  if (!userPresent && !projectPresent) {
    return { installed: false, version: null, scope: null, userPath, projectPath };
  }
  let scope;
  if (userPresent && projectPresent) scope = 'both';
  else if (projectPresent) scope = 'project';
  else scope = 'user';

  // Pin version from the *active* scope's VERSION file (no preference if both).
  const versionRoot = scope === 'project' ? projectPath : userPath;
  const versionFile = versionRoot ? join(versionRoot, '..', 'VERSION') : null;
  const version = versionFile ? safeRead(versionFile)?.trim() || null : null;

  return { installed: true, version, scope, userPath, projectPath };
}

/**
 * Caveman presence. Caveman's plugin-marketplace install lands under
 * ~/.claude/plugins/cache/caveman/; the legacy layout was a top-level
 * skill directory. We accept either as "installed".
 *
 * @param {string} homeDir
 * @returns {UpstreamPresence}
 */
function detectCaveman(homeDir) {
  if (!homeDir) return { installed: false, version: null, path: null };
  const pluginsRoot = join(homeDir, '.claude', 'plugins', 'cache', 'caveman');
  const legacyPath = join(homeDir, '.claude', 'skills', 'caveman');
  const hookPath = join(homeDir, '.claude', 'hooks', 'caveman-config.js');
  if (existsSync(pluginsRoot)) return { installed: true, version: null, path: pluginsRoot };
  if (existsSync(legacyPath)) return { installed: true, version: null, path: legacyPath };
  if (existsSync(hookPath)) return { installed: true, version: null, path: hookPath };
  return { installed: false, version: null, path: null };
}

/**
 * Probe which Claude MCP servers are already registered. `claude mcp list`
 * emits one line per MCP. Missing `claude` CLI or no MCPs returns [].
 *
 * @returns {string[]}
 */
function detectExistingMcps() {
  const out = safeExec('claude', ['mcp', 'list']);
  if (!out) return [];
  // Output shape varies by claude version. We split on newlines and take
  // the first whitespace-separated token of each non-empty line that
  // doesn't start with a heading character.
  return out
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('━') && !line.startsWith('---'))
    .map(line => line.split(/\s+/)[0])
    .filter(name => name && !name.startsWith('Name')); // Skip header rows.
}

/**
 * Which of the standard CLIs Flow knows about are present in PATH.
 *
 * @returns {string[]}
 */
function detectAvailableClis() {
  return PROBED_CLIS.filter(name => safeExec('which', [name]) !== null);
}

/**
 * Top-level entry. Runs all probes and returns a Detection.
 *
 * @param {Object} [opts]
 * @param {string} [opts.cwd]
 * @param {string} [opts.homeDir]
 * @returns {Detection}
 */
export function detect(opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const homeDir = opts.homeDir ?? process.env.HOME ?? null;

  const gitRoot = safeExec('git', ['rev-parse', '--show-toplevel'], { cwd });
  const originUrl = gitRoot ? safeExec('git', ['-C', gitRoot, 'remote', 'get-url', 'origin']) : null;

  const { pkgManager, primaryStack } = detectPkgManager(cwd);
  const framework = detectFramework(cwd);
  const hasClaudeMd = existsSync(join(cwd, 'CLAUDE.md'));
  const flowAlreadyConfigured =
    existsSync(join(cwd, '.claude', 'flow.config.yaml')) ||
    existsSync(join(cwd, 'flow.config.yaml'));

  return {
    cwd,
    gitRoot,
    originUrl,
    pkgManager,
    primaryStack,
    framework,
    hasClaudeMd,
    bmad: detectBmad(cwd),
    ecc: detectEcc(cwd, homeDir),
    caveman: detectCaveman(homeDir),
    existingMcps: detectExistingMcps(),
    availableClis: detectAvailableClis(),
    flowAlreadyConfigured,
  };
}
