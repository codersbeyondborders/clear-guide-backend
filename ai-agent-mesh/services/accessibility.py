import os
from fastapi import FastAPI, Request, HTTPException
from agents.accessibility_agent import simplify_and_translate

app = FastAPI(title="Agent Accessibility Service")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "agent-accessibility"}

@app.post("/translate")
async def translate_text(request: Request):
    """
    WCAG Cognitive Simplification & Multi-Language Microservice Endpoint.
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
        print(f"Error in agent-accessibility: {e}")
        raise HTTPException(status_code=500, detail=str(e))
