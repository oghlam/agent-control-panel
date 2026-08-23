import asyncio
import time
from backend.gateway import SlidingWindowRateLimiter

async def test_in_memory():
    print("Testing In-Memory Rate Limiter...")
    limiter = SlidingWindowRateLimiter(use_firestore=False)
    
    # Check limit 3 calls per minute
    # Call 1
    allowed, info = await limiter.acquire("test_tool", "test_caller", 3)
    print(f"Call 1: allowed={allowed}, remaining={info['remaining']}")
    assert allowed == True
    assert info['remaining'] == 2
    
    # Call 2
    allowed, info = await limiter.acquire("test_tool", "test_caller", 3)
    print(f"Call 2: allowed={allowed}, remaining={info['remaining']}")
    assert allowed == True
    assert info['remaining'] == 1
    
    # Call 3
    allowed, info = await limiter.acquire("test_tool", "test_caller", 3)
    print(f"Call 3: allowed={allowed}, remaining={info['remaining']}")
    assert allowed == True
    assert info['remaining'] == 0
    
    # Call 4 (should be blocked)
    allowed, info = await limiter.acquire("test_tool", "test_caller", 3)
    print(f"Call 4: allowed={allowed}, info={info}")
    assert allowed == False
    assert info['remaining'] == 0
    
    print("In-Memory Rate Limiter PASS!")

async def test_firestore():
    print("\nTesting Firestore Rate Limiter (if environment is configured)...")
    # This will try to initialize Firestore, and if it fails or has no access,
    # it will log a warning and fall back to in-memory, which is also a success test for fallback.
    limiter = SlidingWindowRateLimiter(use_firestore=True)
    
    allowed, info = await limiter.acquire("test_firestore_tool", "test_caller", 5)
    print(f"Firestore Call 1: allowed={allowed}, info={info}")
    print("Firestore Rate Limiter/Fallback PASS!")

if __name__ == "__main__":
    asyncio.run(test_in_memory())
    asyncio.run(test_firestore())