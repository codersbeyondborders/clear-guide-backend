import os
from fastapi import FastAPI, Request, HTTPException
from agents.visual_search_agent import identify_and_search_part

app = FastAPI(title="Agent Visual Search Service")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "agent-visual-search"}

@app.post("/visual-search")
async def visual_search(request: Request):
    """
    Visual Search & Camera Part Identification Microservice Endpoint.
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
        print(f"Error in agent-visual-search: {e}")
        raise HTTPException(status_code=500, detail=str(e))
