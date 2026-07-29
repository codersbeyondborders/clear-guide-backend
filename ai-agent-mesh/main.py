import os
import base64
import json
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud import storage

from agents.pdf_vision_parser import parse_and_vectorize_pdf
from agents.community_repair_agent import generate_guidebot_reply
from agents.visual_search_agent import identify_and_search_part
from agents.dynamic_video_generator import generate_step_walkthrough_video
from agents.accessibility_agent import simplify_and_translate
from agents.language_translation_agent import translate_content
from agents.ifixit_ingestion_agent import ingest_ifixit_guide, search_ifixit_cache

# Initialize Firebase
if not firebase_admin._apps:
    firebase_admin.initialize_app()

db = firestore.client() if firebase_admin._apps else None
storage_client = storage.Client() if os.getenv("GOOGLE_CLOUD_PROJECT") else None

app = FastAPI(title="ClearGuide AI Agent Mesh")

class ProcessManualRequest(BaseModel):
    manualId: str
    storageUrl: str

security = HTTPBearer(auto_error=False)

async def verify_agent_secret(credentials: HTTPAuthorizationCredentials = Depends(security), request: Request = None):
    """
    Middleware to verify that the request comes from an authorized caller 
    (like the API Gateway or Cloud Tasks) by checking the shared AGENT_MESH_SECRET.
    """
    secret = os.getenv("AGENT_MESH_SECRET")
    is_dev = os.getenv("ENVIRONMENT") == "development" or os.getenv("NODE_ENV") != "production"
    
    if secret:
        if not credentials or credentials.scheme.lower() != "bearer" or credentials.credentials != secret:
            raise HTTPException(status_code=403, detail="Unauthorized task request: Invalid or missing Agent Mesh Secret")
    elif not is_dev:
        # Require secret in production
        raise HTTPException(status_code=500, detail="AGENT_MESH_SECRET is not configured in production")
        
    return True

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "ai-agent-mesh"}

@app.post("/process-manual", dependencies=[Depends(verify_agent_secret)])
async def process_manual(request: Request):
    """
    Webhook endpoint for Google Cloud Tasks / Gateway trigger.
    """

    try:
        body = await request.json()
        manual_id = body.get("manualId")
        storage_url = body.get("storageUrl")

        if not manual_id or not storage_url:
            raise ValueError("Missing manualId or storageUrl")

        # Execute PDF-Vision-Parser Agent
        result = await parse_and_vectorize_pdf(manual_id, storage_url)
        return {"status": "success", "manualId": manual_id, "details": result}

    except Exception as e:
        print(f"Error processing task: {e}")
        if db and 'manual_id' in locals():
            try:
                db.collection('manuals').document(manual_id).set({
                    'status': 'error',
                    'progressPercent': 0,
                    'message': str(e)
                }, merge=True)
            except Exception as fs_err:
                print(f"Firestore notice: {fs_err}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/community-reply", dependencies=[Depends(verify_agent_secret)])
async def community_reply(request: Request):
    """
    Triggers GuideBot AI Moderator response to community forum posts.
    """
    try:
        body = await request.json()
        post_id = body.get("postId")
        post_body = body.get("body", "")
        manual_id = body.get("manualId")

        if not post_id:
            raise ValueError("Missing postId")

        result = await generate_guidebot_reply(post_id, post_body, manual_id)
        return {"status": "success", "result": result}
    except Exception as e:
        print(f"Error in /community-reply: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/visual-search", dependencies=[Depends(verify_agent_secret)])
async def visual_search(request: Request):
    """
    Camera photo visual search and part identification endpoint.
    """
    try:
        body = await request.json()
        image_base64 = body.get("image", "")
        category = body.get("category")

        if not image_base64:
            raise ValueError("Missing camera image payload")

        result = await identify_and_search_part(image_base64, category)
        return {"status": "success", "data": result}
    except Exception as e:
        print(f"Error in /visual-search: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/generate-video", dependencies=[Depends(verify_agent_secret)])
async def generate_video(request: Request):
    """
    Automated step-by-step SVG frame walkthrough & voiceover video generator.
    """
    try:
        body = await request.json()
        manual_id = body.get("manualId", "manual_default")
        procedure_title = body.get("procedureTitle")
        repair_steps = body.get("repairSteps")

        result = await generate_step_walkthrough_video(manual_id, procedure_title, repair_steps)
        return {"status": "success", "data": result}
    except Exception as e:
        print(f"Error in /generate-video: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/translate", dependencies=[Depends(verify_agent_secret)])
async def translate_text(request: Request):
    """
    Technical jargon simplification (WCAG 8th-grade level) and multi-language translation.
    """
    try:
        body = await request.json()
        text = body.get("text", "")
        target_language = body.get("targetLanguage", "es")
        reading_level = body.get("readingLevel", "8th_grade")

        if not text:
            raise ValueError("Missing text payload for translation")

        result = await simplify_and_translate(text, target_language, reading_level)
        return {"status": "success", "data": result}
    except Exception as e:
        print(f"Error in /translate: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/language-translate", dependencies=[Depends(verify_agent_secret)])
async def language_translate(request: Request):
    """
    Dedicated Language-Translation-Agent for real-time frontend UI and content translation.
    """
    try:
        body = await request.json()
        text = body.get("text", "")
        target_language = body.get("targetLanguage", "es")
        source_language = body.get("sourceLanguage")

        if not text:
            raise ValueError("Missing text payload")

        result = await translate_content(text, target_language, source_language)
        return {"status": "success", "data": result}
    except Exception as e:
        print(f"Error in /language-translate: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ifixit/ingest", dependencies=[Depends(verify_agent_secret)])
async def ifixit_ingest(request: Request):
    """
    Ingests, transforms, and stores an iFixit guide as vector nodes in Firestore with a 30-day TTL.
    """
    try:
        body = await request.json()
        guide_id = body.get("guideId")
        if not guide_id:
            raise ValueError("Missing guideId")
        result = await ingest_ifixit_guide(guide_id)
        return {"status": "success", "data": result}
    except Exception as e:
        print(f"Error in /ifixit/ingest: {e}")
        raise HTTPException(status_code=500, detail=str(e))
