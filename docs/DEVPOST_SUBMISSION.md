# Devpost Submission — Draft Text Description

> Paste into the "Enter a Submission" form on
> https://allthingsagentichackathon.devpost.com. All materials must be in English.
> Category: **The Taskmaster**.

---

## Short pitch (one-liner)

Agent Control Plane (ACP) is a production-style control plane where autonomous
Gemini agents run real multi-step business workflows in the background — and a
human only steps in when the policy says so.

## Summary

Most agent demos stop at chat. ACP proves execution: an inbound email or CRM
webhook spawns an execution, the agent plans and acts through a secured Tool
Gateway, updates Firestore state, and produces a full audit trace of every step.
A human approver with a verified Google identity signs off before anything risky
runs — or the workflow runs fully autonomous when approval is not required.

The demo workflow: a customer emails asking for a quotation. The system ingests
the email, creates an execution, the Gemini agent (Google ADK 2.7.1, Gemini 3.5
Flash via Vertex AI) checks inventory, looks up the customer, generates a quote,
and sends it — each tool call passing through RBAC, risk classification, and
sliding-window rate limits enforced by the Tool Gateway.

## Features and functionality

- **Execution lifecycle**: QUEUED → RUNNING → WAITING_APPROVAL → COMPLETED /
  FAILED / CANCELLED, persisted in Firestore, polled live in the dashboard.
- **Human-in-the-loop approvals (optional)**: approve/reject requires a verified
  Google ID token; the actor (sub, email, name) is stored in the audit trail.
  Workflows can also run fully autonomous (`requires_approval=false`).
- **Tool Gateway**: every tool invocation passes role-based access control
  (agent/admin derived from verified Google identity), risk classification
  (LOW→CRITICAL), and per-tool sliding-window rate limits backed by Firestore
  transactions — one shared quota across all Cloud Run instances, fail-closed.
- **MCP ecosystem**: four typed MCP servers (inventory, crm, email, gcp
  monitoring) exposed over JSON-RPC 2.0 through the same gateway boundary.
- **Event ingestion**: inbound email + HubSpot webhook endpoints and a background
  IMAP polling daemon that turns real inbox messages into executions.
- **Audit trace**: every lifecycle event and human decision recorded in a
  Firestore subcollection — the single audit system, viewable from the UI.
- **Operations dashboard**: compact dark ops UI — execution queue with search +
  cursor pagination, approval panel, gateway policy console, MCP tester, event
  sources manager, GCP diagnostics.

## Technologies used

- **Gemini 3.5 Flash via Vertex AI** (locked model configuration)
- **Google ADK 2.7.1** (Agent, Runner, InMemorySessionService)
- **Cloud Run** (FastAPI backend, multi-stage non-root container)
- **Firestore** (executions, audit events, integrations config, shared rate-limit state)
- Google OAuth (verified Web Client ID tokens), Python 3.12 / FastAPI / Uvicorn,
  Next.js App Router + TypeScript frontend

## Data sources used

- Customer email inquiries (IMAP inbox / simulated feed for the demo)
- HubSpot-style CRM webhook payloads
- Demo business data (inventory stock levels, customer records) served by the
  registered MCP tools

## Findings and learnings

- **Governance is a feature, not friction.** The hardest part was making the
  agent's autonomy auditable; modeling approvals as first-class lifecycle states
  made both autonomy and control expressible in one state machine.
- **Distributed rate limiting changes the design.** A process-local limiter is
  silently wrong once you have more than one Cloud Run instance. Moving the
  sliding window into Firestore transactions (fail-closed) was a small diff that
  removed a whole class of production incidents.
- **ADK fits naturally behind a service boundary.** The ADK Runner sits behind
  our own `/api/executions` contract, so swapping runtimes never touches the UI.
- **Audit beats logging.** Structured JSON logs answer "is it up?"; the Firestore
  event subcollection answers "who did what and why" — keeping one audit source
  avoided two divergent histories.

## Testing instructions

- Hosted URL: _(add after frontend deploy)_ — backend:
  https://acp-backend-627792456859.us-central1.run.app
- Sign in with any Google account; create an execution; approve it; watch the
  ADK runner complete it and open the Trace dropdown to inspect the audit trail.
- Repo spin-up instructions are in `README.md`.

## Bonus contributions checklist

- [ ] Public blog post (dev.to/medium) including the sentence: "I created this piece of content for the purposes of entering the All Things Agentic Hackathon." (+0.2)
- [ ] Social post on X/LinkedIn with hashtag `#AllThingsAgenticHackathon` (+0.2)
- [ ] Additional Google AI model integration (Gemma/Veo/Lyria), up to +0.6

## Pre-submission compliance checklist

- [ ] Category selected: The Taskmaster
- [ ] Code repo URL (GitHub/GitLab/Bitbucket); if private, share with testing@devpost.com and cloudhackathons@google.com
- [ ] No secrets/.env committed; `.gitignore` verified before push
- [ ] Architecture diagram (`docs/architecture.svg`) linked/embedded in README
- [ ] README.md spin-up instructions present (local + cloud)
- [x] Demo video ≤ 4 min, English, shows Google Cloud proof (Cloud Run console, .run.app URL, Cloud Logging JSON logs) — final cut: `docs/demo_video/acp_demo_submission.mp4` (4:11); still needs upload to public YouTube/Vimeo link
- [ ] All submission materials in English
- [ ] Submit before Aug 31, 2026 5:00 PM PDT

## 4-minute video script (shot list)

Final cut rendered: `docs/demo_video/acp_demo_submission.mp4` (4:11, 1920x1080).
Voice-over script: `docs/demo_video/VOICEOVER.md`.

| Time | Shot | Content |
|------|------|---------|
| 0:00–0:30 | Problem | Sales quotes die in inboxes: read email → check stock → look up customer → write quote → send. Five manual steps, zero audit. |
| 0:30–1:00 | Value proposition | ACP runs this whole chain autonomously in the background; humans approve only what policy flags. Everything auditable. |
| 1:00–1:20 | Architecture | Show `docs/architecture.svg`: Gemini 3.5 Flash via Vertex AI inside Google ADK runner, Tool Gateway, Firestore, Cloud Run. |
| 1:20–1:40 | GCP proof | Cloud Run dashboard + .run.app URL, Firestore collections, Cloud Logging JSON entries with severity field. |
| 1:40–2:40 | Live demo pt.1 | Trigger inbound-email simulator → execution appears WAITING_APPROVAL → sign in with Google → approve → status transitions QUEUED → RUNNING → COMPLETED. |
| 2:40–3:20 | Live demo pt.2 | Open Trace dropdown: full audit trail with verified actor. Tool Gateway tab: run a tool as `agent` vs `admin`, show rate-limit rejection. MCP tab: JSON-RPC call. |
| 3:20–3:50 | Autonomy twist | Re-run with approval disabled — fully autonomous end-to-end while showing terminal/Firestore updates (Proof of Action). |
| 3:50–4:00 | Close | One line: "Agents that act, governed by design. Built on Gemini, ADK, and Google Cloud." |
