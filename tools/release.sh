#!/usr/bin/env bash
# tools/release.sh — cut a Flow release.
#
# What it does (in order, all idempotent up to the tag push):
#   1. Sanity: working tree clean, on main, up to date with origin/main
#   2. Verify: npm test + smoke
#   3. CHANGELOG: move `## [Unreleased]` block under `## [<new-version>] — <date>`
#   4. Bump package.json version
#   5. Commit + tag + (optionally) push
#
# Does NOT run `npm publish` — that's a separate manual step after the tag
# pushes and CI passes.
#
# Usage:
#   tools/release.sh patch       # 0.0.1 → 0.0.2
#   tools/release.sh minor       # 0.0.1 → 0.1.0
#   tools/release.sh major       # 0.0.1 → 1.0.0
#   tools/release.sh 0.7.0       # explicit version
#   tools/release.sh patch --no-push   # don't push tag
#   tools/release.sh patch --dry-run   # print what would happen

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# --- Args -------------------------------------------------------------------
BUMP="${1:-}"
shift || true

DRY_RUN=0
PUSH=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-push) PUSH=0 ;;
    *) echo "Unknown flag: $arg"; exit 2 ;;
  esac
done

if [[ -z "$BUMP" ]]; then
  cat <<EOF
Usage: tools/release.sh <bump|version> [--dry-run] [--no-push]
  bump:    patch | minor | major
  version: explicit version like 0.7.0
EOF
  exit 2
fi

# --- Sanity checks ----------------------------------------------------------
say() { echo "▸ $*"; }
run() { if [[ $DRY_RUN -eq 1 ]]; then echo "  (dry-run) $*"; else eval "$*"; fi; }

say "Sanity: working tree clean?"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "  ✗ Working tree has uncommitted changes. Commit or stash first."
  exit 1
fi

say "Sanity: on main branch?"
branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" != "main" ]]; then
  echo "  ✗ On branch '$branch', not 'main'. Switch first."
  exit 1
fi

say "Sanity: up to date with origin/main?"
git fetch origin main --quiet
local_sha="$(git rev-parse HEAD)"
remote_sha="$(git rev-parse origin/main)"
if [[ "$local_sha" != "$remote_sha" ]]; then
  echo "  ✗ Local main differs from origin/main. Pull or push first."
  exit 1
fi

# --- Verify -----------------------------------------------------------------
say "Verify: npm test"
run "npm test"

say "Verify: flow plan smoke"
run "node bin/flow.js plan --profile standard --json > /dev/null"

# --- Compute new version ----------------------------------------------------
current="$(node -p "require('./package.json').version")"
case "$BUMP" in
  patch|minor|major)
    new_version="$(node -e "
      const [maj, min, pat] = '$current'.split('.').map(Number);
      const b = '$BUMP';
      if (b === 'patch') console.log(\`\${maj}.\${min}.\${pat + 1}\`);
      else if (b === 'minor') console.log(\`\${maj}.\${min + 1}.0\`);
      else console.log(\`\${maj + 1}.0.0\`);
    ")"
    ;;
  [0-9]*.[0-9]*.[0-9]*)
    new_version="$BUMP"
    ;;
  *)
    echo "  ✗ Invalid bump/version: $BUMP"
    exit 2
    ;;
esac

say "Version: $current → $new_version"

# --- CHANGELOG --------------------------------------------------------------
today="$(date -u +%Y-%m-%d)"
say "CHANGELOG: move [Unreleased] → [$new_version] — $today"
if grep -q "^## \[Unreleased\]$" CHANGELOG.md; then
  if [[ $DRY_RUN -eq 0 ]]; then
    # Insert new dated heading after Unreleased, then ensure empty Unreleased
    # block remains for future entries.
    node -e "
      const fs = require('fs');
      const path = 'CHANGELOG.md';
      let txt = fs.readFileSync(path, 'utf-8');
      const marker = '## [Unreleased]';
      const idx = txt.indexOf(marker);
      if (idx === -1) { console.error('No Unreleased section'); process.exit(1); }
      const before = txt.slice(0, idx);
      const after = txt.slice(idx + marker.length);
      const newSection = '## [Unreleased]\n\n## [$new_version] — $today' + after;
      fs.writeFileSync(path, before + newSection);
    "
    echo "  ✓ CHANGELOG.md updated"
  else
    echo "  (dry-run) would rewrite CHANGELOG.md"
  fi
else
  echo "  ⚠ No '## [Unreleased]' section found; skipping CHANGELOG bump."
fi

# --- package.json bump ------------------------------------------------------
say "package.json: bump version to $new_version"
if [[ $DRY_RUN -eq 0 ]]; then
  npm version "$new_version" --no-git-tag-version --allow-same-version > /dev/null
  echo "  ✓ package.json updated"
else
  echo "  (dry-run) would run: npm version $new_version --no-git-tag-version"
fi

# --- Commit + tag -----------------------------------------------------------
say "Commit + tag v$new_version"
if [[ $DRY_RUN -eq 0 ]]; then
  git add CHANGELOG.md package.json package-lock.json 2>/dev/null || git add CHANGELOG.md package.json
  git commit -m "chore: release v$new_version"
  git tag "v$new_version"
  echo "  ✓ Committed and tagged"
else
  echo "  (dry-run) would commit + tag v$new_version"
fi

# --- Push -------------------------------------------------------------------
if [[ $PUSH -eq 1 ]]; then
  say "Push main + tag"
  run "git push origin main"
  run "git push origin v$new_version"
else
  say "Skipping push (--no-push). Run: git push origin main && git push origin v$new_version"
fi

echo
echo "━━━ Release v$new_version staged ━━━"
echo
echo "Next steps:"
echo "  1. Wait for CI to pass on the tagged commit"
echo "  2. (If npm publish ready) npm publish --access public"
echo "  3. Create GitHub release notes from the CHANGELOG entry"
