# Agent Control Plane — Project Context & Handoff Report

> Dokumen ini adalah sumber konteks kerja untuk agent berikutnya (ChatGPT,
> Codex, atau agent coding lain). Baca file ini sebelum mengubah kode.

## 1. Identitas Proyek

- **Project:** Agent Control Plane (ACP)
- **Hackathon:** All Things Agentic Hackathon 2026
- **Track:** Taskmaster — Multi-step Autonomous Workflow
- **Working directory:** `/home/blaz/www/agent-control-plane`
- **Cloud project:** `acp-hackathon-2026-505906`
- **GCP account:** `almantab0308@gmail.com`
- **Region:** `us`
- **Last known date:** 2026-08-24

## 2. Tujuan Produk

ACP adalah control plane untuk memonitor dan mengendalikan workflow agent
multi-step. Sistem akhir diharapkan mampu menerima event, menjalankan agent,
memanggil tool melalui gateway, meminta approval manusia bila diperlukan, dan
menyimpan execution trace/audit.

Alur target:

```text
[Event Sources] → [Agent Runtime] → [Tool Gateway] → [MCP Tools] → [GCP Infra]
       ↓                ↓                  ↓                ↓          ↓
   Gmail/Webhook     Gemini/ADK       Policy/Auth       Business Tools  Audit
   Pub/Sub/Scheduler FastAPI          Rate Limit        Gmail/CRM/etc   Firestore
```

## 3. Blueprint / Requirement Reference

### AI & Agent

- Model terkunci: `gemini-3.5-flash`
- Provider: Vertex AI
- SDK: `google.genai` — jangan gunakan `google.generativeai`
- Agent framework target: Google ADK
- Client pattern: `chats.create()` lalu `send_message()`
- Endpoint: `https://aiplatform.us.rep.googleapis.com`
- Authentication: Google Application Default Credentials (ADC)

### Backend

- Python 3.12
- FastAPI async
- Uvicorn pada port `8080`
- Pydantic Settings
- Firestore untuk execution, trace, approval
- Pub/Sub untuk event/task queue

### Frontend

- Next.js App Router
- TypeScript
- Tailwind CSS adalah target stack; saat ini visual dibuat dengan CSS global
- WebSocket untuk live execution tracking — belum diimplementasikan
- Dark-only operations dashboard

### GCP Target

- Cloud Run — backend deployment
- Firestore — persistence
- Pub/Sub — asynchronous messaging
- Secret Manager — secrets
- Cloud Build — CI/CD
- Cloud Logging — structured logs
- Cloud Monitoring — metrics/alerts
- Vertex AI — Gemini runtime

## 4. Status Pengerjaan

> Section 11 ke bawah adalah log update kronologis dan menjadi sumber detail
> per milestone. Ringkasan status terkini ada di sini.

### Selesai (per 2026-08-24)

- Backend FastAPI lengkap: executions CRUD + cursor pagination, approval gate
  dengan Google OAuth, inbound webhooks (email/HubSpot), integrations config,
  background IMAP polling daemon, GCP diagnostics.
- Runtime agent: Google ADK 2.7.1 + Gemini 3.5 Flash via Vertex AI; live smoke test PASS (`ADK_LIVE_OK`).
- Tool Gateway: RBAC, risk classification, sliding-window rate limit
  (Firestore-backed shared quota di Cloud Run, fail-closed).
- MCP registry: 4 server, eksekusi JSON-RPC 2.0 lewat gateway boundary.
- Firestore persistence: `executions` + audit subcollection `events`.
- Auth/RBAC: verified Google token wajib untuk mutation, `ADMIN_EMAILS` untuk policy admin.
- Observability: structured JSON logging (stdlib) dengan severity Cloud Logging; tanpa dependency baru.
- Frontend Next.js: Overview, Tool Gateway, MCP Protocol, Event Sources,
  Trace Explorer, System Health, Settings + Integrations Hub; polling 3 detik;
  production build PASS.
- Deployment: backend live di Cloud Run us-central1
  (`https://acp-backend-627792456859.us-central1.run.app`); scripts deploy & verify tersedia.
- E2E acceptance test tersedia di `scripts/e2e_acceptance_test.py`.

### Belum selesai / deferral disengaja

- Frontend belum dideploy ke cloud (demo via lokal `npm run dev`); set
  `FRONTEND_ORIGIN` saat diperlukan.
- WebSocket ditunda — polling 3 detik memadai.
- Beberapa widget ringkasan masih data presentasi (bukan live data).
- Tidak ada test suite formal frontend.

Semua 9 tahap rencana kerja di `PROJECT_PROGRESS.md` §7 sudah COMPLETED;
fitur dibekukan untuk demo hackathon.

## 5. Struktur Aktual

```text
/home/blaz/www/agent-control-plane/
├── backend/
│   ├── __init__.py
│   ├── main.py        # FastAPI app: executions, approvals, webhooks, integrations, logging setup
│   ├── config.py      # Pydantic settings
│   ├── agent.py       # Google ADK + Gemini runner
│   ├── gateway.py     # Tool Gateway: RBAC, risk levels, rate limits
│   ├── mcp.py         # MCP registry + JSON-RPC 2.0 layer
│   ├── auth.py        # Google token verification, admin derivation
│   ├── test_rate_limiter.py
│   ├── test_cloud_run.py
│   ├── requirements.txt
│   └── Dockerfile     # Multi-stage, non-root runtime user
├── frontend/
│   ├── app/           # layout.tsx, page.tsx, globals.css
│   ├── package.json
│   └── ...            # tsconfig, next config
├── scripts/
│   ├── deploy-cloud-run.sh
│   ├── verify-container.sh
│   └── e2e_acceptance_test.py
├── cloudbuild.yaml
├── venv/
├── .dockerignore / .gitignore
├── server-run.sh
├── README.md          # Overview + runbook + demo script (rewritten 2026-08-24)
├── CLOUD_RUN.md
├── SECURITY_READINESS.md
├── WHY_ACP.md
├── PROJECT_CONTEXT.md # Dokumen ini
└── PROJECT_PROGRESS.md
```

## 6. Cara Menjalankan

### Backend

```bash
cd /home/blaz/www/agent-control-plane
./venv/bin/uvicorn backend.main:app --reload --port 8080
```

Health check:

```bash
curl http://127.0.0.1:8080/health
```

Expected response:

```json
{"status":"ok","service":"agent-control-plane"}
```

### Frontend

```bash
cd /home/blaz/www/agent-control-plane/frontend
npm install
npm run dev
```

Buka `http://localhost:3000`.

Production build:

```bash
npm run build
```

## 7. Important Findings / Technical Debt

- Koneksi Vertex AI sudah terverifikasi live (`ADK_LIVE_OK`, section 21); ADC wajib aktif di mana pun backend berjalan.
- ADK 2.7.1 memunculkan warning AFC non-fatal — aman diabaikan.
- Store eksekusi adalah Firestore; tidak ada persistence in-memory yang tersisa.
- `README.md` sebelumnya korup dan sudah ditulis ulang (section 32).

## 8. Urutan Tahap Berikutnya

Semua tahap sudah selesai (lihat `PROJECT_PROGRESS.md` §7 — 9/9 COMPLETED).
Status: **release freeze untuk demo hackathon**. Hanya perbaikan bug dari sini.
Satu keputusan tersisa: deploy frontend ke cloud atau demo dari lokal.

## 9. Instruksi untuk Agent Berikutnya

- Gunakan working directory tepat: `/home/blaz/www/agent-control-plane`.
- Baca dokumen ini sebelum coding.
- Bedakan fakta aktual, requirement blueprint, dan rencana masa depan.
- Jangan menyatakan fitur selesai tanpa menjalankan validasi yang relevan.
- Jangan mengganti UI BuzLab style tanpa alasan dan persetujuan.
- Reuse struktur yang ada; hindari abstraction atau dependency baru yang belum
  diperlukan.
- Jangan membuat credential, `.env`, service-account JSON, atau secret ke git.
- Jika informasi belum tersedia, tulis `Not Found`, bukan mengarang.
- Untuk perubahan backend, validasi minimal:

```bash
./venv/bin/python -m compileall -q backend
./venv/bin/python -c "from backend.main import app; print(app.title)"
```

- Untuk perubahan frontend, validasi minimal:

```bash
cd frontend
npm run build
```

## 10. Definition of Done Saat Ini

Proyek adalah produk agentic end-to-end: Google sign-in → create execution →
human approval → ADK Gemini runner → Firestore → polling → result + audit trace,
dengan Tool Gateway (RBAC/rate limit), MCP tools, webhooks, dan deployment
Cloud Run. Fitur dibekukan untuk demo hackathon; hanya bug fix.


## 11. Latest Integration Update

- Added GET /api/executions to FastAPI.
- Added restricted CORS for http://localhost:3000 with GET-only methods.
- Frontend dashboard now fetches live execution data from NEXT_PUBLIC_API_BASE_URL or http://localhost:8080.
- Frontend shows a connection state and falls back to last-known mock data when the API is offline.
- Backend HTTP smoke test passed.
- Frontend production build passed after integration.
- GitHub references were used only as implementation patterns; ACP architecture and BuzLab visual language remain authoritative.

## 12. Latest Execution Lifecycle Update

- Added POST /api/executions with QUEUED state.
- New Execution button now creates an execution through FastAPI.
- The queue prepends the created execution without a page reload.
- Backend POST then GET smoke test passed.
- Frontend production build passed.
- Current store is process-local memory and is not durable.

## 13. Latest Lifecycle Update

- ADC audit returned ADC_NOT_READY; Firestore was not enabled or claimed as active.
- Added GET /api/executions/{execution_id}.
- Added PATCH /api/executions/{execution_id} with validated lifecycle statuses.
- Valid statuses: QUEUED, RUNNING, WAITING_APPROVAL, COMPLETED, FAILED, CANCELLED.
- Create and PATCH smoke test passed on a test Uvicorn session.
- The process-local store remains the current fallback until ADC and Firestore are ready.

## 14. Firestore Persistence Update

- Firestore database default is active in nam5.
- Execution data now uses the Firestore collection executions.
- Seed data is written only when the collection is empty.
- Existing API paths remain unchanged.
- API validation passed: list, create, detail/update lifecycle.
- The frontend needs no contract change.
- ADC is required wherever the backend runs.

## 15. Execution Runner + Gemini Agent Update

- Gemini client is now lazy; backend import does not create the client.
- POST execution writes QUEUED to Firestore and schedules a FastAPI background runner.
- Runner updates RUNNING, calls backend agent, then writes COMPLETED or FAILED.
- Completed responses store result; failures store error.
- Runner mock smoke test passed without calling Vertex AI.
- Frontend production build passed.
- Live Gemini execution still requires a real request and should be tested manually after starting the backend.
- Google ADK orchestration is not yet implemented; current runner uses google.genai as specified by the locked client pattern.

## 16. Execution Status Polling Update

- Frontend polls GET /api/executions every 3 seconds.
- Polling stops when the page unmounts.
- Existing loading and offline fallback states remain active.
- Frontend production build passed.
- WebSocket is deferred until polling is insufficient for realtime scale.

## 17. Human Approval Gate Update

- New UI executions require approval by default.
- Pending executions use WAITING_APPROVAL and do not call Gemini.
- POST approval with APPROVED moves execution to QUEUED and starts the runner.
- POST approval with REJECTED moves execution to CANCELLED.
- Approval decisions are stored in Firestore.
- Approve and Reject controls are available in the execution table.
- Approve/reject mock flow and frontend production build passed.

## 18. Execution Output Panel Update

- Frontend now displays the latest result or error returned by the runner.
- The panel reads result and error fields already returned by the existing executions API.
- No new API or transport was added.
- Frontend production build passed.

## 19. Collapsible Execution Output

- Latest result/error is now a native collapsed details panel.
- The panel opens on click with a cyan arrow indicator.
- Dashboard density stays compact by default.
- Frontend production build passed.

## 20. Google ADK Runtime Update

- Installed google-adk 2.7.1.
- Replaced direct google.genai chat execution with google.adk Agent and Runner.
- Added InMemorySessionService for one execution session.
- Runner still enters through run_agent, so Firestore lifecycle and frontend contracts are unchanged.
- requirements.txt was aligned with the installed ADK dependency set.
- ADK construction, backend import, and frontend production build passed.
- Live ADK model call was not run automatically; it requires a deliberate Gemini request.

## 21. Live ADK Smoke Test

- First live test found and fixed the ADK 2.7.1 async session API mismatch.
- InMemorySessionService.create_session is now awaited.
- Live prompt test passed with result ADK_LIVE_OK.
- ADK emitted a non-fatal AFC recommendation warning.

## 22. Simple Execution Audit Trace

- Added Firestore subcollection executions/{execution_id}/events.
- Records only lifecycle events: CREATED, WAITING_APPROVAL, APPROVED, REJECTED, RUNNING, COMPLETED, FAILED.
- Added GET /api/executions/{execution_id}/events.
- Trace smoke test passed and its temporary document was removed.
- No separate logging subsystem was introduced.


## 23. Google OAuth Approval Identity

Status: completed and manually verified.

- Backend setting: `GOOGLE_CLIENT_ID` in `backend/.env`.
- Frontend setting: `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in `frontend/.env.local`.
- Approval endpoint requires `Authorization: Bearer <Google ID token>`.
- Backend verifies issuer/token audience with Google Auth.
- Approval audit stores the verified actor: `sub`, `email`, and `name`.
- Missing client ID returns HTTP 503; missing/invalid token returns HTTP 401.

The Web application OAuth client was created in the GCP project `acp-hackathon-2026-505906` with JavaScript origin `http://localhost:3000`. The client ID is configured locally in backend and frontend env files. Never commit a client secret; this flow only needs the public web client ID.

Verification completed:
- Python compile: PASS
- Frontend production build: PASS
- Auth module import: PASS
- Live OAuth sign-in: PASS
- Live approval request with OAuth: PASS


## 24. Current OAuth and Frontend UI Status

- Google OAuth client was created and configured.
- Backend now loads GOOGLE_CLIENT_ID from backend/.env using an absolute env-file path.
- Google approval requests return HTTP 200 after a valid sign-in.
- Frontend keeps the ID token in sessionStorage for the current browser tab.
- Hydration mismatch from reading sessionStorage during the first render was fixed.
- Account menu supports logout.
- Execution Queue has search, client-side pagination, status dropdown Trace, audit trace, and latest result disclosure.
- Executions and approvals counts are shown in the top notification menu instead of sidebar navigation items.
- Sidebar keeps functional area concepts only: Overview, Tool Gateway, Event Sources, Trace Explorer, System Health, Settings.
- Next.js production build and TypeScript validation pass.

## 25. Project Handoff

- The vertical slice is working: Google sign-in -> create execution -> approval -> ADK Gemini runner -> Firestore -> polling -> result/audit trace.
- Status: release freeze for hackathon demo; see section 8 and PROJECT_PROGRESS.md.
- Do not add unrelated dashboard widgets or duplicate logging systems.
- See PROJECT_PROGRESS.md for the full agent handoff, completed work, limitations, verification evidence, and ordered next steps.

## 26. Cursor Pagination and Server Filters

- Execution Queue status and search controls now call `/api/executions` with `status`, `search`, and `limit` query parameters.
- Next/Prev controls use Firestore cursor IDs returned as `next_cursor`; cursor history is reset when filters or page size change.
- Backend applies search filtering before cursor/page slicing to keep filtered pagination consistent.
- Backend compile/import and frontend production build passed after this update.

## 27. Cloud Run Deployment Preparation

- Backend Dockerfile is multi-stage and uses non-root runtime user `app`.
- Cloud Run starts `backend.main:app` and honors the injected `PORT` value.
- Local image verification is available via `scripts/verify-container.sh`.
- Artifact Registry and Cloud Run deployment preparation is available via `scripts/deploy-cloud-run.sh` and `cloudbuild.yaml`.
- Vertex AI and Firestore use runtime environment configuration and Cloud Run ADC; no credentials are included in the image.
- Local Docker image build and packaged FastAPI import passed; no remote push or deployment was performed.

## 28. Security Readiness Check

- Security/readiness review is in progress and documented in `SECURITY_READINESS.md`.
- Verified: Google token verification for approvals, non-root image, credential exclusion, configurable CORS, Tool Gateway policy/RBAC/rate limiting, and MCP gateway routing.
- Auth/RBAC hardening is complete for mutation routes: Google token is required, policy updates require `ADMIN_EMAILS`, and client-provided roles are ignored.
- Shared Firestore rate-limit enforcement is now implemented and enabled for Cloud Run via `RATE_LIMIT_BACKEND=firestore`; gateway metrics remain process-local.
- Remaining blocker: remote deployment and post-deployment smoke tests are pending.

## 29. Auth/RBAC Verification

- Backend `ADMIN_EMAILS` is configured with valid administrator identities; the local configuration check found two configured entries without exposing their values.
- Admin policy update was manually verified successfully after restarting/reloading the backend.
- Auth/RBAC milestone is complete. Do not add `ADMIN_EMAILS` to frontend environment files.

## 30. Inbound Webhooks & Dynamic Integrations Hub

- **Inbound Webhook APIs (`backend/main.py`):**
  - Added `POST /api/webhooks/inbound-email` and `POST /api/webhooks/hubspot` to capture real, raw email or HubSpot webhook event requests.
  - Generates real executions in Firestore and writes audit logs dynamically.
- **Dynamic Config Storage & Verification:**
  - Configurations are saved dynamically inside Firestore `settings/integrations`.
  - Added REST APIs `GET /api/integrations/config`, `POST /api/integrations/config`, and `POST /api/integrations/test-email` to manage connections dynamically.
- **Background Ingestion Daemon:**
  - FastAPI runs a background loop `imap_polling_loop` that securely fetches real-time unseen emails from configured IMAP servers, processes them, and flags them.
  - Automatically falls back to high-fidelity mock event simulation if configured with example/empty parameters.
- **Web GUI Control & Stacked UI Layout:**
  - Added dynamic **Event Sources** view in frontend with **Stacked Integration Cards** and automatic word wrapping to eliminate horizontal scrolling.
  - Added inline form to add new ingestion endpoints dynamically, instantly mapping them to custom target workflows.
  - Renders simulator buttons dynamically for each custom registered source.
  - Built an **Integrations Hub Portal** in Settings allowing users to configure settings, test connections, and toggle the background poller daemon ON/OFF with a single switch.

## 31. Observability Update

- Stdlib-only JSON structured logging added in `backend/main.py` (`CloudJSONFormatter`) with Cloud Logging `severity` field mapping.
- All backend `print()` calls replaced with leveled logger calls (`log.info/warning/error`) across `backend/main.py`, `backend/gateway.py`, `backend/agent.py`; no new dependencies.
- Firestore audit events remain the single audit/logging source of truth; no second logging subsystem introduced.
- Verification: compile PASS, app import PASS, formatter JSON check PASS, rate-limiter tests PASS, live Cloud Run `/health` and `/api/gateway/metrics` returned 200.

## 32. Release Freeze & README Update

- README.md was corrupted (null bytes / broken encoding mid-file) and has been rewritten as clean UTF-8.
- README now covers: product overview, vertical slice, tech stack, structure, local run + env files, Cloud Run URL and redeploy scripts, operational runbook, verification commands, 9-step hackathon demo script, and security rules.
- Feature set is frozen for the hackathon demo; only bug fixes from here.

## 33. Hackathon Submission Documentation Update

- Added `docs/architecture.svg`: dark-theme architecture diagram (users, event sources, Cloud Run backend internals, Vertex AI/ADK, Tool Gateway, MCP, Firestore, OAuth, deployment) embedded in README.
- Added `docs/DEVPOST_SUBMISSION.md`: English Devpost text-description draft (pitch, features, tech, data sources, learnings), bonus-points checklist, pre-submission compliance checklist, and a 4-minute video shot list.
- Deadline reference: Aug 31 2026 5:00 PM PDT. Remaining before submit: git repo push, frontend deploy (hosted URL), record video, optional bonus content.

## 34. Video Assembly Plan (Pending User Footage)

- User will deliver raw screen recordings per section of `docs/demo_video/VOICEOVER.md` (sign-in popup, Approve click, and any other human-only shots).
- On delivery: mix user footage with the automated 80s walkthrough (`docs/demo_video/acp_demo_walkthrough.mp4`) into the final ≤4-minute English video per the shot list in `docs/DEVPOST_SUBMISSION.md`.
- Assembly tool: local ffmpeg (available). Target: 1600×900/1080p, MP4 (H.264 + faststart), voice-over per VOICEOVER.md.
- After mixing: upload to public YouTube/Vimeo, put the link in README Demo section and the Devpost form.
