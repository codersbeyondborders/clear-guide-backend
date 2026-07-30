from fastapi import FastAPI, Request, HTTPException, Depends
from services.core import verify_agent_secret
from agents.accessibility_agent import simplify_and_translate

app = FastAPI(title="Accessibility Agent")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "accessibility"}

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
