from fastapi import FastAPI, Request, HTTPException, Depends
from services.core import verify_agent_secret
from agents.language_translation_agent import translate_content

app = FastAPI(title="Translator Agent")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "translator"}

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
