import os
from fastapi import FastAPI, Request, HTTPException
from agents.dynamic_video_generator import generate_step_walkthrough_video

app = FastAPI(title="Agent Video Generator Service")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "agent-video-generator"}

@app.post("/generate-video")
async def generate_video(request: Request):
    """
    Dynamic Video & Audio Walkthrough Microservice Endpoint.
    """
    try:
        body = await request.json()
        manual_id = body.get("manualId", "manual_default")
        procedure_title = body.get("procedureTitle")
        repair_steps = body.get("repairSteps")

        result = await generate_step_walkthrough_video(manual_id, procedure_title, repair_steps)
        return {"status": "success", "data": result}
    except Exception as e:
        print(f"Error in agent-video-generator: {e}")
        raise HTTPException(status_code=500, detail=str(e))
