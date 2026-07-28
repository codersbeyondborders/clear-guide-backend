import os
from fastapi import FastAPI, Request, HTTPException
from agents.language_translation_agent import translate_content

app = FastAPI(title="Agent Real-Time Language Translator Service")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "agent-translator"}

@app.post("/language-translate")
async def language_translate(request: Request):
    """
    Real-Time Language Translation Microservice Endpoint.
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
        print(f"Error in agent-translator: {e}")
        raise HTTPException(status_code=500, detail=str(e))
