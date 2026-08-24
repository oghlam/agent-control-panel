# Agent Control Plane — Project Overview

> One-page overview of ACP for judges, reviewers, and new contributors.
> Category: **The Taskmaster** — All Things Agentic Hackathon 2026.

## What is ACP?

Agent Control Plane (ACP) is a production-style control plane where autonomous
Gemini agents run real multi-step business workflows in the background — and a
human only steps in when the policy says so. Every action the agent takes is
gated by policy, bound to a verified identity when a human approves it, and
recorded on an immutable audit trail.

Most agent demos stop at chat. ACP proves execution.

## The Problem

A typical B2B sales quote workflow is manual and unaudited: read email → check
stock → look up customer → write quote → send. Five human steps, zero audit,
and hours of delay per request.

## The Solution

An inbound email or CRM webhook spawns an execution. The Gemini agent plans
and acts through a secured Tool Gateway, updates Firestore state, and produces
a full audit trace of every step:

```text
[Event Sources] → [Agent Runtime] → [Tool Gateway] → [MCP Tools] → [GCP Infra]
  email/webhook     Gemini + ADK      RBAC/risk/rate    business     Cloud Run
  IMAP daemon       Vertex AI         fail-closed       tools        Firestore
```

Demo workflow: a customer emails asking for a quotation → execution created →
agent checks inventory, looks up the customer, generates and sends the quote →
every tool call passes RBAC, risk classification (LOW→CRITICAL), and shared
sliding-window rate limits.

## Key Capabilities

- **Execution lifecycle**: QUEUED → RUNNING → WAITING_APPROVAL → COMPLETED /
  FAILED / CANCELLED, persisted in Firestore, polled live in the dashboard.
- **Human-in-the-loop approvals**: approve/reject requires a verified Google
  ID token; the actor (sub, email, name) is stored in the audit trail.
  Workflows can also run fully autonomous (`requires_approval=false`).
- **Tool Gateway**: role-based access control (agent/admin from verified
  Google identity), risk classification, and per-tool sliding-window rate
  limits backed by Firestore transactions — one shared quota across all Cloud
  Run instances, fail-closed.
- **MCP ecosystem**: four typed MCP servers (inventory, crm, email, gcp
  monitoring) over JSON-RPC 2.0 behind the same gateway boundary.
- **Event ingestion**: inbound email + HubSpot webhook endpoints plus a
  background IMAP polling daemon.
- **Audit trace**: every lifecycle event and human decision recorded in a
  Firestore subcollection — the single source of truth, viewable in the UI.
- **Operations dashboard**: dark ops UI — execution queue with search +
  cursor pagination, approval panel, gateway policy console, MCP tester,
  event sources manager, GCP diagnostics.

## Technology Stack

| Layer | Technology |
|---|---|
| Agent runtime | Google ADK 2.7.1, Gemini 3.5 Flash via Vertex AI |
| Backend | Python 3.12, FastAPI, Uvicorn on Cloud Run |
| Data & state | Firestore (executions, audit events, rate-limit state) |
| Identity | Google OAuth (verified Web Client ID tokens) |
| Frontend | Next.js App Router, TypeScript |
| Deployment | Cloud Run (multi-stage non-root container), Cloud Build |

## Try It

- Backend (live): https://acp-backend-627792456859.us-central1.run.app
- Demo video (4 min): https://youtu.be/jc5g__1-8Y0 (`docs/demo_video/acp_demo_submission.mp4`)
- Local spin-up: see `README.md` (Installation)

## Documentation Map

| Document | Purpose |
|---|---|
| `README.md` | Product intro, installation, runbook, screenshots |
| `WHY_ACP.md` | Business case: what/why/who/how |
| `docs/DEVPOST_SUBMISSION.md` | Devpost form text, checklists, video shot list |
| `docs/architecture.svg` | Architecture diagram |
| `PROJECT_CONTEXT.md` | Technical handoff report for developers/agents |
| `PROJECT_PROGRESS.md` | Milestone log |
| `SECURITY_READINESS.md` | Security review notes |
| `CLOUD_RUN.md` | Deployment details |

## Status

Feature-complete and frozen for the hackathon demo; bug fixes only.
Submission deadline: Aug 31, 2026 5:00 PM PDT.
