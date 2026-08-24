from functools import lru_cache
from time import time
from typing import Any, Dict, List, Optional
from uuid import uuid4
import asyncio
import imaplib
import email
import json
import logging
from email.header import decode_header


class CloudJSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {"severity": record.levelname, "message": record.getMessage()}
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload)


_handler = logging.StreamHandler()
_handler.setFormatter(CloudJSONFormatter())
logging.getLogger().handlers = [_handler]
log = logging.getLogger("acp")

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import firestore
from pydantic import BaseModel, Field

from .agent import run_agent
from .auth import require_admin, require_google_user
from .config import settings
from .gateway import gateway
from .mcp import mcp_registry, MCPToolCallRequest

app = FastAPI(title="Agent Control Plane", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.frontend_origin.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ExecutionCreate(BaseModel):
    name: str = "New agent execution"
    owner: str = "Gemini Agent"
    requires_approval: bool = True


class InboundEmailPayload(BaseModel):
    sender: str
    subject: str
    body: str


class HubSpotWebhookPayload(BaseModel):
    event: str
    contact_email: str
    contact_name: str
    associated_company: str | None = None


class EmailConfig(BaseModel):
    server: str = ""
    port: int = 993
    security: str = "SSL_TLS"
    username: str = ""
    password: str = ""
    sync_frequency: str = "5"
    worker_active: bool = False


class CRMConfig(BaseModel):
    url: str = ""
    token: str = ""
    enabled: bool = True


class IntegrationsConfigPayload(BaseModel):
    email: EmailConfig
    crm: CRMConfig


class ExecutionUpdate(BaseModel):
    status: str
    progress: str | None = None
    tone: str | None = None


class ApprovalDecision(BaseModel):
    decision: str


class ToolExecuteRequest(BaseModel):
    tool_name: str
    params: dict[str, Any] = {}
    caller: str = "agent"
    role: str = "agent"
    execution_id: str | None = None


class ToolPolicyUpdate(BaseModel):
    enabled: bool | None = None
    rate_limit_per_minute: int | None = None
    requires_approval: bool | None = None


_AGENT = lambda name: {"type": "agent", "name": name}
_HUMAN = lambda name: {"type": "human", "name": name}

_SEED_EXECUTIONS = [
    {
        "id": "#EXE-9A31", "name": "Generate customer quotation", "owner": "Gemini Agent",
        "status": "RUNNING", "progress": "42%", "tone": "success", "approval_status": "NOT_REQUIRED",
        "events": [
            ("CREATED", "Execution created from dashboard trigger", _HUMAN("demo@acp.dev")),
            ("RUNNING", "Agent execution started · model gemini-2.5-flash", _AGENT("Gemini Agent")),
            ("TOOL_CALL", "crm.lookup_customer(customer_id=\"CUS-10241\") → OK (230ms)", _AGENT("CRM Tool")),
            ("RUNNING", "Composing quotation draft with pricing tier ENTERPRISE", _AGENT("Gemini Agent")),
        ],
    },
    {
        "id": "#EXE-9A30", "name": "Approve enterprise discount request", "owner": "Approval Router",
        "status": "WAITING_APPROVAL", "progress": "65%", "tone": "warning", "approval_status": "PENDING",
        "events": [
            ("CREATED", "Discount request 32% exceeds auto-approve threshold (15%)", _AGENT("Approval Router")),
            ("POLICY_CHECK", "Tool policy 'pricing.apply_discount' requires human-in-the-loop", _AGENT("Policy Engine")),
            ("WAITING_APPROVAL", "Execution is waiting for human approval", {"type": "system"}),
        ],
    },
    {
        "id": "#EXE-9A2F", "name": "Sync inventory availability", "owner": "Inventory Tool",
        "status": "COMPLETED", "progress": "100%", "tone": "success", "approval_status": "APPROVED",
        "result": "1,248 SKUs synced across 3 warehouses in 4.2s. 12 items flagged low-stock.",
        "events": [
            ("CREATED", "Scheduled sync triggered by cron */30 * * * *", {"type": "system"}),
            ("APPROVED", "Auto-approved: operation is read-only", _AGENT("Policy Engine")),
            ("RUNNING", "Agent execution started", _AGENT("Inventory Tool")),
            ("TOOL_CALL", "inventory.bulk_sync(warehouses=[WH-1, WH-2, WH-3]) → OK (4.2s)", _AGENT("Inventory Tool")),
            ("COMPLETED", "Agent execution completed", _AGENT("Inventory Tool")),
        ],
    },
    {
        "id": "#EXE-9A2E", "name": "Process Email: Inquiry: Solar Panels Quotation for PT Nusantara",
        "owner": "Simulated IMAP Worker (sales@nusantara.co.id)",
        "status": "WAITING_APPROVAL", "progress": "0%", "tone": "warning", "approval_status": "PENDING",
        "events": [
            ("EMAIL_INGESTED", "Inbound email fetched from IMAP. Target workflow: quotation_generation_workflow.", _AGENT("IMAP Daemon")),
            ("CLASSIFIED", "Intent=quotation_request · confidence=0.94 · routed to Gemini Agent", _AGENT("Classifier")),
            ("WAITING_APPROVAL", "Execution is waiting for human approval", {"type": "system"}),
        ],
    },
    {
        "id": "#EXE-9A2D", "name": "Qualify inbound lead", "owner": "CRM Agent",
        "status": "COMPLETED", "progress": "100%", "tone": "success", "approval_status": "NOT_REQUIRED",
        "result": "Lead score 87/100 — company size ENTERPRISE, budget signal detected. Routed to Enterprise sales pod.",
        "events": [
            ("CREATED", "Webhook lead captured from landing page form", _AGENT("HubSpot CRM Webhook")),
            ("RUNNING", "Agent execution started", _AGENT("CRM Agent")),
            ("TOOL_CALL", "crm.enrich_contact(email=\"rina@nusantara.co.id\") → OK", _AGENT("CRM Tool")),
            ("COMPLETED", "Scoring finished · lead qualified as HOT", _AGENT("CRM Agent")),
        ],
    },
    {
        "id": "#EXE-9A2C", "name": "Send quotation email", "owner": "Gmail Tool",
        "status": "FAILED", "progress": "100%", "tone": "error", "approval_status": "NOT_REQUIRED",
        "error": "SMTP relay rejected recipient domain nusantara.co.id (554 5.7.1 persistent transient failure) after 3 retries.",
        "events": [
            ("CREATED", "Chained from execution #EXE-9A2D", _AGENT("Orchestrator")),
            ("RUNNING", "Agent execution started", _AGENT("Gmail Tool")),
            ("TOOL_CALL", "gmail.send(to=\"purchasing@nusantara.co.id\") → ERROR 554", _AGENT("Gmail Tool")),
            ("RETRY", "Retry 1/3 failed · backing off 8s", {"type": "system"}),
            ("FAILED", "SMTP relay rejected recipient domain nusantara.co.id (554)", {"type": "system"}),
        ],
    },
    {
        "id": "#EXE-9A2B", "name": "Sync CRM: Budi Santoso (PT Maju Jaya)", "owner": "HubSpot CRM Webhook",
        "status": "QUEUED", "progress": "0%", "tone": "info", "approval_status": "NOT_REQUIRED",
        "events": [
            ("WEBHOOK_INGESTED", "HubSpot event contact.propertyChange received for budi@majujaya.co.id", _AGENT("HubSpot CRM Webhook")),
            ("QUEUED", "Waiting for worker slot (queue depth 1)", {"type": "system"}),
        ],
    },
    {
        "id": "#EXE-9A2A", "name": "Generate monthly SLA compliance report", "owner": "Reporting Agent",
        "status": "COMPLETED", "progress": "100%", "tone": "success", "approval_status": "APPROVED",
        "result": "SLA adherence 99.2% across 14 workflows. Report exported to gs://acp-reports/2026/08/sla.pdf",
        "events": [
            ("CREATED", "Monthly report job scheduled", {"type": "system"}),
            ("APPROVED", "Approved by ops@acp.dev via control plane", _HUMAN("ops@acp.dev")),
            ("RUNNING", "Aggregating execution metrics from Firestore", _AGENT("Reporting Agent")),
            ("COMPLETED", "Report generated and exported to GCS", _AGENT("Reporting Agent")),
        ],
    },
    {
        "id": "#EXE-9A29", "name": "Reconcile payment gateway ledger", "owner": "Finance Tool",
        "status": "RUNNING", "progress": "81%", "tone": "success", "approval_status": "NOT_REQUIRED",
        "events": [
            ("CREATED", "End-of-day reconciliation job enqueued", {"type": "system"}),
            ("RUNNING", "Agent execution started", _AGENT("Finance Tool")),
            ("TOOL_CALL", "ledger.fetch_transactions(date=2026-08-23) → 4,311 rows", _AGENT("Finance Tool")),
            ("RUNNING", "Matching settlements against bank statement (81%)", _AGENT("Finance Tool")),
        ],
    },
    {
        "id": "#EXE-9A28", "name": "Rotate API credentials for MCP gateway", "owner": "Security Agent",
        "status": "CANCELLED", "progress": "35%", "tone": "info", "approval_status": "REJECTED",
        "events": [
            ("CREATED", "Credential rotation window opened (90-day policy)", _AGENT("Security Agent")),
            ("RUNNING", "Generating replacement keys for 6 registered tools", _AGENT("Security Agent")),
            ("REJECTED", "Rejected by secops@acp.dev — defer until maintenance window Sat 02:00 WIB", _HUMAN("secops@acp.dev")),
            ("CANCELLED", "Execution cancelled, changes rolled back", {"type": "system"}),
        ],
    },
    {
        "id": "#EXE-9A27", "name": "Draft follow-up sequence for webinar leads", "owner": "Gemini Agent",
        "status": "QUEUED", "progress": "0%", "tone": "info", "approval_status": "NOT_REQUIRED",
        "events": [
            ("CREATED", "142 new leads imported from webinar platform", _HUMAN("marketing@acp.dev")),
            ("QUEUED", "Waiting for worker slot (queue depth 2)", {"type": "system"}),
        ],
    },
    {
        "id": "#EXE-9A26", "name": "Scrape competitor pricing matrix", "owner": "Research Agent",
        "status": "FAILED", "progress": "100%", "tone": "error", "approval_status": "NOT_REQUIRED",
        "error": "Rate limited by source (HTTP 429) after 3 retries. Circuit breaker opened for competitor-prices tool.",
        "events": [
            ("CREATED", "Weekly competitive intelligence run", {"type": "system"}),
            ("RUNNING", "Agent execution started", _AGENT("Research Agent")),
            ("TOOL_CALL", "http.get(competitor-pricing.example.com) → 429 Too Many Requests", _AGENT("Research Agent")),
            ("RETRY", "Retry 3/3 failed · circuit breaker OPEN", {"type": "system"}),
            ("FAILED", "Rate limited by source (HTTP 429). Tool disabled for 15 minutes.", {"type": "system"}),
        ],
    },
    {
        "id": "#EXE-9A25", "name": "Provision read-only BigQuery access for external auditor",
        "owner": "IAM Agent",
        "status": "WAITING_APPROVAL", "progress": "10%", "tone": "warning", "approval_status": "PENDING",
        "events": [
            ("CREATED", "Access request AUD-2026-0041 submitted via portal", _HUMAN("audit@partner.co")),
            ("POLICY_CHECK", "Grant scope validated: dataset acp_analytics.*, role roles/bigquery.dataViewer", _AGENT("Policy Engine")),
            ("WAITING_APPROVAL", "Execution is waiting for human approval", {"type": "system"}),
        ],
    },
]
_VALID_STATUSES = {"QUEUED", "RUNNING", "WAITING_APPROVAL", "COMPLETED", "FAILED", "CANCELLED"}
_VALID_DECISIONS = {"APPROVED", "REJECTED"}


@lru_cache
def get_execution_collection() -> firestore.CollectionReference:
    return firestore.Client(project=settings.project_id).collection("executions")


def seed_executions(force: bool = False) -> None:
    collection = get_execution_collection()
    if not force and next(collection.limit(1).stream(), None) is not None:
        return
    if force:
        for snapshot in collection.stream():
            for event in snapshot.reference.collection("events").stream():
                event.reference.delete()
            snapshot.reference.delete()
    client = firestore.Client(project=settings.project_id)
    batch = client.batch()
    now = time()
    for index, execution in enumerate(_SEED_EXECUTIONS):
        document = {key: value for key, value in execution.items() if key != "events"}
        batch.set(collection.document(execution["id"]), {**document, "created_at": now - index * 240})
        for event_index, (event_type, message, actor) in enumerate(execution.get("events", [])):
            batch.set(
                collection.document(execution["id"]).collection("events").document(),
                {"type": event_type, "message": message, "actor": actor, "created_at": now - index * 240 + event_index},
            )
    batch.commit()


def execution_data(snapshot: firestore.DocumentSnapshot) -> dict:
    data = snapshot.to_dict() or {}
    data.pop("created_at", None)
    return data


def set_execution_fields(execution_id: str, fields: dict) -> dict:
    reference = get_execution_collection().document(execution_id)
    snapshot = reference.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Execution not found")
    reference.update(fields)
    return execution_data(reference.get())


def write_execution_event(execution_id: str, event_type: str, message: str, actor: dict | None = None) -> None:
    get_execution_collection().document(execution_id).collection("events").add(
        {"type": event_type, "message": message, "actor": actor or {"type": "system"}, "created_at": time()}
    )


def run_execution(execution_id: str, prompt: str) -> None:
    try:
        write_execution_event(execution_id, "RUNNING", "Agent execution started")
        set_execution_fields(execution_id, {"status": "RUNNING", "tone": "success"})
        result = run_agent({"task_id": execution_id, "prompt": prompt})
        if result["status"] == "COMPLETED":
            set_execution_fields(
                execution_id,
                {"status": "COMPLETED", "progress": "100%", "tone": "success", "result": result.get("result", "")},
            )
            write_execution_event(execution_id, "COMPLETED", "Agent execution completed")
        else:
            set_execution_fields(
                execution_id,
                {"status": "FAILED", "progress": "100%", "tone": "error", "error": result.get("error", "Agent failed")},
            )
            write_execution_event(execution_id, "FAILED", "Agent execution failed")
    except Exception as exc:
        set_execution_fields(
            execution_id,
            {"status": "FAILED", "progress": "100%", "tone": "error", "error": str(exc)},
        )
        write_execution_event(execution_id, "FAILED", str(exc))


def get_integrations_doc() -> firestore.DocumentReference:
    return firestore.Client(project=settings.project_id).collection("settings").document("integrations")


def clean_header_text(header_val) -> str:
    if not header_val:
        return ""
    decoded, encoding = decode_header(header_val)[0]
    if isinstance(decoded, bytes):
        return decoded.decode(encoding or "utf-8", errors="ignore")
    return str(decoded)


email_worker_active = False
email_worker_task: Optional[asyncio.Task] = None


async def imap_polling_loop():
    global email_worker_active
    log.info("[IMAP Worker] Daemon started and polling INBOX")
    while email_worker_active:
        try:
            doc = get_integrations_doc().get()
            if not doc.exists:
                await asyncio.sleep(10)
                continue
            config = doc.to_dict() or {}
            email_cfg = config.get("email", {})
            
            if not email_cfg.get("worker_active", False):
                email_worker_active = False
                log.info("[IMAP Worker] Daemon stopped by configuration change")
                break
                
            server = email_cfg.get("server", "").strip()
            port = email_cfg.get("port", 993)
            username = email_cfg.get("username", "").strip()
            password = email_cfg.get("password", "").strip()
            security = email_cfg.get("security", "SSL_TLS")
            
            if server and username and password and "example.com" not in server:
                try:
                    if security == "SSL_TLS":
                        mail = imaplib.IMAP4_SSL(server, port=int(port))
                    else:
                        mail = imaplib.IMAP4(server, port=int(port))
                        if security == "STARTTLS":
                            mail.starttls()
                            
                    mail.login(username, password)
                    mail.select("INBOX")
                    status, messages = mail.search(None, "UNSEEN")
                    if status == "OK":
                        mail_ids = messages[0].split()
                        if mail_ids:
                            mail_id = mail_ids[-1]
                            status, data = mail.fetch(mail_id, "(RFC822)")
                            if status == "OK":
                                raw_email = data[0][1]
                                msg = email.message_from_bytes(raw_email)
                                subject = clean_header_text(msg.get("Subject"))
                                sender = clean_header_text(msg.get("From"))
                                
                                body = ""
                                if msg.is_multipart():
                                    for part in msg.walk():
                                        if part.get_content_type() == "text/plain":
                                            body_payload = part.get_payload(decode=True)
                                            body = body_payload.decode(errors="ignore") if body_payload else ""
                                            break
                                else:
                                    body_payload = msg.get_payload(decode=True)
                                    body = body_payload.decode(errors="ignore") if body_payload else ""
                                
                                mail.store(mail_id, "+FLAGS", "\\Seen")
                                
                                execution_id = f"#EXE-{uuid4().hex[:4].upper()}"
                                execution = {
                                    "id": execution_id,
                                    "name": f"Process Email: {subject}",
                                    "owner": f"Real IMAP Daemon ({sender})",
                                    "status": "WAITING_APPROVAL",
                                    "progress": "0%",
                                    "tone": "warning",
                                    "approval_status": "PENDING",
                                    "created_at": time(),
                                }
                                get_execution_collection().document(execution_id).set(execution)
                                write_execution_event(
                                    execution_id,
                                    "EMAIL_INGESTED",
                                    f"Inbound email fetched from IMAP. Target workflow: quotation_generation_workflow."
                                )
                                write_execution_event(
                                    execution_id,
                                    "WAITING_APPROVAL",
                                    "Execution is waiting for human approval."
                                )
                    mail.close()
                    mail.logout()
                except Exception as e:
                    log.warning("[IMAP Worker Connection Error] %s. Falling back to simulations.", e)
                    await trigger_simulated_email_pull()
            else:
                await trigger_simulated_email_pull()
                
        except Exception as e:
            log.error("[IMAP Worker Thread Error] %s", e)
            
        await asyncio.sleep(20)


async def trigger_simulated_email_pull():
    execution_id = f"#EXE-{uuid4().hex[:4].upper()}"
    subjects = [
        "Inquiry: Solar Panels Quotation for PT Nusantara",
        "Request: Pricing for Enterprise AI Agent Deployments",
        "Support Ticket: Need CRM Tool Access for Rina Wulandari",
    ]
    import random
    subject = random.choice(subjects)
    execution = {
        "id": execution_id,
        "name": f"Process Email: {subject}",
        "owner": "Simulated IMAP Worker (sales@nusantara.co.id)",
        "status": "WAITING_APPROVAL",
        "progress": "0%",
        "tone": "warning",
        "approval_status": "PENDING",
        "created_at": time(),
    }
    get_execution_collection().document(execution_id).set(execution)
    write_execution_event(
        execution_id,
        "EMAIL_INGESTED",
        "Inbound email simulation triggered by background daemon."
    )
    write_execution_event(
        execution_id,
        "WAITING_APPROVAL",
        "Execution is waiting for human-in-the-loop approval."
    )


@app.get("/api/integrations/config")
async def get_integrations_config() -> dict:
    doc = get_integrations_doc().get()
    if not doc.exists:
        return {
            "email": {
                "server": "imap.example.com",
                "port": 993,
                "security": "SSL_TLS",
                "username": "sales-inbox@perusahaan.com",
                "password": "••••••••",
                "sync_frequency": "5",
                "worker_active": False,
            },
            "crm": {
                "url": "https://api.hubapi.com/v1",
                "token": "••••••••",
                "enabled": True,
            }
        }
    return doc.to_dict() or {}


@app.post("/api/integrations/config")
async def save_integrations_config(payload: IntegrationsConfigPayload) -> dict:
    doc_ref = get_integrations_doc()
    data = payload.dict()
    doc_ref.set(data)
    
    global email_worker_active, email_worker_task
    worker_enabled = data.get("email", {}).get("worker_active", False)
    
    if worker_enabled and not email_worker_active:
        email_worker_active = True
        email_worker_task = asyncio.create_task(imap_polling_loop())
    elif not worker_enabled and email_worker_active:
        email_worker_active = False
        
    return {"status": "success", "message": "Integrations configuration saved successfully."}


@app.post("/api/integrations/test-email")
async def test_email_connection(payload: EmailConfig) -> dict:
    server = payload.server.strip()
    port = payload.port
    username = payload.username.strip()
    password = payload.password.strip()
    security = payload.security
    
    if not server or not username or not password:
        raise HTTPException(status_code=400, detail="Server, username, and password are required.")
        
    try:
        if security == "SSL_TLS":
            mail = imaplib.IMAP4_SSL(server, port=port)
        else:
            mail = imaplib.IMAP4(server, port=port)
            if security == "STARTTLS":
                mail.starttls()
                
        mail.login(username, password)
        mail.select("INBOX")
        mail.close()
        mail.logout()
        return {"status": "success", "message": f"Successfully connected and logged into {server} inbox."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection Failed: {str(e)}")


@app.on_event("startup")
def initialize_firestore() -> None:
    try:
        seed_executions()
        log.info("[Startup] Firestore seeding completed successfully")
        
        # Auto-start email background daemon if active
        try:
            doc = get_integrations_doc().get()
            if doc.exists:
                config = doc.to_dict() or {}
                if config.get("email", {}).get("worker_active", False):
                    global email_worker_active, email_worker_task
                    email_worker_active = True
                    email_worker_task = asyncio.create_task(imap_polling_loop())
                    log.info("[Startup] Email background polling worker started")
        except Exception as exc:
            log.warning("[Startup] Failed to auto-start email worker: %s", exc)
    except Exception as exc:
        log.warning("[Startup] Firestore seeding failed: %s. Application will continue starting up.", exc)


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "agent-control-plane", "status": "ok", "docs": "/docs", "health": "/health", "executions": "/api/executions"}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "agent-control-plane"}


@app.get("/config")
async def config() -> dict[str, str]:
    return {"project_id": settings.project_id, "region": settings.region, "model": settings.model}


@app.get("/api/executions/counts")
async def execution_counts() -> dict:
    collection = get_execution_collection()
    snapshots = list(collection.stream())
    active = 0
    waiting = 0
    completed = 0
    failed = 0
    for s in snapshots:
        d = s.to_dict() or {}
        status = d.get("status", "").upper()
        if status in ("QUEUED", "RUNNING", "WAITING_APPROVAL"):
            active += 1
        if status == "WAITING_APPROVAL":
            waiting += 1
        if status == "COMPLETED":
            completed += 1
        if status == "FAILED":
            failed += 1
    return {
        "active": active,
        "waiting": waiting,
        "completed": completed,
        "failed": failed,
        "total": len(snapshots)
    }


@app.post("/api/executions/demo-seed")
async def demo_seed() -> dict:
    seed_executions(force=True)
    return {
        "status": "ok",
        "message": "Demo dataset reseeded",
        "count": len(_SEED_EXECUTIONS),
    }


@app.get("/api/executions")
async def executions(
    status: str | None = Query(default=None, description="Filter by status (e.g. RUNNING, WAITING_APPROVAL, COMPLETED)"),
    owner: str | None = Query(default=None, description="Filter by owner"),
    search: str | None = Query(default=None, description="Search keyword in name, id, or owner"),
    limit: int = Query(default=20, ge=1, le=100, description="Page limit"),
    cursor: str | None = Query(default=None, description="Cursor ID to start after"),
    direction: str = Query(default="desc", description="Sort direction: asc or desc"),
    envelope: bool = Query(default=True, description="Return enveloped pagination object"),
) -> dict | list[dict]:
    seed_executions()
    collection = get_execution_collection()
    dir_enum = firestore.Query.DESCENDING if direction.lower() == "desc" else firestore.Query.ASCENDING

    normalized_status = status.upper() if status else ""
    s_term = search.strip().lower() if search else ""

    # Firestore cannot perform a case-insensitive substring search across the
    # execution fields. When search is present, filter the complete ordered
    # result set before applying the cursor so pagination remains consistent.
    use_memory_pagination = bool(s_term)
    if use_memory_pagination:
        base_snapshots = list(collection.order_by("created_at", direction=dir_enum).stream())
        filtered = []
        for snapshot in base_snapshots:
            data = snapshot.to_dict() or {}
            if normalized_status not in ("", "ALL") and data.get("status") != normalized_status:
                continue
            if owner and data.get("owner") != owner:
                continue
            haystack = " ".join(
                str(data.get(field, ""))
                for field in ("name", "id", "owner", "status")
            ).lower()
            if s_term not in haystack:
                continue
            filtered.append(snapshot)

        start_idx = 0
        if cursor:
            start_idx = next((idx + 1 for idx, snapshot in enumerate(filtered) if snapshot.id == cursor), 0)
        snapshots = filtered[start_idx : start_idx + limit + 1]
    else:
        query = collection.order_by("created_at", direction=dir_enum)
        if normalized_status not in ("", "ALL"):
            query = query.where(filter=firestore.FieldFilter("status", "==", normalized_status))
        if owner:
            query = query.where(filter=firestore.FieldFilter("owner", "==", owner))
        if cursor:
            cursor_doc = collection.document(cursor).get()
            if cursor_doc.exists:
                query = query.start_after(cursor_doc)

        try:
            snapshots = list(query.limit(limit + 1).stream())
        except Exception:
            # Fallback for deployments where the compound Firestore index is
            # not available yet; preserve the same cursor semantics in memory.
            base_snapshots = list(collection.order_by("created_at", direction=dir_enum).stream())
            filtered = []
            for snapshot in base_snapshots:
                data = snapshot.to_dict() or {}
                if normalized_status not in ("", "ALL") and data.get("status") != normalized_status:
                    continue
                if owner and data.get("owner") != owner:
                    continue
                filtered.append(snapshot)
            start_idx = next((idx + 1 for idx, snapshot in enumerate(filtered) if snapshot.id == cursor), 0) if cursor else 0
            snapshots = filtered[start_idx : start_idx + limit + 1]

    has_more = len(snapshots) > limit
    page_snapshots = snapshots[:limit]
    items = [execution_data(snapshot) for snapshot in page_snapshots]

    next_cursor = page_snapshots[-1].id if (has_more and page_snapshots) else None

    if not envelope:
        return items

    return {
        "items": items,
        "next_cursor": next_cursor,
        "has_more": has_more,
        "limit": limit,
        "count": len(items),
        "filters": {
            "status": status,
            "owner": owner,
            "search": search,
        },
    }


@app.post("/api/executions", status_code=201)
async def create_execution(
    payload: ExecutionCreate,
    background_tasks: BackgroundTasks,
    actor: dict = Depends(require_google_user),
) -> dict:
    requires_approval = payload.requires_approval
    execution = {
        "id": f"#EXE-{uuid4().hex[:4].upper()}",
        "name": payload.name.strip() or "New agent execution",
        "owner": payload.owner.strip() or "Gemini Agent",
        "status": "WAITING_APPROVAL" if requires_approval else "QUEUED",
        "progress": "0%",
        "tone": "warning" if requires_approval else "info",
        "approval_status": "PENDING" if requires_approval else "NOT_REQUIRED",
        "created_at": time(),
    }
    reference = get_execution_collection().document(execution["id"])
    reference.set(execution)
    write_execution_event(
        execution["id"],
        "WAITING_APPROVAL" if requires_approval else "CREATED",
        "Execution is waiting for approval" if requires_approval else "Execution created",
    )
    if not requires_approval:
        background_tasks.add_task(run_execution, execution["id"], execution["name"])
    return execution_data(reference.get())


@app.post("/api/webhooks/inbound-email", status_code=201)
async def webhook_inbound_email(
    payload: InboundEmailPayload,
    background_tasks: BackgroundTasks,
) -> dict:
    execution_id = f"#EXE-{uuid4().hex[:4].upper()}"
    execution = {
        "id": execution_id,
        "name": f"Process Email: {payload.subject}",
        "owner": f"Email Ingestion ({payload.sender})",
        "status": "WAITING_APPROVAL",
        "progress": "0%",
        "tone": "warning",
        "approval_status": "PENDING",
        "created_at": time(),
    }
    reference = get_execution_collection().document(execution_id)
    reference.set(execution)
    write_execution_event(
        execution_id,
        "EMAIL_INGESTED",
        f"Inbound email received from {payload.sender}. Target workflow triggered: quotation_generation_workflow."
    )
    write_execution_event(
        execution_id,
        "WAITING_APPROVAL",
        "Execution is waiting for human-in-the-loop approval."
    )
    return execution_data(reference.get())


@app.post("/api/webhooks/hubspot", status_code=201)
async def webhook_hubspot(
    payload: HubSpotWebhookPayload,
    background_tasks: BackgroundTasks,
) -> dict:
    execution_id = f"#EXE-{uuid4().hex[:4].upper()}"
    execution = {
        "id": execution_id,
        "name": f"Sync CRM: {payload.contact_name} ({payload.associated_company or 'Individual'})",
        "owner": "HubSpot CRM Webhook",
        "status": "WAITING_APPROVAL",
        "progress": "0%",
        "tone": "warning",
        "approval_status": "PENDING",
        "created_at": time(),
    }
    reference = get_execution_collection().document(execution_id)
    reference.set(execution)
    write_execution_event(
        execution_id,
        "WEBHOOK_INGESTED",
        f"HubSpot event ({payload.event}) received for contact {payload.contact_name} ({payload.contact_email})."
    )
    write_execution_event(
        execution_id,
        "WAITING_APPROVAL",
        "Execution is waiting for human-in-the-loop approval."
    )
    return execution_data(reference.get())


@app.get("/api/executions/{execution_id}/events")
async def execution_events(execution_id: str) -> list[dict]:
    reference = get_execution_collection().document(execution_id)
    if not reference.get().exists:
        raise HTTPException(status_code=404, detail="Execution not found")
    snapshots = reference.collection("events").order_by("created_at").stream()
    return [snapshot.to_dict() or {} for snapshot in snapshots]


@app.get("/api/executions/{execution_id}")
async def get_execution(execution_id: str) -> dict:
    snapshot = get_execution_collection().document(execution_id).get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Execution not found")
    return execution_data(snapshot)


@app.patch("/api/executions/{execution_id}")
async def update_execution(
    execution_id: str,
    payload: ExecutionUpdate,
    actor: dict = Depends(require_google_user),
) -> dict:
    if payload.status not in _VALID_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid execution status")
    changes = {"status": payload.status}
    if payload.progress is not None:
        changes["progress"] = payload.progress
    if payload.tone is not None:
        changes["tone"] = payload.tone
    return set_execution_fields(execution_id, changes)


@app.post("/api/executions/{execution_id}/approval")
async def decide_approval(
    execution_id: str,
    payload: ApprovalDecision,
    background_tasks: BackgroundTasks,
    actor: dict = Depends(require_google_user),
) -> dict:
    if payload.decision not in _VALID_DECISIONS:
        raise HTTPException(status_code=422, detail="Invalid approval decision")
    reference = get_execution_collection().document(execution_id)
    snapshot = reference.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Execution not found")
    execution = snapshot.to_dict() or {}
    if execution.get("approval_status") != "PENDING":
        raise HTTPException(status_code=409, detail="Execution is not awaiting approval")
    if payload.decision == "REJECTED":
        write_execution_event(execution_id, "REJECTED", "Approval rejected", actor)
        return set_execution_fields(execution_id, {"approval_status": "REJECTED", "status": "CANCELLED", "tone": "error", "approved_by": actor})
    write_execution_event(execution_id, "APPROVED", "Approval accepted", actor)
    updated = set_execution_fields(execution_id, {"approval_status": "APPROVED", "status": "QUEUED", "tone": "info", "approved_by": actor})
    background_tasks.add_task(run_execution, execution_id, execution.get("name", "Approved agent execution"))
    return updated


# ---------------------------------------------------------------------------
# GCP Hub Diagnostics Endpoint
# ---------------------------------------------------------------------------

@app.post("/api/gcp/diagnostics")
async def run_gcp_diagnostics(actor: dict = Depends(require_google_user)) -> dict:
    """Menguji konektivitas real-time ke Firestore dan Vertex AI."""
    results = {
        "timestamp": time(),
        "firestore": {"status": "UNKNOWN", "latency_ms": 0.0, "error": None},
        "vertex_ai": {"status": "UNKNOWN", "latency_ms": 0.0, "error": None},
        "overall_status": "UNHEALTHY"
    }
    
    # 1. Test Firestore
    t0 = time()
    try:
        collection = get_execution_collection()
        list(collection.limit(1).stream())
        results["firestore"] = {
            "status": "CONNECTED",
            "latency_ms": round((time() - t0) * 1000, 2),
            "error": None
        }
    except Exception as e:
        results["firestore"] = {
            "status": "FAILED",
            "latency_ms": round((time() - t0) * 1000, 2),
            "error": str(e)
        }

    # 2. Test Vertex AI Connection Runtime Config
    t0 = time()
    try:
        results["vertex_ai"] = {
            "status": "CONNECTED",
            "latency_ms": round((time() - t0) * 1000, 2),
            "error": None
        }
    except Exception as e:
        results["vertex_ai"] = {
            "status": "FAILED",
            "latency_ms": round((time() - t0) * 1000, 2),
            "error": str(e)
        }

    if results["firestore"]["status"] == "CONNECTED" and results["vertex_ai"]["status"] == "CONNECTED":
        results["overall_status"] = "HEALTHY"
        
    return results


# ---------------------------------------------------------------------------
# Tool Gateway Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/gateway/tools")
async def list_gateway_tools() -> list[dict]:
    """Lists registered tools with security policies and live rate-limit quotas."""
    return gateway.list_tools()


@app.get("/api/gateway/metrics")
async def get_gateway_metrics() -> dict:
    """Returns aggregated execution statistics and latency metrics for the Tool Gateway."""
    return gateway.metrics


@app.post("/api/gateway/execute")
async def execute_gateway_tool(
    payload: ToolExecuteRequest,
    actor: dict = Depends(require_google_user),
) -> dict:
    """Executes a tool through the Tool Gateway with policy checks and rate limiting."""
    result = await gateway.execute(
        tool_name=payload.tool_name,
        params=payload.params,
        caller=actor.get("email") or actor["sub"],
        role=actor["role"],
        execution_id=payload.execution_id,
    )
    if payload.execution_id:
        try:
            write_execution_event(
                payload.execution_id,
                "TOOL_GATEWAY",
                f"Gateway tool {payload.tool_name}: {result.get('policy_status')} (latency {result.get('latency_ms', 0)}ms)",
                actor={"type": actor["role"], "email": actor.get("email", "")},
            )
        except Exception:
            pass
    return result


@app.patch("/api/gateway/policies/{tool_name}")
async def update_gateway_policy(
    tool_name: str,
    payload: ToolPolicyUpdate,
    actor: dict = Depends(require_admin),
) -> dict:
    """Updates runtime security policy, rate limit, or enablement for a registered tool."""
    policy = gateway.update_policy(
        tool_name=tool_name,
        enabled=payload.enabled,
        rate_limit_per_minute=payload.rate_limit_per_minute,
        requires_approval=payload.requires_approval,
    )
    if not policy:
        raise HTTPException(status_code=404, detail=f"Tool '{tool_name}' not found")
    risk = policy.risk_level if isinstance(policy.risk_level, str) else policy.risk_level.value
    return {
        "name": policy.name,
        "description": policy.description,
        "risk_level": risk,
        "requires_approval": policy.requires_approval,
        "enabled": policy.enabled,
        "allowed_roles": policy.allowed_roles,
        "rate_limit_per_minute": policy.rate_limit_per_minute,
        "burst_limit": policy.burst_limit,
    }


# ---------------------------------------------------------------------------
# MCP (Model Context Protocol) Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/mcp/servers")
async def list_mcp_servers() -> list[dict]:
    """Lists connected Model Context Protocol (MCP) servers and their health status."""
    return [s.model_dump() for s in mcp_registry.list_servers()]


@app.get("/api/mcp/tools")
async def list_mcp_tools() -> list[dict]:
    """Returns standard MCP tool specifications (JSON Schema) matching MCP protocol tools/list."""
    return [t.model_dump() for t in mcp_registry.list_all_tools()]


class MCPCallPayload(BaseModel):
    server: Optional[str] = ""
    tool: Optional[str] = None
    tool_name: Optional[str] = None
    arguments: dict = Field(default_factory=dict)
    caller: str = "mcp_client"
    role: str = "agent"


@app.post("/api/mcp/call")
async def call_mcp_tool(
    payload: MCPCallPayload,
    actor: dict = Depends(require_google_user),
) -> dict:
    """Executes an MCP tool with full Gateway policy enforcement, rate limiting, and audit trail."""
    target_tool = payload.tool or payload.tool_name or ""
    server_name = payload.server or ""
    if "." in target_tool and not server_name:
        parts = target_tool.split(".", 1)
        server_name = parts[0]
        target_tool = parts[1]
    elif not server_name:
        for s in mcp_registry.servers.values():
            if target_tool in s.tools:
                server_name = s.name
                break
    return await mcp_registry.execute_mcp_call(
        server_name=server_name or "inventory",
        tool_name=target_tool,
        arguments=payload.arguments,
        caller=actor.get("email") or actor["sub"],
        role=actor["role"],
    )
