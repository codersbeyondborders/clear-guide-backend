from fastapi import FastAPI, Request, HTTPException, Depends
from services.core import verify_agent_secret
from agents.fixbot_agent import process_fixbot_chat

app = FastAPI(title="FixBot Agent")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "fixbot"}

@app.post("/fixbot/chat", dependencies=[Depends(verify_agent_secret)])
async def fixbot_chat(request: Request):
    """
    Multimodal endpoint for FixBot chat (Text, Image, PDF).
    """
    try:
        body = await request.json()
        message = body.get("message", "")
        file_base64 = body.get("file_base64")
        mime_type = body.get("mime_type")
        device_context = body.get("device_context")

        if not message and not file_base64:
            raise ValueError("Missing message or file payload")

        result = await process_fixbot_chat(message, file_base64, mime_type, device_context)
        return {"status": "success", "data": result}
    except Exception as e:
        print(f"Error in /fixbot/chat: {e}")
        raise HTTPException(status_code=500, detail=str(e))
