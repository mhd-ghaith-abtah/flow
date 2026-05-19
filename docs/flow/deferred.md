# Deferred work

Items raised during the v0.6.1 review that are intentionally NOT in the current sprint. Either out of scope, blocked on upstream, or duplicate.

## Caveman global scope follow-up

E2-006 + E4-005 land via upstream Caveman PR #407 plus Flow's `.caveman-enable` marker. Until the PR merges, the local install carries the patch (backups at `~/.claude/hooks/caveman-*.pre-scope-patch`). Once it merges, re-running the Caveman installer drops the local patch back to pristine.

## Upstream version pinning — repair flow

E3-003 records pinned versions but Flow does NOT yet have a `--repair-upstream <name>` flag to reinstall the pinned version after drift. Doctor probe surfaces drift; remediation is manual. Defer until first user actually hits drift.

## CHANGELOG line-length CI

CONTRIBUTING.md says "one-line entries". No enforcement. Defer until someone writes a 5-paragraph entry that ages badly.

## Multi-repo support for `team` profile

Catalog declares `features.multi_repo: true` for `team` profile but no actual multi-repo logic exists. Flow currently writes sprint.yaml to one project. Defer until first multi-repo user.
