import os
from fastapi import FastAPI, Request, HTTPException
from agents.community_repair_agent import generate_guidebot_reply

app = FastAPI(title="Agent Community Moderator Service")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "agent-community-moderator"}

@app.post("/community-reply")
async def community_reply(request: Request):
    """
    GuideBot AI RAG Forum Moderator Microservice Endpoint.
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
        print(f"Error in agent-community-moderator: {e}")
        raise HTTPException(status_code=500, detail=str(e))
