import urllib.request
import json
import sys

CLOUD_RUN_URL = "https://acp-backend-627792456859.us-central1.run.app"

def smoke_test_endpoint(path):
    url = f"{CLOUD_RUN_URL}{path}"
    print(f"Testing: {url}...")
    try:
        response = urllib.request.urlopen(url, timeout=10)
        status = response.getcode()
        data = json.loads(response.read().decode('utf-8'))
        print(f"  -> SUCCESS: Status {status}")
        print(f"  -> Response: {data}\n")
        return data
    except Exception as exc:
        print(f"  -> FAILED: {exc}\n")
        return None

if __name__ == "__main__":
    print("--- STEP 3: CLOUD RUN SMOKE TEST ---")
    health_data = smoke_test_endpoint("/health")
    config_data = smoke_test_endpoint("/config")
    
    if not health_data or not config_data:
        print("Smoke test failed!")
        sys.exit(1)
        
    print("Smoke test passed successfully!")