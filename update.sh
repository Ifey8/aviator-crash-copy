#!/usr/bin/env bash
# update.sh — root-level shortcut. Just calls infra/update.sh with all flags
# passed through. Saves typing the path every time.
#
#   ssh easyenglish
#   cd /opt/aviator
#   ./update.sh                          # full update
#   ./update.sh --skip-frontend          # backend only
#   ./update.sh --skip-backup            # skip mongodump
#
# All flags + tunables are documented in infra/update.sh.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/infra/update.sh" "$@"
