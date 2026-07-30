from fastapi import FastAPI, Request, HTTPException
import firebase_admin
from firebase_admin import firestore
from services.pubsub import decode_push_payload
from agents.dynamic_video_generator import generate_step_walkthrough_video

app = FastAPI(title="Video Generator Agent")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "video-generator"}

@app.post("/pubsub/video-generate")
async def pubsub_generate_video(request: Request):
    """
    Pub/Sub Push endpoint listening for VideoGenerationRequestedEvent.
    """
    try:
        body = await request.json()
        payload = decode_push_payload(body)
        
        event_type = payload.get("type")
        if event_type != "VideoGenerationRequestedEvent":
            print(f"Skipping non-relevant event: {event_type}")
            return {"status": "ignored"}
            
        manual_id = payload.get("manualId")
        procedure_title = payload.get("title")
        repair_steps = payload.get("steps")

        result = await generate_step_walkthrough_video(manual_id, procedure_title, repair_steps)
        
        if firebase_admin._apps and manual_id:
            firestore.client().collection('manuals').document(manual_id).set({
                'videoGenerationStatus': 'completed',
                'videoData': result
            }, merge=True)

        return {"status": "success", "data": result}
    except Exception as e:
        print(f"Error in /generate-video: {e}")
        if firebase_admin._apps and 'manual_id' in locals() and manual_id:
            try:
                firestore.client().collection('manuals').document(manual_id).set({
                    'status': 'error',
                    'videoGenerationStatus': 'error',
                    'message': str(e)
                }, merge=True)
            except Exception as fs_err:
                print(f"Firestore notice: {fs_err}")
        raise HTTPException(status_code=500, detail=str(e))
