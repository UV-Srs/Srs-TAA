import uvicorn
import os
import sys

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    print(f"Starting TAA Inspection Management System v2.0 on http://localhost:{port}")
    print("Press Ctrl+C to terminate.")
    uvicorn.run("backend.app.main:app", host=host, port=port, reload=False)
