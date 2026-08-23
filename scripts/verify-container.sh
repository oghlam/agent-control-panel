#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${IMAGE_NAME:-acp-backend:local}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for local container verification." >&2
  exit 1
fi

cd "${ROOT_DIR}"
echo "Building ${IMAGE_NAME} from the repository root..."
docker build --pull -f backend/Dockerfile -t "${IMAGE_NAME}" .

echo "Checking the packaged FastAPI import..."
docker run --rm --entrypoint python "${IMAGE_NAME}" -c \
  'from backend.main import app; assert app.title == "Agent Control Plane"; print("CONTAINER_IMPORT_OK")'

echo "Container verification passed: ${IMAGE_NAME}"
