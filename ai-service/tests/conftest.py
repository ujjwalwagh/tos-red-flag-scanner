import os
import sys

# Ensure ai-service root is on python path
ai_service_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ai_service_root not in sys.path:
    sys.path.insert(0, ai_service_root)

# Default to auth disabled for general unit tests (test_auth.py patches explicitly)
os.environ.setdefault("ENABLE_INTERNAL_AUTH", "false")
