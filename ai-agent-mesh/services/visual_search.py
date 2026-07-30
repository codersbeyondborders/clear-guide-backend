from fastapi import FastAPI, Request, HTTPException, Depends
from services.core import verify_agent_secret
from agents.visual_search_agent import identify_and_search_part

app = FastAPI(title="Visual Search Agent")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "visual-search"}

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
