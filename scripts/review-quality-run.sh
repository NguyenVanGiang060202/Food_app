#!/usr/bin/env bash
# One-shot full quality pipeline for the production database.
#
# Runs, in order, on the VPS via docker compose:
#   1. review-refresh  : re-open every place URL, scroll-collect up to N reviews,
#                        and refresh full details (phone/website/price/images/
#                        review_count) through the canonical upsert pipeline.
#   2. enrich-ai --refresh : regenerate AI semantic profiles from the fresh reviews.
#   3. embed --refresh     : re-embed profiles whose search document changed.
#
# Usage (single command):
#   nohup bash scripts/review-quality-run.sh > /var/log/review-quality-run.log 2>&1 &
#
# Tuning (all optional, sensible defaults for a ~20h VPS window):
#   REVIEW_LIMIT                  how many places to refresh (default: all)
#   REVIEW_THRESHOLD              refresh places with fewer than N reviews (default 20)
#   CRAWL_MAX_REVIEWS_PER_PLACE   reviews pulled per place, capped at 20
#   CRAWL_CONCURRENCY             parallel browsers during review-refresh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

export CRAWL_CITY="${CRAWL_CITY:-Ho Chi Minh City}"
export CRAWL_MAX_REVIEWS_PER_PLACE="${CRAWL_MAX_REVIEWS_PER_PLACE:-20}"
export CRAWL_CONCURRENCY="${CRAWL_CONCURRENCY:-3}"
export CRAWL_DELAY_MS="${CRAWL_DELAY_MS:-2500}"
export REVIEW_REFRESH_THRESHOLD="${REVIEW_REFRESH_THRESHOLD:-20}"

REVIEW_LIMIT="${REVIEW_REFRESH_LIMIT:-${REVIEW_LIMIT:-}}"

log() { printf '%s\n' "[$(date -Is)] $*"; }
run_compose() {
  local script="$1"; shift
  docker compose --profile production run --rm \
    --entrypoint "node crawler/dist/cli/$script.js" crawler "$@"
}

log "=== STEP 0: build crawler ==="
docker compose --profile production build crawler

log "=== STEP 1: review refresh (all candidates) ==="
REVIEW_ARGS=()
if [ -n "$REVIEW_LIMIT" ]; then
  REVIEW_ARGS+=(--limit "$REVIEW_LIMIT")
fi
run_compose review-refresh "${REVIEW_ARGS[@]}"
log "review-refresh finished."

log "=== STEP 2: AI semantic profiles (--refresh, all restaurants) ==="
run_compose enrich-ai --refresh
log "enrich-ai finished."

log "=== STEP 3: re-embed changed documents (--refresh, all) ==="
run_compose embed --refresh
log "embed finished."

log "=== ALL STEPS COMPLETED ==="