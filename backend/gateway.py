import logging
import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import time
from typing import Any, Callable

from .config import settings

log = logging.getLogger(__name__)


@dataclass
class ToolPolicy:
    name: str
    description: str
    risk_level: str = "LOW"  # LOW, MEDIUM, HIGH, CRITICAL
    requires_approval: bool = False
    enabled: bool = True
    allowed_roles: list[str] = field(default_factory=lambda: ["agent", "admin", "system"])
    rate_limit_per_minute: int = 30
    burst_limit: int = 10


class SlidingWindowRateLimiter:
    """Sliding-window rate limiter supporting both in-memory and Firestore backend for distributed scaling."""

    def __init__(self, use_firestore: bool | None = None) -> None:
        self._history: dict[str, list[float]] = {}
        self._lock = asyncio.Lock()
        self.use_firestore = (
            settings.rate_limit_backend.strip().lower() == "firestore"
            if use_firestore is None
            else use_firestore
        )
        self._db = None

    def _get_db(self):
        if self.use_firestore and self._db is None:
            try:
                from google.cloud import firestore
                self._db = firestore.Client(project=settings.project_id)
            except Exception as e:
                log.warning("[RateLimiter] Firestore init failed: %s", e)
        return self._db

    def _get_key(self, tool_name: str, caller: str) -> str:
        return f"{tool_name}:{caller}"

    async def acquire(self, tool_name: str, caller: str, limit_per_minute: int) -> tuple[bool, dict[str, Any]]:
        if self.use_firestore:
            db = self._get_db()
            if not db:
                # Fail closed in distributed mode. Falling back to a process-
                # local limiter would make the configured quota unsafe across
                # Cloud Run instances.
                return False, {
                    "limit": limit_per_minute,
                    "current": 0,
                    "remaining": 0,
                    "reset_in_seconds": 5.0,
                    "backend": "firestore_unavailable",
                }
            try:
                return await self._acquire_firestore(db, tool_name, caller, limit_per_minute)
            except Exception as exc:
                log.warning("[RateLimiter] Firestore acquire failed: %s", exc)
                return False, {
                    "limit": limit_per_minute,
                    "current": 0,
                    "remaining": 0,
                    "reset_in_seconds": 5.0,
                    "backend": "firestore_unavailable",
                }

        return await self._acquire_in_memory(tool_name, caller, limit_per_minute)

    async def _acquire_in_memory(self, tool_name: str, caller: str, limit_per_minute: int) -> tuple[bool, dict[str, Any]]:
        async with self._lock:
            key = self._get_key(tool_name, caller)
            now = time.time()
            cutoff = now - 60.0

            timestamps = [ts for ts in self._history.get(key, []) if ts > cutoff]
            self._history[key] = timestamps

            remaining = max(0, limit_per_minute - len(timestamps))
            reset_in = 60.0 - (now - timestamps[0]) if timestamps else 0.0

            if len(timestamps) >= limit_per_minute:
                return False, {
                    "limit": limit_per_minute,
                    "current": len(timestamps),
                    "remaining": 0,
                    "reset_in_seconds": round(max(0.0, reset_in), 1),
                }

            timestamps.append(now)
            self._history[key] = timestamps
            return True, {
                "limit": limit_per_minute,
                "current": len(timestamps),
                "remaining": remaining - 1,
                "reset_in_seconds": round(max(0.0, reset_in), 1),
            }

    async def _acquire_firestore(self, db, tool_name: str, caller: str, limit_per_minute: int) -> tuple[bool, dict[str, Any]]:
        key = self._get_key(tool_name, caller)
        doc_id = hashlib.sha256(key.encode("utf-8")).hexdigest()
        doc_ref = db.collection("gateway_rate_limits").document(doc_id)

        from google.cloud import firestore

        @firestore.transactional
        def transaction_logic(transaction):
            now = time.time()
            cutoff = now - 60.0

            snapshot = doc_ref.get(transaction=transaction)
            data = snapshot.to_dict() if snapshot and snapshot.exists else {}
            timestamps = [float(ts) for ts in data.get("timestamps", [])]

            # Filter old timestamps
            timestamps = [ts for ts in timestamps if ts > cutoff]

            remaining = max(0, limit_per_minute - len(timestamps))
            reset_in = 60.0 - (now - timestamps[0]) if timestamps else 0.0

            if len(timestamps) >= limit_per_minute:
                return False, {
                    "limit": limit_per_minute,
                    "current": len(timestamps),
                    "remaining": 0,
                    "reset_in_seconds": round(max(0.0, reset_in), 1),
                }

            timestamps.append(now)
            transaction.set(doc_ref, {
                "tool_name": tool_name,
                "caller_hash": doc_id,
                "timestamps": timestamps,
                "updated_at": now,
            })
            return True, {
                "limit": limit_per_minute,
                "current": len(timestamps),
                "remaining": remaining - 1,
                "reset_in_seconds": round(max(0.0, reset_in), 1),
            }

        transaction = db.transaction()
        allowed, rate_info = await asyncio.to_thread(transaction_logic, transaction)
        rate_info["backend"] = "firestore"
        return allowed, rate_info

    async def get_usage(self, tool_name: str, caller: str, limit_per_minute: int) -> dict[str, Any]:
        db = self._get_db()
        if db:
            try:
                key = self._get_key(tool_name, caller)
                doc_id = hashlib.sha256(key.encode("utf-8")).hexdigest()
                doc_ref = db.collection("gateway_rate_limits").document(doc_id)
                snapshot = await asyncio.to_thread(doc_ref.get)
                if snapshot.exists:
                    data = snapshot.to_dict() or {}
                    timestamps = data.get("timestamps", [])
                    now = time.time()
                    cutoff = now - 60.0
                    timestamps = [ts for ts in timestamps if ts > cutoff]
                    return {
                        "limit": limit_per_minute,
                        "current": len(timestamps),
                        "remaining": max(0, limit_per_minute - len(timestamps)),
                        "backend": "firestore",
                    }
            except Exception as e:
                log.warning("[RateLimiter] Firestore get_usage failed: %s", e)

            return {
                "limit": limit_per_minute,
                "current": 0,
                "remaining": 0,
                "backend": "firestore_unavailable",
            }

        return await self._get_usage_in_memory(tool_name, caller, limit_per_minute)

    async def _get_usage_in_memory(self, tool_name: str, caller: str, limit_per_minute: int) -> dict[str, Any]:
        async with self._lock:
            key = self._get_key(tool_name, caller)
            now = time.time()
            cutoff = now - 60.0
            timestamps = [ts for ts in self._history.get(key, []) if ts > cutoff]
            self._history[key] = timestamps
            return {
                "limit": limit_per_minute,
                "current": len(timestamps),
                "remaining": max(0, limit_per_minute - len(timestamps)),
            }


class ToolGateway:
    """Central gateway enforcing security policies, authorization, rate limits, and audit logs for tools."""

    def __init__(self) -> None:
        self.rate_limiter = SlidingWindowRateLimiter()
        self.policies: dict[str, ToolPolicy] = {}
        self.handlers: dict[str, Callable[[dict[str, Any]], Any]] = {}
        self.aliases: dict[str, str] = {
            "check_inventory": "inventory.check_stock",
            "check_stock": "inventory.check_stock",
            "get_customer_details": "crm.get_customer",
            "get_customer": "crm.get_customer",
            "update_customer_crm": "crm.update_customer",
            "update_customer": "crm.update_customer",
            "generate_quotation": "quotation.generate",
            "send_quotation_email": "email.send_quotation",
            "query_system_metrics": "gcp.query_metrics",
            "query_metrics": "gcp.query_metrics",
        }
        self.metrics: dict[str, Any] = {
            "total_requests": 0,
            "allowed_requests": 0,
            "blocked_by_policy": 0,
            "blocked_by_rate_limit": 0,
            "tool_call_counts": {},
            "recent_invocations": [],
        }
        self._register_default_tools()

    def register_tool(
        self,
        policy: ToolPolicy,
        handler: Callable[[dict[str, Any]], Any] | None = None,
    ) -> None:
        self.policies[policy.name] = policy
        if handler:
            self.handlers[policy.name] = handler
        if policy.name not in self.metrics["tool_call_counts"]:
            self.metrics["tool_call_counts"][policy.name] = 0

    def _register_default_tools(self) -> None:
        # 1. Inventory Tool
        def check_stock_handler(params: dict[str, Any]) -> dict[str, Any]:
            item = params.get("item", "generic_item")
            return {
                "item": item,
                "available": True,
                "stock_quantity": 420,
                "warehouse": "JKT-01",
                "last_synced": datetime.now(timezone.utc).isoformat(),
            }

        self.register_tool(
            ToolPolicy(
                name="inventory.check_stock",
                description="Checks warehouse inventory availability and stock levels.",
                risk_level="LOW",
                requires_approval=False,
                rate_limit_per_minute=60,
            ),
            check_stock_handler,
        )

        # 2. CRM Lookup
        def get_customer_handler(params: dict[str, Any]) -> dict[str, Any]:
            customer_id = params.get("customer_id", "CUST-101")
            return {
                "customer_id": customer_id,
                "company_name": "PT Nusantara Tech",
                "tier": "ENTERPRISE",
                "contact": "Rina Wulandari",
                "email": "rina@nusantara.co.id",
                "status": "ACTIVE",
            }

        self.register_tool(
            ToolPolicy(
                name="crm.get_customer",
                description="Fetches customer details and account status from CRM.",
                risk_level="LOW",
                requires_approval=False,
                rate_limit_per_minute=30,
            ),
            get_customer_handler,
        )

        # 3. CRM Update
        def update_customer_handler(params: dict[str, Any]) -> dict[str, Any]:
            customer_id = params.get("customer_id", "CUST-101")
            return {
                "customer_id": customer_id,
                "updated_fields": params.get("fields", {}),
                "status": "UPDATED",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

        self.register_tool(
            ToolPolicy(
                name="crm.update_customer",
                description="Updates customer record and activity history in CRM.",
                risk_level="MEDIUM",
                requires_approval=False,
                rate_limit_per_minute=15,
            ),
            update_customer_handler,
        )

        # 4. Quotation Generator
        def generate_quotation_handler(params: dict[str, Any]) -> dict[str, Any]:
            amount = params.get("amount", 24500000)
            items = params.get("items", [{"name": "Enterprise Agent License", "qty": 1, "price": amount}])
            return {
                "quotation_id": f"QUO-{int(time.time())}",
                "total_amount": amount,
                "currency": "IDR",
                "items": items,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

        self.register_tool(
            ToolPolicy(
                name="quotation.generate",
                description="Generates standard commercial quotations with pricing models.",
                risk_level="MEDIUM",
                requires_approval=False,
                rate_limit_per_minute=20,
            ),
            generate_quotation_handler,
        )

        # 5. Send Quotation Email (HIGH RISK - requires approval)
        def send_email_handler(params: dict[str, Any]) -> dict[str, Any]:
            recipient = params.get("recipient", "client@domain.com")
            subject = params.get("subject", "Commercial Quotation")
            return {
                "status": "SENT",
                "recipient": recipient,
                "subject": subject,
                "message_id": f"msg-{int(time.time())}@acp.internal",
                "sent_at": datetime.now(timezone.utc).isoformat(),
            }

        self.register_tool(
            ToolPolicy(
                name="email.send_quotation",
                description="Sends commercial quotation email to external customer.",
                risk_level="HIGH",
                requires_approval=True,
                rate_limit_per_minute=5,
            ),
            send_email_handler,
        )

        # 6. GCP Monitoring Query
        def gcp_metrics_handler(params: dict[str, Any]) -> dict[str, Any]:
            metric = params.get("metric", "cloudrun.googleapis.com/container/cpu/utilizations")
            return {
                "metric": metric,
                "project_id": "acp-hackathon-2026-505906",
                "points": [{"timestamp": time.time(), "value": 0.12}],
                "status": "OK",
            }

        self.register_tool(
            ToolPolicy(
                name="gcp.query_metrics",
                description="Retrieves telemetry and latency metrics from Cloud Monitoring.",
                risk_level="LOW",
                requires_approval=False,
                rate_limit_per_minute=60,
            ),
            gcp_metrics_handler,
        )

    def list_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": policy.name,
                "description": policy.description,
                "risk_level": policy.risk_level,
                "requires_approval": policy.requires_approval,
                "enabled": policy.enabled,
                "allowed_roles": policy.allowed_roles,
                "rate_limit_per_minute": policy.rate_limit_per_minute,
            }
            for policy in self.policies.values()
        ]

    async def execute(
        self,
        tool_name: str,
        params: dict[str, Any],
        caller: str = "agent",
        role: str = "agent",
        execution_id: str | None = None,
    ) -> dict[str, Any]:
        """Validates policy, checks rate limit, invokes handler, and updates metrics."""
        self.metrics["total_requests"] += 1
        start_time = time.time()
        resolved_name = self.aliases.get(tool_name, tool_name)

        policy = self.policies.get(resolved_name)
        if not policy:
            self.metrics["blocked_by_policy"] += 1
            return {
                "success": False,
                "error": f"Tool '{tool_name}' is not registered in Tool Gateway",
                "policy_status": "DENIED_UNKNOWN_TOOL",
                "execution_id": execution_id,
            }

        if not policy.enabled:
            self.metrics["blocked_by_policy"] += 1
            return {
                "success": False,
                "error": f"Tool '{resolved_name}' is currently disabled by gateway policy",
                "policy_status": "DENIED_DISABLED",
                "execution_id": execution_id,
            }

        if role not in policy.allowed_roles:
            self.metrics["blocked_by_policy"] += 1
            return {
                "success": False,
                "error": f"Role '{role}' is not authorized to execute '{resolved_name}'. Allowed: {policy.allowed_roles}",
                "policy_status": "DENIED_UNAUTHORIZED_ROLE",
                "execution_id": execution_id,
            }

        # Rate Limit Check
        allowed, rate_info = await self.rate_limiter.acquire(
            tool_name=resolved_name,
            caller=caller,
            limit_per_minute=policy.rate_limit_per_minute,
        )

        if not allowed:
            self.metrics["blocked_by_rate_limit"] += 1
            return {
                "success": False,
                "error": f"Rate limit exceeded for tool '{resolved_name}'. Limit: {rate_info['limit']}/min. Retry in {rate_info['reset_in_seconds']}s",
                "policy_status": "DENIED_RATE_LIMITED",
                "rate_limit": rate_info,
                "execution_id": execution_id,
            }

        # Execute Tool Handler
        handler = self.handlers.get(resolved_name)
        if not handler:
            return {
                "success": False,
                "error": f"No execution handler registered for tool '{tool_name}'",
                "policy_status": "ALLOWED_NO_HANDLER",
                "execution_id": execution_id,
            }

        try:
            if asyncio.iscoroutinefunction(handler):
                result = await handler(params)
            else:
                result = handler(params)

            duration_ms = round((time.time() - start_time) * 1000, 2)
            self.metrics["allowed_requests"] += 1
            self.metrics["tool_call_counts"][tool_name] = (
                self.metrics["tool_call_counts"].get(tool_name, 0) + 1
            )

            record = {
                "tool_name": tool_name,
                "caller": caller,
                "role": role,
                "execution_id": execution_id,
                "success": True,
                "policy_status": "ALLOWED",
                "rate_limit": rate_info,
                "duration_ms": duration_ms,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "result": result,
            }

            # Keep only last 20 recent invocations
            self.metrics["recent_invocations"].insert(0, {
                "tool_name": tool_name,
                "caller": caller,
                "execution_id": execution_id,
                "duration_ms": duration_ms,
                "success": True,
                "timestamp": record["timestamp"],
            })
            self.metrics["recent_invocations"] = self.metrics["recent_invocations"][:20]

            return record

        except Exception as exc:
            duration_ms = round((time.time() - start_time) * 1000, 2)
            return {
                "success": False,
                "error": f"Tool execution failed: {str(exc)}",
                "policy_status": "EXECUTION_ERROR",
                "duration_ms": duration_ms,
                "execution_id": execution_id,
            }

    def update_policy(
        self,
        tool_name: str,
        enabled: bool | None = None,
        rate_limit_per_minute: int | None = None,
        requires_approval: bool | None = None,
    ) -> ToolPolicy | None:
        policy = self.policies.get(tool_name)
        if not policy:
            return None
        if enabled is not None:
            policy.enabled = enabled
        if rate_limit_per_minute is not None:
            policy.rate_limit_per_minute = rate_limit_per_minute
        if requires_approval is not None:
            policy.requires_approval = requires_approval
        return policy


gateway = ToolGateway()
