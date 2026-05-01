#!/usr/bin/env bash
# Apply 20260430000001_add_asset_code_to_classes to staging and production
# Run ONLY after validating on dev branch.
#
# Usage:
#   ./apply_to_branches.sh staging
#   ./apply_to_branches.sh production
#   ./apply_to_branches.sh all

set -euo pipefail

PSQL=/opt/homebrew/opt/libpq/bin/psql
MIGRATION_FILE="$(dirname "$0")/migration.sql"

STAGING_CONN=$(neonctl connection-string --branch staging 2>/dev/null)
PROD_CONN=$(neonctl connection-string --branch production 2>/dev/null)

apply() {
  local label=$1
  local conn=$2
  echo "==> Applying to $label ..."
  $PSQL "$conn" -f "$MIGRATION_FILE"
  echo "==> Done: $label"
}

case "${1:-}" in
  staging)
    apply staging "$STAGING_CONN"
    ;;
  production)
    apply production "$PROD_CONN"
    ;;
  all)
    apply staging "$STAGING_CONN"
    apply production "$PROD_CONN"
    ;;
  *)
    echo "Usage: $0 staging|production|all"
    exit 1
    ;;
esac
