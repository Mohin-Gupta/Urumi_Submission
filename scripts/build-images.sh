#!/usr/bin/env bash
# Builds our images. No argument: import into k3d. With a registry prefix: push there.
set -euo pipefail
cd "$(dirname "$0")/.."
REGISTRY="${1:-}"

for image in $(grep -o 'urumi/[a-z-]*:[0-9.]*' charts/platform/values.yaml); do
  name="${image#urumi/}"
  name="${name%%:*}"
  docker build -t "$REGISTRY$image" "apps/${name%-mcp}"
  if [ -n "$REGISTRY" ]; then
    docker push "$REGISTRY$image"
  else
    k3d image import "$image" -c urumi
  fi
done
