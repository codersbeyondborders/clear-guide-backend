import os
import base64
import json
from fastapi import FastAPI, Request, HTTPException
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

# Initialize Firebase
if not firebase_admin._apps:
    firebase_admin.initialize_app()

db = firestore.client() if firebase_admin._apps else None
storage_client = storage.Client() if os.getenv("GOOGLE_CLOUD_PROJECT") else None

app = FastAPI(title="ClearGuide AI Agent Mesh")

class ProcessManualRequest(BaseModel):
    manualId: str
    storageUrl: str

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "ai-agent-mesh"}

@app.post("/process-manual")
async def process_manual(request: Request):
    """
    Webhook endpoint for Google Cloud Tasks / Gateway trigger.
    """
    # Verify authorization header or Cloud Tasks header in production
    is_dev = os.getenv("ENVIRONMENT") == "development" or os.getenv("NODE_ENV") != "production"
    if not request.headers.get("X-CloudTasks-TaskName") and not is_dev:
        raise HTTPException(status_code=403, detail="Unauthorized task request")

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


@app.post("/community-reply")
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

@app.post("/visual-search")
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

@app.post("/generate-video")
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

@app.post("/translate")
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

@app.post("/language-translate")
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






