#!/usr/bin/env bash
# tools/dev-link.sh — Mount Flow's dev tree into ~/.claude/skills/ via symlinks
# so Claude Code picks up the live source. Run from the repo root.
#
# Usage:
#   tools/dev-link.sh           # link
#   tools/dev-link.sh --unlink  # remove links and restore
#
# After linking, /flow init / /flow-sprint / /flow-story work in any Claude Code
# session against this dev tree. Re-running this script is idempotent.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_SKILLS="$HOME/.claude/skills"

mode="link"
if [[ "${1:-}" == "--unlink" ]]; then
  mode="unlink"
fi

skills=(flow-init flow-sprint flow-story)

unlink_skill() {
  local skill="$1"
  local target="$CLAUDE_SKILLS/$skill"
  if [[ -L "$target" ]]; then
    rm "$target"
    echo "  unlinked $target"
  elif [[ -d "$target" ]]; then
    # It's a real dir we created (mounted view) — remove it
    rm -rf "$target"
    echo "  removed mounted view $target"
  fi
}

link_skill() {
  local skill="$1"
  local src="$REPO_ROOT/skills/$skill"
  local target="$CLAUDE_SKILLS/$skill"

  # Clean any prior mount
  unlink_skill "$skill"

  # Create the mount-dir and populate it with symlinks. We use a "real dir
  # with inner symlinks" pattern so we can add adapters/, templates/, and
  # catalog.yaml inside it without modifying the dev repo's layout.
  mkdir -p "$target"
  ln -sf "$src/SKILL.md"     "$target/SKILL.md"
  ln -sf "$src/workflow.md"  "$target/workflow.md"
  ln -sf "$REPO_ROOT/catalog.yaml" "$target/catalog.yaml"

  case "$skill" in
    flow-init)
      ln -sf "$REPO_ROOT/templates" "$target/templates"
      ;;
    flow-story)
      ln -sf "$REPO_ROOT/adapters"  "$target/adapters"
      ln -sf "$REPO_ROOT/templates" "$target/templates"
      ;;
    flow-sprint)
      ln -sf "$REPO_ROOT/adapters"  "$target/adapters"
      ln -sf "$REPO_ROOT/templates" "$target/templates"
      ;;
  esac

  echo "  linked $skill → $src"
}

mkdir -p "$CLAUDE_SKILLS"

if [[ "$mode" == "unlink" ]]; then
  echo "Unlinking Flow dev mounts:"
  for skill in "${skills[@]}"; do
    unlink_skill "$skill"
  done
  echo "Done. Run tools/dev-link.sh to re-link."
else
  echo "Linking Flow dev tree into $CLAUDE_SKILLS:"
  for skill in "${skills[@]}"; do
    link_skill "$skill"
  done
  echo
  echo "Done. Try:"
  echo "  - /flow help          (inside Claude Code)"
  echo "  - /flow init          (in a target project's dir)"
  echo "  - /flow-sprint status (anywhere Flow is configured)"
fi
