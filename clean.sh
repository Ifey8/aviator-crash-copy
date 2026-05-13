#!/usr/bin/env bash
# clean.sh — root-level shortcut. Just calls infra/clean.sh.
#
#   ssh easyenglish
#   cd /opt/aviator
#   ./clean.sh                  # normal cleanup
#   ./clean.sh --aggressive     # also prune ALL unused images + volumes
#
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/infra/clean.sh" "$@"
