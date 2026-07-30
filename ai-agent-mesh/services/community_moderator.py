from fastapi import FastAPI, Request, HTTPException, Depends
from services.core import verify_agent_secret
from agents.community_repair_agent import generate_guidebot_reply

app = FastAPI(title="Community Moderator Agent")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "community-moderator"}

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
