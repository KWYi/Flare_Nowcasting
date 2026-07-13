#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/push_json.sh /absolute/path/to/server/json/output
#
# The source directory must contain:
#   latest_X-ray_60m.json
#   latest_state.json
#   latest_flare.json
#   prediction.json
#   flare_list.json

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /absolute/path/to/json/source-directory" >&2
  exit 1
fi

SOURCE_DIR="$1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$REPO_ROOT/data"
FILES=(
  "latest_X-ray_60m.json"
  "latest_state.json"
  "latest_flare.json"
  "prediction.json"
  "flare_list.json"
)

for file in "${FILES[@]}"; do
  if [[ ! -f "$SOURCE_DIR/$file" ]]; then
    echo "Missing source file: $SOURCE_DIR/$file" >&2
    exit 1
  fi
  cp "$SOURCE_DIR/$file" "$DATA_DIR/$file"
done

cd "$REPO_ROOT"
git add data/*.json

if git diff --cached --quiet; then
  echo "No JSON changes to push."
  exit 0
fi

git commit -m "Update real-time flare data $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
git push
