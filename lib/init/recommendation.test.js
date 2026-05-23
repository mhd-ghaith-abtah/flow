// lib/init/recommendation.test.js — coverage for profile recommendation.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { recommendProfile, STOCK_PROFILES } from './recommendation.js';

/**
 * Build a Detection stub with sensible empty defaults. Tests override
 * only the fields they care about.
 */
function stub(overrides = {}) {
  return {
    cwd: '/tmp/proj',
    gitRoot: null,
    originUrl: null,
    pkgManager: null,
    primaryStack: null,
    framework: null,
    hasClaudeMd: false,
    bmad: { installed: false, version: null, path: null },
    ecc: { installed: false, version: null, scope: null, userPath: null, projectPath: null },
    caveman: { installed: false, version: null, path: null },
    existingMcps: [],
    availableClis: [],
    flowAlreadyConfigured: false,
    ...overrides,
  };
}

describe('recommendProfile', () => {
  it('returns one of the stock profiles', () => {
    const { profile } = recommendProfile(stub());
    assert.ok(STOCK_PROFILES.includes(profile), `${profile} not in ${STOCK_PROFILES}`);
  });

  it('bare project → minimal', () => {
    const { profile, reason } = recommendProfile(stub());
    assert.equal(profile, 'minimal');
    assert.match(reason, /no git/);
  });

  it('Linear MCP registered → team', () => {
    const { profile, reason } = recommendProfile(stub({
      gitRoot: '/tmp/proj', pkgManager: 'npm', existingMcps: ['linear'],
    }));
    assert.equal(profile, 'team');
    assert.match(reason, /Linear MCP/);
  });

  it('Playwright MCP + framework → standard', () => {
    const { profile } = recommendProfile(stub({
      gitRoot: '/tmp/proj', pkgManager: 'pnpm', framework: 'next',
      existingMcps: ['playwright'],
    }));
    assert.equal(profile, 'standard');
  });

  it('pkg manager but no framework → mini', () => {
    const { profile, reason } = recommendProfile(stub({
      gitRoot: '/tmp/proj', pkgManager: 'cargo', primaryStack: 'rust',
    }));
    assert.equal(profile, 'mini');
    assert.match(reason, /cargo project/);
  });

  it('pkg manager + framework but no Playwright MCP → mini (not standard)', () => {
    // Standard requires *both* Playwright MCP and a framework — having
    // just the framework isn't a strong enough signal to upgrade.
    const { profile } = recommendProfile(stub({
      gitRoot: '/tmp/proj', pkgManager: 'pnpm', framework: 'react',
    }));
    assert.equal(profile, 'mini');
  });

  it('falls through to standard when no signals match', () => {
    // gitRoot present but no pkgManager → no minimal trigger, no team
    // trigger, no playwright, no pkgManager → standard fallback.
    const { profile, reason } = recommendProfile(stub({
      gitRoot: '/tmp/proj',
    }));
    assert.equal(profile, 'standard');
    assert.match(reason, /no strong signals/);
  });
});
