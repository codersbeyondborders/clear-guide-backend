from fastapi import FastAPI, Request, HTTPException
import firebase_admin
from firebase_admin import firestore
from services.pubsub import decode_push_payload, publish_event
from agents.pdf_vision_parser import parse_and_vectorize_pdf

app = FastAPI(title="PDF Vision Parser Agent")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "pdf-parser"}

@app.post("/pubsub/process-manual")
async def pubsub_process_manual(request: Request):
    """
    Pub/Sub Push endpoint for processing manuals asynchronously.
    """
    try:
        body = await request.json()
        payload = decode_push_payload(body)
        
        manual_id = payload.get("manualId")
        storage_url = payload.get("storageUrl")

        if not manual_id or not storage_url:
            raise ValueError("Missing manualId or storageUrl")

        # Execute PDF-Vision-Parser Agent
        result = await parse_and_vectorize_pdf(manual_id, storage_url)
        
        # Publish event that manual is parsed successfully
        publish_event("clearguide-events", {
            "type": "ManualParsedEvent",
            "manualId": manual_id,
            "title": result.get("title", "Unknown Procedure"),
            "steps": result.get("steps", [])
        })
        
        return {"status": "success", "manualId": manual_id}

    except Exception as e:
        print(f"Error processing task: {e}")
        if firebase_admin._apps and 'manual_id' in locals() and manual_id:
            try:
                firestore.client().collection('manuals').document(manual_id).set({
                    'status': 'error',
                    'progressPercent': 0,
                    'message': str(e)
                }, merge=True)
            except Exception as fs_err:
                print(f"Firestore notice: {fs_err}")
        raise HTTPException(status_code=500, detail=str(e))
