#!/usr/bin/env bash
# tools/fix-caveman-shrink.sh — print the commands needed to fix a broken
# caveman-shrink MCP registration.
#
# Background: caveman-shrink is an MCP *proxy* — it must wrap an upstream MCP
# server (passed as extra command-line args). The Caveman installer sometimes
# registers it standalone (no upstream args), which crashes the proxy on first
# call with the error "-32000: server failed to start" because index.js exits
# immediately at the "missing upstream command" guard.
#
# This script does NOT execute `claude mcp` for you — modifying MCP
# registration affects every Claude Code session, so we print the exact
# commands and let you run them yourself.
#
# Usage:
#   tools/fix-caveman-shrink.sh                  # wraps context7 (default)
#   tools/fix-caveman-shrink.sh playwright       # wrap a known preset
#   tools/fix-caveman-shrink.sh 'npx -y @org/x'  # pass full upstream command

set -euo pipefail

UPSTREAM="${1:-context7}"

# Bash 3.2 (macOS default) doesn't support associative arrays — use case.
case "$UPSTREAM" in
  context7)
    UPSTREAM_CMD="npx -y @upstash/context7-mcp@latest"
    ;;
  playwright)
    UPSTREAM_CMD="npx -y @playwright/mcp@latest"
    ;;
  filesystem)
    UPSTREAM_CMD="npx -y @modelcontextprotocol/server-filesystem $HOME"
    ;;
  *)
    # Treat as a literal upstream command.
    UPSTREAM_CMD="$UPSTREAM"
    UPSTREAM="(custom)"
    ;;
esac

cat <<EOF
━━━ fix-caveman-shrink ━━━

caveman-shrink is registered standalone (no upstream wrap) — it will crash with
\`-32000: server failed to start\` on the first call.

To fix, run these two commands yourself (they modify your Claude Code MCP
registration globally — review them before executing):

  1. Remove the broken registration:

       claude mcp remove caveman-shrink

  2. Re-add it as a wrapper around '${UPSTREAM}' (${UPSTREAM_CMD}):

       claude mcp add caveman-shrink -- npx caveman-shrink ${UPSTREAM_CMD}

Verify:

       claude mcp get caveman-shrink

The fixed registration should show 'caveman-shrink' followed by the upstream
command. Restart Claude Code if MCP isn't picked up.

Known upstream presets: context7, playwright, filesystem.
Or pass the full upstream command as a single arg.
EOF
