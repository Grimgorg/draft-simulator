#!/usr/bin/env bash
# Blocks git commit, push and merge while main is checked out: work happens on a branch and reaches main
# only through a pull request. Claude Code passes the tool call as JSON on stdin; exit 2 blocks it.
# Tests: guard-main.test.sh
input=$(cat)

# Deleting a remote branch doesn't touch main, so `git push … --delete|-d …` is left out of the check.
checked=$(printf '%s' "$input" | sed -E 's/git push[^"&;|]* (--delete|-d)[ "][^"&;|]*//g')

# `git` counts only where a command starts: at the start of the command line or after ; & | ( ` or a newline
# (`\n` in JSON), so text that merely mentions `git commit` passes. Global options like `-C <path>` may come
# before the subcommand. Whole subcommands only: `git merge-base` is not `git merge`.
# Not caught: a git command inside a quoted string, e.g. `bash -c "git commit"`. The ruleset on GitHub still
# blocks every direct push to main.
command_start='("command" *: *"|[;&|(`]|\\n) *'
global_options='( +(-C|-c) +[^ ;&|"]+| +-[-A-Za-z]+(=[^ ;&|"]*)?)*'
if ! printf '%s' "$checked" | grep -Eq "${command_start}git${global_options} +(commit|push|merge)([^A-Za-z0-9-]|\$)"; then
  exit 0
fi

branch=$(git -C "${CLAUDE_PROJECT_DIR:-.}" branch --show-current 2>/dev/null)
if [ "$branch" = "main" ]; then
  echo "Blocked: you are on main. Create a branch first (feat/<desc>, fix/<desc> or chore/<desc>), as a separate command." >&2
  exit 2
fi
exit 0
