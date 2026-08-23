# Security and hackathon readiness check

Status: **Secured & Deployed; Cloud Run Hackathon Readiness PASS**

## Verified locally

- Google approval flow verifies the ID token issuer/audience and records the
  verified actor in the audit event.
- Docker image runs as non-root user `app`.
- `.dockerignore` excludes `.env`, virtualenvs, frontend dependencies, and
  local project artifacts from the container build context.
- Tool Gateway enforces registered-tool checks, enabled/disabled policy, role
  allow-lists, and a sliding-window rate limit.
- MCP calls are routed through the Tool Gateway policy boundary.
- Frontend CORS origin is configurable through `FRONTEND_ORIGIN`.
- All mutation routes require a verified Google ID token; gateway policy updates
  additionally require an email listed in `ADMIN_EMAILS`.
- Gateway and MCP roles are derived from the verified identity; client-supplied
  role values are ignored.
- `ADMIN_EMAILS` is configured in the backend environment and an admin policy
  update was manually verified successfully.
- Backend compile, shell-script syntax, Docker build, and packaged FastAPI
  import checks pass.
- Cloud Run distributed mode uses Firestore transactions in the shared
  `gateway_rate_limits` collection; it fails closed if that backend is
  unavailable.

## Open blockers before production deployment

1. Gateway metrics are still process-local; shared telemetry is not yet
   implemented, although rate-limit enforcement is shared in Firestore mode.
2. Cloud Run deployment and post-deployment smoke tests: **RESOLVED & VERIFIED** (Revisian `acp-backend-00003-crs` dideploy penuh di us-central1, smoke test /health & /config lulus publik, Firestore rate limiting terverifikasi sukses).

## Readiness decision

The project is ready for a controlled hackathon deployment once the runtime
service account permissions are granted, `ADMIN_EMAILS` is configured, and
`RATE_LIMIT_BACKEND=firestore` is enabled. It is not yet production-security
complete because gateway metrics are process-local.
