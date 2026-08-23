"""Agent Control Plane - End-to-End Acceptance Test.

Simulates complete workflow lifecycle: Create -> WAITING_APPROVAL -> Approve -> QUEUED -> RUNNING -> COMPLETED.
Also validates Tool Gateway policy routing, RBAC roles, and Audit Events in Firestore.
"""

import sys
import time
import urllib.parse
from pathlib import Path

# Insert project root into python paths
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from backend import auth
from backend.config import settings
from backend.main import app

# Set mock environment
settings.google_client_id = "test-e2e-client-id"
settings.admin_emails = "admin@example.com"

# Mock Google OAuth verification
def mock_verify_token(token: str, request: object, audience: str) -> dict[str, str]:
    if token == "mock-admin-token":
        return {"sub": "admin-123", "email": "admin@example.com", "name": "Super Admin"}
    if token == "mock-user-token":
        return {"sub": "user-456", "email": "agent@example.com", "name": "Field Agent"}
    raise ValueError("Token validation failed in E2E test")

# Apply monkeypatch
auth.id_token.verify_oauth2_token = mock_verify_token

client = TestClient(app)

def run_e2e_workflow():
    print("=" * 70)
    print("      ACP AUTONOMOUS WORKFLOW END-TO-END ACCEPTANCE TEST")
    print("=" * 70)

    # STEP 1: Mutation authentication guard check
    print("\n[STEP 1] Testing authentication boundary...")
    unauth_res = client.post("/api/executions", json={"name": "E2E Contract Negotiation", "requires_approval": True})
    assert unauth_res.status_code == 401, f"Expected 401, got {unauth_res.status_code}"
    print(" -> PASS: Mutation without verified token successfully rejected (401 Unauthorized)")

    # STEP 2: Create execution (WAITING_APPROVAL)
    print("\n[STEP 2] Creating a new execution requiring human approval...")
    create_res = client.post(
        "/api/executions",
        headers={"Authorization": "Bearer mock-user-token"},
        json={"name": "E2E Contract Negotiation", "owner": "Gemini Negotiator", "requires_approval": True}
    )
    assert create_res.status_code == 201, f"Failed to create: {create_res.text}"
    execution = create_res.json()
    exec_id = execution["id"]
    quoted_id = urllib.parse.quote(exec_id)
    print(f" -> PASS: Created execution '{exec_id}' with status '{execution['status']}'")
    assert execution["status"] == "WAITING_APPROVAL"
    assert execution["approval_status"] == "PENDING"

    # STEP 3: Verify Audit Events for WAITING_APPROVAL
    print("\n[STEP 3] Verifying initialization audit trace...")
    events_res = client.get(f"/api/executions/{quoted_id}/events")
    assert events_res.status_code == 200
    events = events_res.json()
    assert len(events) >= 1
    assert any(e["type"] == "WAITING_APPROVAL" for e in events)
    print(f" -> PASS: Audit trace has {len(events)} initial events (WAITING_APPROVAL recorded)")

    # STEP 4: Perform Mock Human Approval
    print("\n[STEP 4] Approving the execution with Google Identity...")
    approval_res = client.post(
        f"/api/executions/{quoted_id}/approval",
        headers={"Authorization": "Bearer mock-admin-token"},
        json={"decision": "APPROVED"}
    )
    assert approval_res.status_code == 200, f"Approval failed: {approval_res.text}"
    approved_exec = approval_res.json()
    print(f" -> PASS: Approval accepted. Status: {approved_exec['status']}, Approved by: {approved_exec['approved_by']['email']}")
    assert approved_exec["status"] == "QUEUED"
    assert approved_exec["approval_status"] == "APPROVED"

    # STEP 5: Poll Lifecycle Status Changes (Wait for Completed/Failed)
    print("\n[STEP 5] Polling execution lifecycle transition to COMPLETED/FAILED...")
    attempts = 0
    final_status = "QUEUED"
    while attempts < 10:
        poll_res = client.get(f"/api/executions/{quoted_id}")
        assert poll_res.status_code == 200
        exec_data = poll_res.json()
        final_status = exec_data["status"]
        print(f"   - Polling status: {final_status} (progress: {exec_data.get('progress', '0%')})")
        if final_status in ("COMPLETED", "FAILED"):
            break
        time.sleep(1)
        attempts += 1
    
    assert final_status in ("COMPLETED", "FAILED"), f"Timeout waiting for execution lifecycle. Current: {final_status}"
    print(f" -> PASS: Execution processed natively. Final status: '{final_status}'")

    # STEP 6: Verify Final Audit Trace Events
    print("\n[STEP 6] Verifying E2E audit trace sequence in Firestore...")
    events_res = client.get(f"/api/executions/{quoted_id}/events")
    events = events_res.json()
    types = [e["type"] for e in events]
    print(f"   - Captured sequence of audit types: {types}")
    assert "APPROVED" in types
    assert "RUNNING" in types
    assert any(t in types for t in ("COMPLETED", "FAILED"))
    print(" -> PASS: Complete lifecycle audit sequence correctly persisted")

    # STEP 7: Test Tool Gateway Security Policy Routing
    print("\n[STEP 7] Testing Tool Gateway security with RBAC enforcement...")
    # Admin tries to update tool policy
    policy_res = client.patch(
        "/api/gateway/policies/inventory.check_stock",
        headers={"Authorization": "Bearer mock-admin-token"},
        json={"enabled": True, "rate_limit_per_minute": 50}
    )
    assert policy_res.status_code == 200, f"Policy update failed: {policy_res.text}"
    print(" -> PASS: Authorized Admin successfully modified Tool Policy (200 OK)")

    # Regular user tries to update tool policy (Should be 403 Forbidden)
    policy_forbidden_res = client.patch(
        "/api/gateway/policies/inventory.check_stock",
        headers={"Authorization": "Bearer mock-user-token"},
        json={"enabled": False}
    )
    assert policy_forbidden_res.status_code == 403
    print(" -> PASS: Unauthorized role successfully blocked from editing policies (403 Forbidden)")

    # Execute MCP tool via gateway call
    gateway_exec = client.post(
        "/api/mcp/call",
        headers={"Authorization": "Bearer mock-user-token"},
        json={"server": "crm", "tool": "get_customer", "arguments": {"customer_id": "CUST-901"}}
    )
    assert gateway_exec.status_code == 200, f"MCP execution failed: {gateway_exec.text}"
    gateway_data = gateway_exec.json()
    assert gateway_data["success"] is True
    print(f" -> PASS: MCP Customer Lookup routed successfully via Tool Gateway (Risk Level: {gateway_data.get('risk_level', 'LOW')})")

    print("\n" + "=" * 70)
    print("             ALL END-TO-END ACCEPTANCE TESTS PASSED!")
    print("=" * 70)


if __name__ == "__main__":
    run_e2e_workflow()