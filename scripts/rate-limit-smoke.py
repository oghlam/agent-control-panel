"""Verify the local limiter contract without requiring Firestore credentials."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.gateway import SlidingWindowRateLimiter


async def main() -> None:
    limiter = SlidingWindowRateLimiter(use_firestore=False)
    first_allowed, first_info = await limiter.acquire("smoke.tool", "smoke", 1)
    second_allowed, second_info = await limiter.acquire("smoke.tool", "smoke", 1)
    assert first_allowed is True
    assert first_info["remaining"] == 0
    assert second_allowed is False
    assert second_info["remaining"] == 0
    print("RATE_LIMIT_CONTRACT_OK")


asyncio.run(main())
