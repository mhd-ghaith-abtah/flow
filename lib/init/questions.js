// lib/init/questions.js — interactive Q&A for `flow init`.
//
// Headless equivalent of step 4 of the /flow-init skill workflow. Each
// `ask*` function takes a `state` object (detection + catalog + answers
// so far) and returns the user's selection. Functions are async so they
// can be `await`ed in sequence by the orchestrator.
//
// All prompts use @inquirer/prompts. The module exports both the
// composed `askAll(state)` flow and the individual `askProfile`,
// `askIssueTracker`, etc. so tests + non-interactive call sites can
// drive one question at a time.
//
// Non-interactive override: every prompt checks `state.answers` first.
// If a caller has pre-filled an answer (e.g. via `--profile mini` or a
// config file), that prompt is skipped. This is how `flow init --yes`
// supports zero-question installs.

import { select, confirm } from '@inquirer/prompts';
import { recommendProfile, STOCK_PROFILES } from './recommendation.js';

/**
 * @typedef {Object} Answers
 * @property {string} [profile]
 * @property {string} [issueTracker]
 * @property {string} [pr]
 * @property {string} [e2e]
 * @property {string} [verify]
 * @property {string} [bmadSubset]
 * @property {string} [eccSubset]
 * @property {'user'|'project'} [eccScope]
 * @property {string} [cavemanSubset]
 * @property {'yes'|'no'|'skip'} [migrateBmad]
 * @property {'env-file'|'shell'|'1password'} [secretsStore]
 */

/**
 * @typedef {Object} QuestionState
 * @property {import('./detect.js').Detection} detection
 * @property {Object} catalog - parsed catalog.yaml (raw)
 * @property {Answers} answers - mutated as questions are answered
 */

/**
 * Pull the list of adapter ids in a given family from the catalog.
 * Returns just the bare adapter ids (e.g. ['linear', 'github-issues',
 * 'none']) so callers can show them as choices without leaking the full
 * `adapter:family-id` namespace into the prompt UI.
 */
function adaptersInFamily(catalog, family) {
  return (catalog.adapters || [])
    .filter(a => a.family === family)
    .map(a => {
      const id = a.id.startsWith('adapter:') ? a.id.slice('adapter:'.length) : a.id;
      const stripped = id.startsWith(`${family}-`) ? id.slice(family.length + 1) : id;
      return { value: stripped, full: a.id, description: a.description };
    });
}

/**
 * Pull profile-default adapter for a family (the adapter that the
 * resolved profile picks for that family). Returns the bare id (e.g.
 * 'linear') or null if the profile doesn't touch that family.
 */
function profileDefaultAdapter(catalog, profileName, family) {
  const adapters = (catalog.profiles?.[profileName]?.adapters) || [];
  for (const id of adapters) {
    const adapter = catalog.adapters.find(a => a.id === id);
    if (adapter?.family === family) {
      const stripped = adapter.id.replace(/^adapter:/, '').replace(new RegExp(`^${family}-`), '');
      return stripped;
    }
  }
  return null;
}

/**
 * Q1 — Profile selection. Pre-populates the recommended profile based
 * on detection so the user can hit Enter on the common case.
 *
 * @param {QuestionState} state
 * @returns {Promise<string>}
 */
export async function askProfile(state) {
  if (state.answers.profile) return state.answers.profile;

  const { profile: recommended, reason } = recommendProfile(state.detection);
  const choices = STOCK_PROFILES.map(name => {
    const description = state.catalog.profiles?.[name]?.description || '';
    return {
      name: name === recommended ? `${name} ⭐ (${reason})` : name,
      value: name,
      description,
    };
  });

  const picked = await select({
    message: 'Which profile do you want?',
    choices,
    default: recommended,
  });
  state.answers.profile = picked;
  return picked;
}

/**
 * Build a Q-asker for an adapter family. The factory pattern keeps
 * Q2/Q3/Q4/Q5 from each duplicating the same select + default-lookup
 * logic (they only differ in family name + prompt copy).
 */
function buildAdapterQuestion(family, prompt, answerKey) {
  return async function ask(state) {
    if (state.answers[answerKey]) return state.answers[answerKey];
    const choices = adaptersInFamily(state.catalog, family);
    if (choices.length === 0) {
      // No adapters in this family — skip silently.
      state.answers[answerKey] = 'none';
      return 'none';
    }
    const def = profileDefaultAdapter(state.catalog, state.answers.profile, family) || choices[0].value;
    const picked = await select({
      message: prompt,
      choices: choices.map(c => ({
        name: c.value === def ? `${c.value} (profile default)` : c.value,
        value: c.value,
        description: c.description,
      })),
      default: def,
    });
    state.answers[answerKey] = picked;
    return picked;
  };
}

/** Q2 — Issue tracker. */
export const askIssueTracker = buildAdapterQuestion(
  'issue-tracker',
  'Which issue tracker?',
  'issueTracker'
);

/** Q3 — PR platform. */
export const askPr = buildAdapterQuestion(
  'pr',
  'Which PR platform?',
  'pr'
);

/** Q4 — E2E driver. */
export const askE2e = buildAdapterQuestion(
  'e2e',
  'Which E2E driver?',
  'e2e'
);

/** Q5 — Verify command. */
export const askVerify = buildAdapterQuestion(
  'verify',
  'Which verify command?',
  'verify'
);

/**
 * Build an upstream-subset asker (Q6 BMad, Q7 ECC, Q7b Caveman). Reads
 * curated_subsets from the catalog and uses the profile's default subset
 * as the pre-selected option.
 */
function buildSubsetQuestion(upstream, prompt, answerKey, profileField) {
  return async function ask(state) {
    if (state.answers[answerKey]) return state.answers[answerKey];
    const subsets = state.catalog.upstreams?.[upstream]?.curated_subsets;
    if (!subsets) {
      state.answers[answerKey] = 'none';
      return 'none';
    }
    const def = state.catalog.profiles?.[state.answers.profile]?.[profileField] || 'none';
    const choices = Object.entries(subsets).map(([id, meta]) => ({
      name: id === def ? `${id} (profile default)` : id,
      value: id,
      description: meta.description || '',
    }));
    const picked = await select({
      message: prompt,
      choices,
      default: def,
    });
    state.answers[answerKey] = picked;
    return picked;
  };
}

/** Q6 — BMad subset. */
export const askBmadSubset = buildSubsetQuestion(
  'bmad',
  'Which BMad subset?',
  'bmadSubset',
  'bmad_subset'
);

/** Q7 — ECC subset. */
export const askEccSubset = buildSubsetQuestion(
  'ecc',
  'Which ECC subset?',
  'eccSubset',
  'ecc_subset'
);

/** Q7b — Caveman subset. */
export const askCavemanSubset = buildSubsetQuestion(
  'caveman',
  'Which Caveman compression mode? (Flow expects Caveman installed — cuts response tokens ~46% in / ~75% out)',
  'cavemanSubset',
  'caveman_subset'
);

/**
 * Q7c — ECC install scope. Only asked when ECC subset != none.
 * Profile default comes from resolved catalog (E7-002): team → project,
 * others → user.
 *
 * @param {QuestionState} state
 * @returns {Promise<'user'|'project'>}
 */
export async function askEccScope(state) {
  if (state.answers.eccScope) return state.answers.eccScope;
  if (state.answers.eccSubset === 'none') {
    state.answers.eccScope = 'user';
    return 'user';
  }
  const def = state.catalog.profiles?.[state.answers.profile]?.ecc_install_scope
    || state.catalog.upstreams?.ecc?.install_scope_default
    || 'user';
  const picked = await select({
    message: 'Where should ECC install? (user = ~/.claude/, project = ./.claude/)',
    choices: [
      { name: def === 'user' ? 'user (profile default)' : 'user', value: 'user',
        description: 'Lands under ~/.claude/{rules,skills}/ecc — shared across every Claude Code session on this machine' },
      { name: def === 'project' ? 'project (profile default)' : 'project', value: 'project',
        description: 'Lands under <projectRoot>/.claude/{rules,skills}/ecc — keeps each Flow-managed repo isolated' },
    ],
    default: def,
  });
  state.answers.eccScope = picked;
  return picked;
}

/**
 * Q8 — Migrate existing BMad state. Only asked when BMad is installed
 * AND a sprint-status.yaml is present.
 *
 * @param {QuestionState} state
 * @returns {Promise<'yes'|'no'|'skip'>}
 */
export async function askMigrateBmad(state) {
  if (state.answers.migrateBmad) return state.answers.migrateBmad;
  if (!state.detection.bmad.installed) {
    state.answers.migrateBmad = 'skip';
    return 'skip';
  }
  const picked = await select({
    message: 'Migrate existing BMad state to Flow?',
    choices: [
      { name: 'yes', value: 'yes',
        description: 'Import sprint-status.yaml + story files + deferred-work into docs/flow/, leave _bmad/ in place' },
      { name: 'no', value: 'no',
        description: 'Keep BMad alongside; Flow reads BMad sprint-status as fallback' },
      { name: 'skip', value: 'skip',
        description: "Don't touch BMad state" },
    ],
    default: 'yes',
  });
  state.answers.migrateBmad = picked;
  return picked;
}

/**
 * Q9 — Where to store secrets. Probes for `op` (1Password CLI) presence
 * so the option is only offered when usable.
 *
 * @param {QuestionState} state
 * @returns {Promise<'env-file'|'shell'|'1password'>}
 */
export async function askSecretsStore(state) {
  if (state.answers.secretsStore) return state.answers.secretsStore;
  const hasOp = state.detection.availableClis.includes('op');
  const choices = [
    { name: 'env-file (recommended)', value: 'env-file',
      description: '~/.claude/.env.flow — gitignored, chmod 600' },
    { name: 'shell', value: 'shell',
      description: "Print the export lines; you'll add them to your shell profile" },
  ];
  if (hasOp) {
    choices.push({ name: '1password', value: '1password', description: '1Password CLI (op) — detected in PATH' });
  }
  const picked = await select({
    message: 'Where should Flow store secrets (API tokens)?',
    choices,
    default: 'env-file',
  });
  state.answers.secretsStore = picked;
  return picked;
}

/**
 * Run the full Q&A in order. Returns the populated Answers object.
 *
 * Skip behavior: any answer pre-populated in `state.answers` is left
 * alone (the individual ask* functions short-circuit on a present
 * value). So `askAll({ detection, catalog, answers: { profile: 'mini' } })`
 * walks through Q2-Q9 with profile already locked.
 *
 * @param {QuestionState} state
 * @returns {Promise<Answers>}
 */
export async function askAll(state) {
  state.answers = state.answers || {};
  await askProfile(state);
  await askIssueTracker(state);
  await askPr(state);
  await askE2e(state);
  await askVerify(state);
  await askBmadSubset(state);
  await askEccSubset(state);
  await askEccScope(state);
  await askCavemanSubset(state);
  await askMigrateBmad(state);
  await askSecretsStore(state);
  return state.answers;
}
