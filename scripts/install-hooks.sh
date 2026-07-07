#!/usr/bin/env bash
# Install git hooks for this project
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

cp "$SCRIPT_DIR/pre-commit" "$REPO_DIR/.git/hooks/pre-commit"
chmod +x "$REPO_DIR/.git/hooks/pre-commit"
echo "✓ Pre-commit hook installed"
