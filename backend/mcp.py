"""Model Context Protocol (MCP) Server & Tool Adapters for Agent Control Plane.

Implements JSON-RPC 2.0 based MCP tool definitions, server lifecycle,
and bridging to the ACP Tool Gateway.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine, Dict, List, Optional
from pydantic import BaseModel, Field

from .gateway import ToolPolicy, ToolGateway


class MCPToolInputSchema(BaseModel):
    """JSON Schema defining tool arguments."""
    type: str = "object"
    properties: Dict[str, Any] = Field(default_factory=dict)
    required: List[str] = Field(default_factory=list)


class MCPToolDefinition(BaseModel):
    """MCP standard tool specification."""
    name: str
    description: str
    inputSchema: MCPToolInputSchema
    risk_level: str = "LOW"
    requires_approval: bool = False
    rate_limit_per_minute: int = 30
    allowed_roles: List[str] = Field(default_factory=lambda: ["agent", "admin", "system"])
    server_name: str = "default"


class MCPToolCallRequest(BaseModel):
    """MCP JSON-RPC tools/call request payload."""
    name: str
    arguments: Dict[str, Any] = Field(default_factory=dict)


class MCPToolContent(BaseModel):
    """MCP standard content block."""
    type: str = "text"
    text: str


class MCPToolCallResult(BaseModel):
    """MCP JSON-RPC tools/call response payload."""
    content: List[MCPToolContent]
    isError: bool = False
    metadata: Dict[str, Any] = Field(default_factory=dict)


class MCPServerInfo(BaseModel):
    """MCP Server metadata."""
    name: str
    version: str = "1.0.0"
    protocol_version: str = "2024-11-05"
    description: str
    status: str = "CONNECTED"
    tools_count: int = 0


@dataclass
class RegisteredMCPTool:
    definition: MCPToolDefinition
    handler: Callable[..., Any]


class MCPServer:
    """In-process and protocol-compliant MCP Server."""

    def __init__(self, name: str, description: str, version: str = "1.0.0"):
        self.name = name
        self.description = description
        self.version = version
        self.tools: Dict[str, RegisteredMCPTool] = {}
        self.connected_at = datetime.now(timezone.utc)

    def register_tool(
        self,
        name: str,
        description: str,
        input_schema: Dict[str, Any],
        handler: Callable[..., Any],
        risk_level: str = "LOW",
        requires_approval: bool = False,
        rate_limit_per_minute: int = 30,
        allowed_roles: Optional[List[str]] = None,
    ) -> None:
        """Register a tool to this MCP Server."""
        defn = MCPToolDefinition(
            name=name,
            description=description,
            inputSchema=MCPToolInputSchema(
                type="object",
                properties=input_schema.get("properties", {}),
                required=input_schema.get("required", []),
            ),
            risk_level=risk_level,
            requires_approval=requires_approval,
            rate_limit_per_minute=rate_limit_per_minute,
            allowed_roles=allowed_roles or ["agent", "admin", "system"],
            server_name=self.name,
        )
        self.tools[name] = RegisteredMCPTool(definition=defn, handler=handler)

    def list_tools(self) -> List[MCPToolDefinition]:
        """Return list of MCP tools matching MCP protocol tools/list."""
        return [t.definition for t in self.tools.values()]

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> MCPToolCallResult:
        """Execute tool following MCP protocol tools/call."""
        if name not in self.tools:
            return MCPToolCallResult(
                content=[MCPToolContent(type="text", text=f"Tool '{name}' not found on server '{self.name}'.")],
                isError=True,
            )

        reg = self.tools[name]
        try:
            if asyncio.iscoroutinefunction(reg.handler):
                result = await reg.handler(**arguments)
            else:
                result = reg.handler(**arguments)

            import json
            text_repr = json.dumps(result, default=str) if isinstance(result, (dict, list)) else str(result)
            return MCPToolCallResult(
                content=[MCPToolContent(type="text", text=text_repr)],
                isError=False,
                metadata={"server": self.name, "timestamp": datetime.now(timezone.utc).isoformat()},
            )
        except Exception as exc:
            return MCPToolCallResult(
                content=[MCPToolContent(type="text", text=f"Execution error: {exc}")],
                isError=True,
            )

    def get_info(self) -> MCPServerInfo:
        return MCPServerInfo(
            name=self.name,
            version=self.version,
            description=self.description,
            status="CONNECTED",
            tools_count=len(self.tools),
        )


class MCPRegistry:
    """Central registry of all connected MCP Servers & Gateway bridge."""

    def __init__(self, gateway: ToolGateway):
        self.gateway = gateway
        self.servers: Dict[str, MCPServer] = {}

    def register_server(self, server: MCPServer) -> None:
        """Add an MCP Server and mount all its tools into the ACP Tool Gateway."""
        self.servers[server.name] = server

        # Mount tools into Gateway with adapter to support dict params or kwargs
        for tool_name, reg in server.tools.items():
            defn = reg.definition
            canonical_name = f"{server.name}.{tool_name}"
            raw_handler = reg.handler

            def _make_handler(fn: Callable[..., Any]) -> Callable[[Dict[str, Any]], Coroutine[Any, Any, Any]]:
                async def _adapter(params: Dict[str, Any]) -> Any:
                    kwargs = params if isinstance(params, dict) else {}
                    if asyncio.iscoroutinefunction(fn):
                        return await fn(**kwargs)
                    return fn(**kwargs)
                return _adapter

            self.gateway.register_tool(
                policy=ToolPolicy(
                    name=canonical_name,
                    description=f"[{server.name}] {defn.description}",
                    risk_level=defn.risk_level,
                    requires_approval=defn.requires_approval,
                    rate_limit_per_minute=defn.rate_limit_per_minute,
                    allowed_roles=defn.allowed_roles,
                ),
                handler=_make_handler(raw_handler),
            )

    def list_servers(self) -> List[MCPServerInfo]:
        return [s.get_info() for s in self.servers.values()]

    def list_all_tools(self) -> List[MCPToolDefinition]:
        all_tools: List[MCPToolDefinition] = []
        for s in self.servers.values():
            all_tools.extend(s.list_tools())
        return all_tools

    async def execute_mcp_call(
        self,
        server_name: str,
        tool_name: str,
        arguments: Dict[str, Any],
        caller: str = "agent",
        role: str = "agent",
    ) -> Dict[str, Any]:
        """Route tool call through Gateway security policy, then to MCP Server."""
        gateway_tool_name = f"{server_name}.{tool_name}"
        res = await self.gateway.execute(
            tool_name=gateway_tool_name,
            params=arguments,
            caller=caller,
            role=role,
        )
        return res


# =====================================================================
# Built-in Minimal MCP Business Servers
# =====================================================================

def build_inventory_mcp_server() -> MCPServer:
    """Warehouse & Inventory Management MCP Server."""
    server = MCPServer(
        name="inventory",
        description="Warehouse inventory lookup, location tracking, and stock reservation.",
        version="1.0.0",
    )

    async def check_stock(sku: str, warehouse_id: str = "WH-JKT-01") -> Dict[str, Any]:
        catalog = {
            "SKU-PRO-01": {"name": "Industrial Sensor Hub v2", "stock": 42, "unit_price_idr": 4500000},
            "SKU-PRO-02": {"name": "Edge Gateway Pro", "stock": 18, "unit_price_idr": 8200000},
            "SKU-PRO-03": {"name": "Wireless Telemetry Node", "stock": 105, "unit_price_idr": 1250000},
        }
        item = catalog.get(sku.upper(), {"name": f"Unknown SKU {sku}", "stock": 5, "unit_price_idr": 500000})
        return {
            "sku": sku.upper(),
            "product_name": item["name"],
            "warehouse": warehouse_id,
            "available_stock": item["stock"],
            "unit_price_idr": item["unit_price_idr"],
            "status": "IN_STOCK" if item["stock"] > 0 else "OUT_OF_STOCK",
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }

    async def reserve_stock(sku: str, quantity: int, order_id: str) -> Dict[str, Any]:
        return {
            "reservation_id": f"RES-{datetime.now(timezone.utc).strftime('%H%M%S')}",
            "sku": sku.upper(),
            "quantity": quantity,
            "order_id": order_id,
            "status": "RESERVED",
            "expires_in_minutes": 30,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    server.register_tool(
        name="check_stock",
        description="Check real-time stock levels and warehouse availability for a SKU.",
        input_schema={
            "properties": {
                "sku": {"type": "string", "description": "SKU code, e.g. SKU-PRO-01"},
                "warehouse_id": {"type": "string", "description": "Warehouse identifier", "default": "WH-JKT-01"},
            },
            "required": ["sku"],
        },
        handler=check_stock,
        risk_level="LOW",
        rate_limit_per_minute=60,
    )

    server.register_tool(
        name="reserve_stock",
        description="Reserve stock units temporarily for a quotation or order.",
        input_schema={
            "properties": {
                "sku": {"type": "string", "description": "SKU code"},
                "quantity": {"type": "integer", "description": "Quantity to reserve"},
                "order_id": {"type": "string", "description": "Reference quotation or order ID"},
            },
            "required": ["sku", "quantity", "order_id"],
        },
        handler=reserve_stock,
        risk_level="MEDIUM",
        rate_limit_per_minute=20,
    )

    return server


def build_crm_mcp_server() -> MCPServer:
    """Customer Relationship Management (CRM) MCP Server."""
    server = MCPServer(
        name="crm",
        description="Customer directory, account status, contact profiles, and timeline logging.",
        version="1.0.0",
    )

    async def get_customer(customer_id: str) -> Dict[str, Any]:
        crm_db = {
            "CUST-901": {
                "name": "PT Nusantara Tech Global",
                "tier": "ENTERPRISE",
                "email": "procurement@nusantaratech.id",
                "sales_rep": "Andi Pratama",
                "outstanding_deals": 2,
            },
            "CUST-902": {
                "name": "CV Bintang Mandiri Sejahtera",
                "tier": "GROWTH",
                "email": "finance@bintangmandiri.co.id",
                "sales_rep": "Siti Rahma",
                "outstanding_deals": 1,
            },
        }
        return crm_db.get(
            customer_id.upper(),
            {
                "customer_id": customer_id.upper(),
                "name": f"Corporate Account {customer_id}",
                "tier": "STANDARD",
                "email": "contact@client.id",
                "sales_rep": "General Desk",
                "outstanding_deals": 0,
            },
        )

    async def update_customer(customer_id: str, status: str, notes: Optional[str] = None) -> Dict[str, Any]:
        return {
            "customer_id": customer_id.upper(),
            "new_status": status,
            "notes": notes or "Updated via ACP Agent Workflow",
            "updated_by": "Agent Control Plane",
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "crm_sync": "SUCCESS",
        }

    server.register_tool(
        name="get_customer",
        description="Retrieve customer profile, commercial tier, and primary contact details.",
        input_schema={
            "properties": {
                "customer_id": {"type": "string", "description": "Customer ID, e.g. CUST-901"},
            },
            "required": ["customer_id"],
        },
        handler=get_customer,
        risk_level="LOW",
        rate_limit_per_minute=40,
    )

    server.register_tool(
        name="update_customer",
        description="Update CRM customer status and log interaction notes.",
        input_schema={
            "properties": {
                "customer_id": {"type": "string", "description": "Customer ID"},
                "status": {"type": "string", "description": "New lifecycle status (e.g. VIP_PROSPECT, NEGOTIATION)"},
                "notes": {"type": "string", "description": "Optional notes regarding update"},
            },
            "required": ["customer_id", "status"],
        },
        handler=update_customer,
        risk_level="MEDIUM",
        rate_limit_per_minute=20,
    )

    return server


def build_email_mcp_server() -> MCPServer:
    """Outbound Communications & Email MCP Server."""
    server = MCPServer(
        name="email",
        description="Commercial email composition, PDF attachment generation, and secure delivery.",
        version="1.0.0",
    )

    async def send_quotation(recipient: str, quotation_id: str, custom_message: Optional[str] = None) -> Dict[str, Any]:
        return {
            "message_id": f"MSG-SMTP-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
            "recipient": recipient,
            "quotation_id": quotation_id,
            "subject": f"Commercial Quotation {quotation_id} - PT Nusantara Tech",
            "status": "DISPATCHED_SMTP_TLS",
            "sent_at": datetime.now(timezone.utc).isoformat(),
        }

    server.register_tool(
        name="send_quotation",
        description="Dispatch final quotation and terms via email to the client.",
        input_schema={
            "properties": {
                "recipient": {"type": "string", "description": "Recipient email address"},
                "quotation_id": {"type": "string", "description": "Quotation reference ID"},
                "custom_message": {"type": "string", "description": "Optional cover letter message"},
            },
            "required": ["recipient", "quotation_id"],
        },
        handler=send_quotation,
        risk_level="HIGH",
        requires_approval=True,
        rate_limit_per_minute=5,
    )

    return server


def build_gcp_ops_mcp_server() -> MCPServer:
    """GCP Infrastructure & Telemetry MCP Server."""
    server = MCPServer(
        name="gcp",
        description="Cloud Run, Firestore, and Vertex AI latency & monitoring metrics.",
        version="1.0.0",
    )

    async def query_metrics(service_name: str = "agent-control-plane", timeframe: str = "1h") -> Dict[str, Any]:
        return {
            "service": service_name,
            "timeframe": timeframe,
            "vertex_ai_latency_p95_ms": 42.4,
            "firestore_latency_p95_ms": 16.8,
            "cloud_run_cpu_utilization": "12.4%",
            "active_connections": 1,
            "healthy_instances": 1,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    server.register_tool(
        name="query_metrics",
        description="Query GCP runtime health, p95 latency, and infrastructure status.",
        input_schema={
            "properties": {
                "service_name": {"type": "string", "description": "GCP Service name", "default": "agent-control-plane"},
                "timeframe": {"type": "string", "description": "Aggregation window (e.g. 1h, 24h)", "default": "1h"},
            },
        },
        handler=query_metrics,
        risk_level="LOW",
        rate_limit_per_minute=60,
    )

    return server


# Initialize Global MCP Registry
from .gateway import gateway as default_gateway
mcp_registry = MCPRegistry(gateway=default_gateway)
mcp_registry.register_server(build_inventory_mcp_server())
mcp_registry.register_server(build_crm_mcp_server())
mcp_registry.register_server(build_email_mcp_server())
mcp_registry.register_server(build_gcp_ops_mcp_server())
