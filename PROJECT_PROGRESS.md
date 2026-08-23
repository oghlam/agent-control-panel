# Agent Control Plane - Project Progress and Agent Handoff

Last updated: 2026-08-20
Workdir: /home/blaz/www/agent-control-plane

## 1. Project identity

- Project: Agent Control Plane
- Hackathon track: Taskmaster / Multi-step Autonomous Workflow
- GCP project: acp-hackathon-2026-505906
- GCP account used during setup: al mantab / Google account configured locally
- Backend: FastAPI, Python 3.12, Uvicorn
- Frontend: Next.js, TypeScript, Tailwind-style custom CSS
- AI runtime: Google ADK with Gemini 3.5 Flash through Vertex AI
- Database: Firestore
- Region: us
- Frontend style reference: BuzLab-inspired restrained dark enterprise dashboard

## 2. Current product purpose

ACP is a control plane for autonomous workflows. A human can:

1. Create an execution.
2. Review an execution waiting for approval.
3. Approve or reject it with Google identity.
4. Let the ADK Gemini runner execute the approved task.
5. Monitor status and result.
6. Open an audit trace showing lifecycle events and the human actor.

The dashboard is intentionally compact. Do not expand it with speculative panels or extra navigation.

## 3. Completed implementation

### Backend and runtime

- FastAPI application is running.
- Health and root endpoints are available.
- Execution lifecycle is implemented:
  - QUEUED
  - RUNNING
  - WAITING_APPROVAL
  - COMPLETED
  - FAILED
  - CANCELLED
- Firestore stores executions.
- Firestore stores audit events under:
  `executions/{execution_id}/events`
- Google ADK 2.7.1 is installed and used through Agent, Runner, and InMemorySessionService.
- Live ADK smoke test passed with `ADK_LIVE_OK`.
- Approval gate prevents Gemini execution before human approval.
- Approved execution starts the background runner.
- Rejected execution becomes CANCELLED.

### Tool Gateway, Policy & Rate Limiting Engine

- Implemented `backend/gateway.py` containing thread-safe `SlidingWindowRateLimiter` and `ToolGateway`.
- Enforces role-based access control (RBAC), risk classification (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`), and sliding window rate limits on every tool invocation.
- Google ADK agent tools in `backend/agent.py` (`check_inventory`, `get_customer_details`, `update_customer_crm`, `generate_quotation`, `send_quotation_email`, `query_system_metrics`) are routed through `gateway.execute(...)`.
- Endpoints exposed in FastAPI:
  - `GET /api/gateway/tools`: List registered tools, policies, risk levels, and rate limits.
  - `GET /api/gateway/metrics`: Telemetry and sliding window invocation history.
  - `POST /api/gateway/execute`: Direct gateway tool execution with RBAC role check and rate limit enforcement.
  - `PATCH /api/gateway/policies/{tool_name}`: Dynamic policy configuration (enabled status, rate limits).
- Frontend tab navigation in `frontend/app/page.tsx` supporting seamless toggle between "Overview" and "Tool Gateway".
- Interactive Tool Gateway console in frontend for running test tool calls with different RBAC roles and JSON payloads.
- Verified with unit tests (`TestClient`) and Next.js production build (`npm run build`).

### Model Context Protocol (MCP) Standard Ecosystem

- Implemented `backend/mcp.py` providing standardized Model Context Protocol tools definition, server registry, and JSON-RPC 2.0 execution layer.
- Registered 4 distinct MCP Servers with strictly typed JSON Schema input contracts:
  - **Inventory Server (`inventory`)**: `inventory_check_stock`, `inventory_reserve_stock`
  - **CRM Server (`crm`)**: `crm_lookup_customer`, `crm_update_lead`
  - **Email Server (`email`)**: `email_send_quote`
  - **GCP Monitoring Server (`gcp`)**: `gcp_metrics_query`
- Integrated MCP Registry directly into the **Tool Gateway security engine** (`backend/gateway.py`) ensuring every MCP tool execution enforces RBAC roles (`agent`, `admin`), policy validation, risk classification, and sliding-window rate limiting.
- Endpoints exposed in FastAPI (`backend/main.py`):
  - `GET /api/mcp/servers`: List registered MCP servers, metadata, and tool counts.
  - `GET /api/mcp/tools`: List full MCP tool definitions with JSON Schema parameter definitions.
  - `POST /api/mcp/call`: Execute MCP tools via JSON-RPC 2.0 schema over the Tool Gateway security boundary.
- Frontend "MCP Protocol" tab in `frontend/app/page.tsx`:
  - MCP Server health cards.
  - Interactive Tool Catalog & JSON Schema explorer.
  - Live JSON-RPC 2.0 execution tester with dynamic schema templates and role-based access verification.
- Verified with comprehensive test suite: Server discovery, tool registration, and execution all PASS.

### OAuth and identity

- Google OAuth Web Client ID has been created.
- Backend reads `GOOGLE_CLIENT_ID` from `backend/.env`.
- Frontend reads `NEXT_PUBLIC_GOOGLE_CLIENT_ID` from `frontend/.env`.
- Backend verifies Google ID tokens with Google Auth.
- Approval endpoint requires a valid Bearer token.
- Approval audit stores:
  - Google subject ID
  - email
  - name
- Google session is kept in `sessionStorage` for the current browser tab.
- Account menu supports sign-in state and logout.
- Hydration mismatch caused by early sessionStorage access was fixed.

### Frontend dashboard

The current dashboard contains:

- ACP logo and AGENT CONTROL PLANE subtitle.
- Top header with project status, GCP status, notification counts, and account menu.
- Sidebar with:
  - Overview
  - Tool Gateway
  - Event Sources
  - Trace Explorer
  - System Health
  - Settings
- Executions and approvals count were intentionally moved from sidebar menu items into the top notification menu.
- Dashboard summary widgets:
  - Active Executions
  - Pending Approvals
  - Tasks Completed
  - Failed Tasks
- Live Workflows / Execution Queue.
- Human-in-the-loop Approvals panel.
- Infrastructure / System Health panel.
- Audit Trail / Recent Activity panel.
- Search icon field for execution filtering.
- Client-side pagination with 10, 25, and 50 row options.
- Status badge opens a compact dropdown containing Trace.
- Audit Trace is an advanced collapsible panel.
- Latest Result and Execution Error are advanced collapsible panels.
- Table record font and spacing were reduced to prevent unnecessary horizontal overflow.

## 4. API contract currently used

- GET `/`
- GET `/health`
- GET `/config`
- GET `/api/executions`
- POST `/api/executions`
- GET `/api/executions/{execution_id}`
- PATCH `/api/executions/{execution_id}`
- GET `/api/executions/{execution_id}/events`
- POST `/api/executions/{execution_id}/approval`

Approval calls must send:

```http
Authorization: Bearer <Google ID token>
```

## 5. Verification already completed

- Backend Python compile: PASS
- Backend import/config checks: PASS
- Google client ID loading from backend env: PASS
- Frontend production build: PASS
- TypeScript check through Next build: PASS
- Live ADK model smoke test: PASS
- Firestore execution persistence: PASS
- Audit trace smoke test: PASS
- Approval approve/reject flow: PASS
- OAuth sign-in: PASS
- Approval request with OAuth: PASS
- Session persistence after refresh: PASS
- Hydration issue: fixed and build passes

The ADK AFC message is currently a non-fatal warning from the ADK dependency. The application code uses ADK Runner and does not call generate_content directly.

## 6. Current limitations and deliberate deferrals

- Execution table pagination is currently client-side. It still receives the execution list before slicing.
- Firestore cursor pagination is not implemented yet.
- WebSocket is deferred; current polling interval is 3 seconds.
- Several summary widgets and Recent Activity entries are still presentation data, while the Execution Queue, approval flow, result, and audit trace use live backend data.
- No extra UI panels should be added unless a later requirement needs them.

## 7. Agreed next implementation order

Do not skip the order without a specific reason.

1. [x] Tool Gateway policy and rate limit (COMPLETED).
2. [x] Minimal MCP tools (COMPLETED).
3. [x] Backend Firestore cursor pagination and frontend server filters (COMPLETED).
4. [x] Cloud Run deployment (COMPLETED) - Deployed to us-central1 with URL: https://acp-backend-627792456859.us-central1.run.app
5. [x] Final security and hackathon readiness check (COMPLETED) - Auth/RBAC complete, Google Client ID integrated, and Cloud Run multi-instance Firestore rate limiting verified.
6. [x] End-to-end acceptance test (COMPLETED) - Implemented in `scripts/e2e_acceptance_test.py` with mock OAuth tokens, validating complete workflow transitions.
7. [x] GCP Hub & Infrastructure Telemetry (COMPLETED) - Added dynamic `/api/gcp/diagnostics` connectivity endpoint in backend and integrated a dual-panel dashboard UI inside Settings to monitor cloud resources.
8. [x] Observability and production operational checks (COMPLETED) - Stdlib JSON structured logging with Cloud Logging severity mapping in `backend/main.py`; all print() calls replaced with leveled logger calls across main/gateway/agent. No new dependencies; Firestore audit events remain the single audit system.
9. [x] Release freeze, README/runbook, and hackathon demo package (COMPLETED) - README.md rewritten clean UTF-8 (previous file was corrupted); includes product overview, stack, structure, local run + deploy instructions, operational runbook, verification commands, and a 9-step hackathon demo script. Feature set frozen for demo.

## 8. Agent working rules

- Always work from `/home/blaz/www/agent-control-plane`.
- Read existing code before editing.
- Keep the dashboard simple and compact.
- Reuse existing Firestore audit events; do not create a second logging system.
- Do not introduce WebSocket until polling is proven insufficient.
- Do not add libraries when the existing stack or browser-native features are enough.
- Keep Google Client ID public configuration separate from secrets.
- Never put a Google client secret in frontend code or commit it.
- Approval identity must come from a verified Google token, never from a free-text frontend field.
- Preserve the current BuzLab-inspired dark enterprise visual language.
- After every non-trivial change, run the smallest relevant verification.
- Update this document and `PROJECT_CONTEXT.md` when a milestone changes.
- Never claim a feature is complete without a test or a clearly stated manual verification requirement.

## 9. Useful local commands

Backend:

```bash
cd /home/blaz/www/agent-control-plane
source venv/bin/activate
uvicorn backend.main:app --reload --port 8080
```

Frontend:

```bash
cd /home/blaz/www/agent-control-plane/frontend
npm run dev
```

Build verification:

```bash
cd /home/blaz/www/agent-control-plane
./venv/bin/python -m compileall -q backend
cd frontend
npm run build
```

## 10. Handoff summary

The core vertical slice is working:

Google sign-in -> create execution -> human approval -> ADK Gemini runner -> Firestore state -> polling -> result and audit trace.

The next work should close the documented auth/role blockers and then run the
controlled Cloud Run deployment and smoke test; do not expand the dashboard
with unrelated features.

## 11. Frontend Cursor Pagination Update

- Execution status filtering now uses the backend `status` query parameter.
- Execution search now uses the backend `search` query parameter.
- Page size is sent as the backend `limit` query parameter.
- The dashboard exposes Firestore-cursor-based `Prev Page` and `Next Page` controls and keeps cursor history for the current filter set.
- Backend search filtering is applied before page slicing/cursor calculation so filtered pages do not lose matches or report incorrect `has_more` values.
- Backend compile/import and frontend production build passed after this change.

## 12. Cloud Run Deployment Preparation

- Replaced the single-stage backend Dockerfile with a multi-stage Python 3.12 image.
- Runtime uses `backend.main:app`, listens on Cloud Run's `PORT`, and runs as a non-root `app` user.
- Added root `.dockerignore` so local credentials, virtualenvs, frontend dependencies, and project notes are not sent to the build context.
- Added `cloudbuild.yaml` for Artifact Registry image builds.
- Added `scripts/deploy-cloud-run.sh` for Artifact Registry + Cloud Run deployment with Vertex AI, Firestore project settings, and optional runtime service account.
- Added `scripts/verify-container.sh`; local Docker build and packaged FastAPI import passed (`CONTAINER_IMPORT_OK`).
- No Cloud Build push or Cloud Run deployment has been executed automatically.
- CORS origin is now configurable with `FRONTEND_ORIGIN` for a deployed frontend; localhost remains the default.

## 13. Auth/RBAC Hardening Update

- `ADMIN_EMAILS` is configured in `backend/.env` and is intentionally not placed in frontend environment files.
- Backend derives `admin` or `agent` from the verified Google email.
- Admin policy update was manually verified successfully with a configured admin account.
- Security smoke test passes: unauthenticated mutations return `401`, role spoofing is ignored, and non-admin policy updates return `403`.
- Auth/RBAC hardening is complete; remaining readiness work is shared rate-limit strategy and controlled Cloud Run deployment/smoke testing.

## 14. Shared Cloud Run Rate-Limit Strategy

- Added Firestore-backed sliding-window state in the `gateway_rate_limits` collection.
- Acquire operations use Firestore transactions, so concurrent Cloud Run instances share one quota per tool/caller key.
- Keys are SHA-256 hashed before becoming document IDs; raw caller identifiers are not used as document paths.
- `RATE_LIMIT_BACKEND=memory` remains the local default.
- `RATE_LIMIT_BACKEND=firestore` is enabled by the Cloud Run deployment script.
- Distributed mode fails closed when Firestore is unavailable instead of silently reverting to a per-instance limiter.
- Local rate-limit contract smoke test passed; remote multi-instance verification remains pending until deployment.

## 15. Inbound Webhooks & Dynamic Integrations Hub (COMPLETED)

- **Inbound Webhook APIs (`backend/main.py`):**
  - Implemented public, unauthenticated webhook endpoints matching production systems:
    - `POST /api/webhooks/inbound-email`: Parses inbound email payloads (`sender`, `subject`, `body`).
    - `POST /api/webhooks/hubspot`: Parses HubSpot webhook payloads (`event`, `contact_email`, `contact_name`, `associated_company`).
  - These endpoints write directly to Firestore, spawning real-time execution entries (`WAITING_APPROVAL`) and logging ingestion events (`EMAIL_INGESTED`, `WEBHOOK_INGESTED`) to the audit trace.
- **Dynamic Integrations Config & Verification (`backend/main.py`):**
  - Exposed new integration REST APIs (`GET /api/integrations/config`, `POST /api/integrations/config`, `POST /api/integrations/test-email`).
  - Stored settings dynamically inside Firestore under `settings/integrations` to avoid hardcoding variables.
  - Implemented real-time IMAP server credential testing using `imaplib` directly on the backend.
- **Background Ingestion Daemon Worker (`backend/main.py`):**
  - Implemented an asynchronous background thread/task loop (`imap_polling_loop`) that runs directly in FastAPI's event loop when toggled active.
  - The worker dynamically polls real IMAP mailboxes for unseen emails, ingests them into the control plane, and flags them as seen.
  - Features an automatic *Simulation Fallback Mode* if dummy credentials are set, injecting realistic mock customer events to ensure flawless presentation capabilities.
- **Web GUI Control & Stacked UI Layout (`frontend/app/page.tsx`):**
  - Added a dedicated **Event Sources** tab featuring:
    - **Stacked Integration Cards:** Squeeze-proof layout with automatic word breaking (`wordBreak: "break-all"`) that prevents horizontal scrolling and text truncation on long API paths.
    - **Inline Registrator (`＋ Add Source`):** Users can input new inboxes, target workflows, and map variables on the fly.
    - **Dynamic Simulator:** Automatically renders interactive buttons for each registered source, enabling instant HTTP POST tests directly from the interface.
  - Built a comprehensive **Integrations Hub Setup Portal** in the Settings tab (now organized into dedicated sub-tabs for clean UI/UX):
    - Added Sub-tabs Navigation inside Settings: **General Configurations**, **Telemetry & GCP Diagnostics**, and **Integrations Hub (Mail & CRM)**.
    - Added a **Google OAuth Setup Guide** widget next to the read-only configurations, detailing a 4-step quick checklist (Consent configuration, OAuth client creation, Authorized origin mapping, and Env injection) to preserve operational guidelines.
    - Unified **Mail Server Setup (Incoming & Outgoing Demo)** merging shared host, username, password, and security types into a single non-redundant form inside the Integrations sub-tab.
    - Added Outgoing Port (SMTP) showing Port 587 (Demo: `DISPATCHED_SMTP_TLS`) in a read-only state.
    - Visual indicators for Outgoing SMTP Driver showing "DEMO SIMULATION" to represent mockup transport state and clarify real production activation path.
    - Full IMAP Mail Server setup (server, port, security selection, sync interval, credentials).
    - CRM API configuration details.
    - One-click **Background Poller Daemon Switch (ON/OFF)** to run or terminate the background worker without terminal commands.
    - Interactive **⚡ Test Mail Connection** button showing real-time handshake validations.
  - Verified Next.js compilation compiles without errors (`npm run build`).

