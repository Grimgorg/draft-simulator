#!/usr/bin/env bash
# Tests for guard-main.sh: runs the hook against a throwaway git repository and checks which commands it blocks.
set -euo pipefail

hook="$(cd "$(dirname "$0")" && pwd)/guard-main.sh"
repo=$(mktemp -d)
trap 'rm -rf "$repo"' EXIT
git -C "$repo" init -q -b main
failures=0

# expect <blocked|allowed> <command>
expect() {
  local status=0
  printf '{"tool_input":{"command":"%s"}}' "$2" | CLAUDE_PROJECT_DIR="$repo" "$hook" 2>/dev/null || status=$?
  local result=allowed
  [ "$status" = 2 ] && result=blocked
  if [ "$result" = "$1" ]; then
    echo "ok   $1: $2"
  else
    echo "FAIL expected $1, got $result: $2"
    failures=$((failures + 1))
  fi
}

# On main
expect blocked 'git commit -m x'
expect blocked 'git push'
expect blocked 'git push origin main'
expect blocked 'git merge feat/x'
expect blocked 'git add . && git commit -m x'
expect blocked 'git push origin --delete feat/x && git push origin main'
expect blocked 'git -C . commit -m x'
expect blocked 'git -c user.name=x commit -m x'
expect blocked 'git --no-pager push'
expect blocked 'cd x; git commit -m x'
expect blocked '(cd x && git push)'
expect blocked 'git status | cat || git merge feat/x'
expect blocked 'cd x\ngit commit -m x'
expect allowed 'git status'
expect allowed "grep -rn 'git commit' docs"
expect allowed "echo 'never git push on main'"
expect allowed 'git merge-base main feat/x'
expect allowed 'git push origin --delete feat/x'
expect allowed 'git push origin -d feat/x'

# On a branch
git -C "$repo" checkout -q -b feat/x
expect allowed 'git commit -m x'
expect allowed 'git push -u origin feat/x'

[ "$failures" = 0 ] || { echo "$failures failed"; exit 1; }
