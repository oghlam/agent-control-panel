"""Small dependency-free auth/RBAC smoke test for the local FastAPI app."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from backend import auth
from backend.config import settings
from backend.main import app


settings.google_client_id = "security-smoke-client"
settings.admin_emails = "admin@example.com"


def verify_token(token: str, request: object, audience: str) -> dict[str, str]:
    if token == "user-token":
        return {"sub": "user-sub", "email": "user@example.com", "name": "User"}
    if token == "admin-token":
        return {"sub": "admin-sub", "email": "admin@example.com", "name": "Admin"}
    raise ValueError("invalid token")


auth.id_token.verify_oauth2_token = verify_token
client = TestClient(app)

assert client.post("/api/executions", json={}).status_code == 401
assert client.post(
    "/api/executions", headers={"Authorization": "Bearer invalid"}, json={}
).status_code == 401

spoofed_role = client.post(
    "/api/gateway/execute",
    headers={"Authorization": "Bearer user-token"},
    json={"tool_name": "check_inventory", "role": "admin", "params": {"sku": "SKU-PRO-01"}},
)
assert spoofed_role.status_code == 200, spoofed_role.text
assert spoofed_role.json()["role"] == "agent"

assert client.patch(
    "/api/gateway/policies/inventory.check_stock",
    headers={"Authorization": "Bearer user-token"},
    json={"enabled": False},
).status_code == 403

assert client.patch(
    "/api/gateway/policies/not-a-tool",
    headers={"Authorization": "Bearer admin-token"},
    json={"enabled": False},
).status_code == 404

print("SECURITY_AUTH_RBAC_OK")
