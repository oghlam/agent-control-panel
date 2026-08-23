# Cloud Run deployment runbook

The backend image is built from the repository root with `backend/Dockerfile`.
It uses a multi-stage Python 3.12 build, runs as a non-root user, and starts
`backend.main:app` on Cloud Run's injected `PORT`.

## Local verification

```bash
./scripts/verify-container.sh
```

This builds `acp-backend:local` and checks the packaged FastAPI import. It does
not contact Vertex AI or Firestore.

## Deploy

```bash
export GOOGLE_CLIENT_ID="your-web-client-id.apps.googleusercontent.com"
export ADMIN_EMAILS="admin@example.com"
export CLOUD_RUN_SERVICE_ACCOUNT="acp-runtime@acp-hackathon-2026-505906.iam.gserviceaccount.com"
export FRONTEND_ORIGIN="https://your-frontend.example.com"
export RATE_LIMIT_BACKEND="firestore"
./scripts/deploy-cloud-run.sh
```

The script creates the Artifact Registry repository when needed, uses
`cloudbuild.yaml` to build and push the image, then runs `gcloud run deploy`.
Use `--no-traffic` for a revision preflight. Use `--skip-build` with
`ARTIFACT_IMAGE` to deploy an existing image.

The Cloud Run runtime service account must have:

- `roles/aiplatform.user` for Vertex AI;
- `roles/datastore.user` for Firestore.

Firestore uses Cloud Run Application Default Credentials. No service-account
JSON or client secret is copied into the image. The default Cloud Run region is
`us-central1`; Vertex is configured separately with region `us` and
`https://aiplatform.us.rep.googleapis.com`.

`RATE_LIMIT_BACKEND=firestore` stores sliding-window timestamps in the shared
`gateway_rate_limits` Firestore collection and uses transactions for atomic
acquire operations across Cloud Run instances. Local development defaults to
`RATE_LIMIT_BACKEND=memory`; distributed mode fails closed if Firestore is
unavailable instead of silently reverting to a per-instance quota.
