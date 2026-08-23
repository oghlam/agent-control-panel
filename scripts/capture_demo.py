"""Automated demo capture: screenshots + video against the live Cloud Run frontend.

Lifecycle transitions are driven by writing directly to Firestore so the
dashboard's 3-second polling shows real GCP state changes without OAuth.
Usage: ./venv/bin/python scripts/capture_demo.py [--url https://...] [--keep-local]
"""

import argparse
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen

from google.cloud import firestore
from playwright.sync_api import sync_playwright

PROJECT_ID = "acp-hackathon-2026-505906"
DEFAULT_URL = "https://acp-frontend-627792456859.us-central1.run.app"
OUT = Path(__file__).resolve().parent.parent / "docs" / "screenshot"

db = firestore.Client(project=PROJECT_ID)


def seed_execution(name: str, owner: str, status: str, tone: str, approval: str) -> str:
    exec_id = f"#EXE-{int(time.time()) % 0xFFFF:04X}"
    db.collection("executions").document(exec_id).set(
        {
            "id": exec_id,
            "name": name,
            "owner": owner,
            "status": status,
            "progress": "50%" if status == "RUNNING" else ("100%" if status in ("COMPLETED", "FAILED") else "0%"),
            "tone": tone,
            "approval_status": approval,
            "created_at": time.time(),
        }
    )
    return exec_id


def transition(exec_id: str, fields: dict, event_type: str, message: str) -> None:
    db.collection("executions").document(exec_id).update(fields)
    db.collection("executions").document(exec_id).collection("events").add(
        {"type": event_type, "message": message, "actor": {"type": "system"}, "created_at": time.time()}
    )


def ingest_webhook(base_url: str) -> None:
    payload = b'{"sender":"buyer@nusantara.co.id","subject":"Quotation request: 40x solar panels","body":"Please send your best quotation for 40 units."}'
    req = Request(f"{base_url}/api/webhooks/inbound-email", data=payload, headers={"Content-Type": "application/json"})
    urlopen(req, timeout=30).read()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    video_dir = OUT.parent / "demo_video"
    video_dir.mkdir(exist_ok=True)

    # Pre-seed variety so the queue looks alive from second one.
    seed_execution("Sync inventory availability", "Inventory Tool", "RUNNING", "success", "NOT_REQUIRED")
    seed_execution("Qualify inbound CRM lead", "CRM Agent", "WAITING_APPROVAL", "warning", "PENDING")
    seed_execution("Archive Q2 metrics snapshot", "Metrics Tool", "COMPLETED", "success", "NOT_REQUIRED")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(
            viewport={"width": 1600, "height": 900},
            record_video_dir=str(video_dir),
            record_video_size={"width": 1600, "height": 900},
        )
        page = context.new_page()
        page.goto(args.url, wait_until="networkidle", timeout=60000)
        time.sleep(8)  # let initial fetch + first poll land
        page.screenshot(path=str(OUT / "01_dashboard_overview.png"))

        # Ingestion -> new WAITING_APPROVAL row appears via polling.
        ingest_webhook(args.url.replace("acp-frontend", "acp-backend"))
        time.sleep(6)
        page.screenshot(path=str(OUT / "02_inbound_email_execution.png"))
        latest = list(db.collection("executions").order_by("created_at", direction=firestore.Query.DESCENDING).limit(1).stream())
        exec_id = latest[0].id

        # Drive lifecycle: RUNNING -> COMPLETED, visible through polling.
        transition(exec_id, {"status": "RUNNING", "progress": "45%", "tone": "info"}, "RUNNING", "Agent execution started")
        time.sleep(5)
        transition(
            exec_id,
            {"status": "COMPLETED", "progress": "100%", "tone": "success",
             "result": "Quotation QT-40SP prepared: 40x solar panels, total USD 18,400, sent to buyer@nusantara.co.id"},
            "COMPLETED",
            "Agent execution completed",
        )
        time.sleep(6)
        page.screenshot(path=str(OUT / "03_execution_completed.png"))

        # Trace disclosure attempt (best effort, DOM-dependent).
        try:
            page.get_by_text(exec_id).first.click()
            time.sleep(1)
            page.get_by_text("Trace", exact=False).first.click()
            time.sleep(2)
            page.screenshot(path=str(OUT / "04_audit_trace.png"))
        except Exception as exc:
            print(f"trace capture skipped: {exc}")

        for tab, filename in [
            ("Tool Gateway", "05_tool_gateway.png"),
            ("MCP", "06_mcp_protocol.png"),
            ("Event Sources", "07_event_sources.png"),
            ("System Health", "08_system_health.png"),
            ("Settings", "09_settings.png"),
        ]:
            try:
                page.get_by_text(tab, exact=False).first.click()
                time.sleep(3)
                page.screenshot(path=str(OUT / filename))
            except Exception as exc:
                print(f"tab '{tab}' skipped: {exc}")

        video_path = page.video.path()
        context.close()
        browser.close()
        print(f"VIDEO_RAW={video_path}")
    print("CAPTURE_DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
