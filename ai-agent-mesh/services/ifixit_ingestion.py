from fastapi import FastAPI, Request, HTTPException, Depends
from services.core import verify_agent_secret
from agents.ifixit_ingestion_agent import ingest_ifixit_guide

app = FastAPI(title="iFixit Ingestion Agent")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "ifixit-ingestion"}

@app.post("/ifixit/ingest", dependencies=[Depends(verify_agent_secret)])
async def ifixit_ingest(request: Request):
    """
    Ingests, transforms, and stores an iFixit guide as vector nodes in Firestore with a 30-day TTL.
    """
    try:
        body = await request.json()
        guide_id = body.get("guideId")
        if not guide_id:
            raise ValueError("Missing guideId")
        result = await ingest_ifixit_guide(guide_id)
        return {"status": "success", "data": result}
    except Exception as e:
        print(f"Error in /ifixit/ingest: {e}")
        raise HTTPException(status_code=500, detail=str(e))
