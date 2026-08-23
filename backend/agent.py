import logging
import asyncio
import os

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from .config import settings
from .gateway import gateway

log = logging.getLogger(__name__)


async def check_inventory(item: str) -> dict:
    """Checks warehouse inventory availability and stock levels."""
    return await gateway.execute("inventory.check_stock", {"item": item}, caller="gemini_agent", role="agent")


async def get_customer_details(customer_id: str) -> dict:
    """Fetches customer details and account status from CRM."""
    return await gateway.execute("crm.get_customer", {"customer_id": customer_id}, caller="gemini_agent", role="agent")


async def update_customer_crm(customer_id: str, note: str = "") -> dict:
    """Updates customer record and activity history in CRM."""
    return await gateway.execute("crm.update_customer", {"customer_id": customer_id, "fields": {"note": note}}, caller="gemini_agent", role="agent")


async def generate_quotation(amount: int = 24500000, description: str = "Enterprise License") -> dict:
    """Generates a commercial quotation with pricing details."""
    return await gateway.execute("quotation.generate", {"amount": amount, "items": [{"name": description, "qty": 1, "price": amount}]}, caller="gemini_agent", role="agent")


async def send_quotation_email(recipient: str, subject: str = "Quotation") -> dict:
    """Sends quotation email to external customer."""
    return await gateway.execute("email.send_quotation", {"recipient": recipient, "subject": subject}, caller="gemini_agent", role="agent")


async def query_system_metrics(metric: str = "cpu") -> dict:
    """Retrieves telemetry and latency metrics from Cloud Monitoring."""
    return await gateway.execute("gcp.query_metrics", {"metric": metric}, caller="gemini_agent", role="agent")


def get_agent() -> Agent:
    os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "1")
    os.environ.setdefault("GOOGLE_CLOUD_PROJECT", settings.project_id)
    os.environ.setdefault("GOOGLE_CLOUD_LOCATION", settings.region)
    return Agent(
        name="acp_taskmaster_agent",
        model=settings.model,
        description="Runs controlled multi-step Agent Control Plane tasks.",
        instruction="Complete the user's task accurately. Use available tools to fetch data or perform operations. Return a concise result.",
        tools=[
            check_inventory,
            get_customer_details,
            update_customer_crm,
            generate_quotation,
            send_quotation_email,
            query_system_metrics,
        ],
    )


def get_runner() -> tuple[Runner, InMemorySessionService]:
    sessions = InMemorySessionService()
    return (
        Runner(
            app_name="agent-control-plane",
            agent=get_agent(),
            session_service=sessions,
        ),
        sessions,
    )


async def run_adk_agent(task_id: str, prompt: str) -> str:
    runner, sessions = get_runner()
    session = await sessions.create_session(
        app_name="agent-control-plane",
        user_id="agent-control-plane",
        state={"task_id": task_id},
    )
    message = types.Content(role="user", parts=[types.Part(text=prompt)])
    output: list[str] = []
    async for event in runner.run_async(
        user_id="agent-control-plane",
        session_id=session.id,
        new_message=message,
    ):
        if event.is_final_response() and event.content:
            output.extend(part.text for part in event.content.parts if part.text)
    return "\n".join(output).strip()


def run_agent(task: dict[str, str]) -> dict[str, str]:
    task_id = task.get("task_id", "unknown")
    prompt = task.get("prompt", "")

    log.info("[Agent] Running ADK task: %s", task_id)
    log.info("[Agent] Model: %s", settings.model)

    try:
        result = asyncio.run(run_adk_agent(task_id, prompt))
        return {"task_id": task_id, "status": "COMPLETED", "result": result}
    except Exception as exc:
        log.error("[Agent] ERROR: %s: %s", type(exc).__name__, exc)
        return {"task_id": task_id, "status": "FAILED", "error": str(exc)}
