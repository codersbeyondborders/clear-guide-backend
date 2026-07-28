import os
from fastapi import FastAPI, Request, HTTPException
import firebase_admin
from firebase_admin import firestore
from agents.pdf_vision_parser import parse_and_vectorize_pdf

if not firebase_admin._apps:
    firebase_admin.initialize_app()

db = firestore.client() if firebase_admin._apps else None
app = FastAPI(title="Agent PDF Parser Service")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "agent-pdf-parser"}

@app.post("/process-manual")
async def process_manual(request: Request):
    """
    Multimodal PDF Vision Parser Microservice Endpoint.
    """
    is_dev = os.getenv("ENVIRONMENT") == "development" or os.getenv("NODE_ENV") != "production"
    if not request.headers.get("X-CloudTasks-TaskName") and not is_dev:
        raise HTTPException(status_code=403, detail="Unauthorized task request")

    try:
        body = await request.json()
        manual_id = body.get("manualId")
        storage_url = body.get("storageUrl")

        if not manual_id or not storage_url:
            raise ValueError("Missing manualId or storageUrl")

        result = await parse_and_vectorize_pdf(manual_id, storage_url)
        return {"status": "success", "manualId": manual_id, "details": result}
    except Exception as e:
        print(f"Error in agent-pdf-parser: {e}")
        raise HTTPException(status_code=500, detail=str(e))
