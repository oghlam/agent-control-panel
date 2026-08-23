#!/usr/bin/env bash
set -euo pipefail

# This script prepares and deploys the backend image. It never reads a local
# .env file; provide deployment values through the environment or flags so
# secrets cannot be accidentally baked into the image.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ID="${PROJECT_ID:-acp-hackathon-2026-505906}"
REGION="${CLOUD_RUN_REGION:-us-central1}"
SERVICE="${CLOUD_RUN_SERVICE:-acp-backend}"
REPOSITORY="${ARTIFACT_REGISTRY_REPOSITORY:-acp}"
IMAGE_NAME="${ARTIFACT_IMAGE_NAME:-agent-control-plane}"
MODEL="${MODEL:-gemini-3.5-flash}"
VERTEX_BASE_URL="${VERTEX_BASE_URL:-https://aiplatform.us.rep.googleapis.com}"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}"
ADMIN_EMAILS="${ADMIN_EMAILS:-}"
FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-http://localhost:3000}"
RATE_LIMIT_BACKEND="${RATE_LIMIT_BACKEND:-firestore}"
RUNTIME_SERVICE_ACCOUNT="${CLOUD_RUN_SERVICE_ACCOUNT:-}"

usage() {
  cat <<'EOF'
Usage: scripts/deploy-cloud-run.sh [--skip-build] [--no-traffic]

Required before a real deployment:
  gcloud auth login
  gcloud config set project <project-id>
  GOOGLE_CLIENT_ID=<web-client-id>

Optional environment variables:
  PROJECT_ID, CLOUD_RUN_REGION, CLOUD_RUN_SERVICE, FRONTEND_ORIGIN, ADMIN_EMAILS, RATE_LIMIT_BACKEND
  ARTIFACT_REGISTRY_REPOSITORY, ARTIFACT_IMAGE_NAME
  ARTIFACT_IMAGE (use with --skip-build)
  CLOUD_RUN_SERVICE_ACCOUNT, MODEL, VERTEX_BASE_URL
EOF
}

BUILD_IMAGE=1
NO_TRAFFIC=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) BUILD_IMAGE=0 ;;
    --no-traffic) NO_TRAFFIC=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI is required." >&2
  exit 1
fi
if [[ -z "${GOOGLE_CLIENT_ID}" ]]; then
  echo "GOOGLE_CLIENT_ID must be set; it is passed as public runtime configuration." >&2
  exit 1
fi

IMAGE="${ARTIFACT_IMAGE:-${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_NAME}:$(date -u +%Y%m%d-%H%M%S)}"
cd "${ROOT_DIR}"

if ! gcloud artifacts repositories describe "${REPOSITORY}" \
  --project "${PROJECT_ID}" --location "${REGION}" >/dev/null 2>&1; then
  echo "Creating Artifact Registry repository ${REPOSITORY} in ${REGION}..."
  gcloud artifacts repositories create "${REPOSITORY}" \
    --project "${PROJECT_ID}" \
    --location "${REGION}" \
    --repository-format docker \
    --description "Agent Control Plane container images"
fi

if [[ "${BUILD_IMAGE}" == "1" ]]; then
  gcloud builds submit \
    --project "${PROJECT_ID}" \
    --config cloudbuild.yaml \
    --substitutions="_IMAGE=${IMAGE}" \
    .
fi

DEPLOY_ARGS=(
  run deploy "${SERVICE}"
  --project "${PROJECT_ID}"
  --region "${REGION}"
  --image "${IMAGE}"
  --platform managed
  --port 8080
  --cpu 1
  --memory 1Gi
  --min 0
  --max 3
  --timeout 300
  --set-env-vars "^|^GOOGLE_CLOUD_PROJECT=${PROJECT_ID}|PROJECT_ID=${PROJECT_ID}|REGION=us|MODEL=${MODEL}|VERTEX_BASE_URL=${VERTEX_BASE_URL}|GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}|ADMIN_EMAILS=${ADMIN_EMAILS}|FRONTEND_ORIGIN=${FRONTEND_ORIGIN}|RATE_LIMIT_BACKEND=${RATE_LIMIT_BACKEND}|PYTHONUNBUFFERED=1"
  --quiet
)

if [[ -n "${RUNTIME_SERVICE_ACCOUNT}" ]]; then
  DEPLOY_ARGS+=(--service-account "${RUNTIME_SERVICE_ACCOUNT}")
fi
if [[ "${NO_TRAFFIC}" == "1" ]]; then
  DEPLOY_ARGS+=(--no-traffic)
fi

gcloud "${DEPLOY_ARGS[@]}"
echo "Deployed ${SERVICE} using ${IMAGE}"
