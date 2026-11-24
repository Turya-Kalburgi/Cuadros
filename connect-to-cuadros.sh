#!/usr/bin/env bash
set -euo pipefail

EXPECTED_REMOTE="https://github.com/Turya-Kalburgi/cuadros.git"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not inside a Git repository."
  exit 1
fi

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$EXPECTED_REMOTE"
else
  git remote add origin "$EXPECTED_REMOTE"
fi

git remote -v
git ls-remote origin HEAD

echo "SUCCESS: cuadros remote configured."
