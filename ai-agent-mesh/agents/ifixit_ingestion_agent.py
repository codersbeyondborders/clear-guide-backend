import requests
import datetime
from google.cloud import firestore
import json

db = firestore.Client()

def get_ifixit_guide(guide_id: int):
    url = f"https://www.ifixit.com/api/2.0/guides/{guide_id}"
    response = requests.get(url)
    response.raise_for_status()
    return response.json()

async def ingest_ifixit_guide(guide_id: str):
    """
    Fetches a guide from iFixit, transforms it, extracts tools and safety warnings,
    and caches it in Firestore with a 30-day TTL, retaining attribution metadata.
    """
    try:
        guide_data = get_ifixit_guide(int(guide_id))
    except Exception as e:
        raise ValueError(f"Failed to fetch guide {guide_id} from iFixit: {e}")

    # Canonical URL for attribution (MANDATORY CC BY)
    canonical_url = guide_data.get("url", f"https://www.ifixit.com/Guide/info/{guide_id}")
    
    # Simple extraction of tools
    tools = []
    if "tools" in guide_data:
        tools = [tool.get("text", "") for tool in guide_data["tools"]]

    # Extract steps and summarize / simplify
    # (In a full implementation, we might call an LLM here to simplify the text or extract safety warnings)
    transformed_steps = []
    safety_warnings = []
    for step in guide_data.get("steps", []):
        step_lines = []
        for line in step.get("lines", []):
            text = line.get("text_rendered", "")
            step_lines.append(text)
            # Basic heuristic for safety warnings if LLM is not used inline
            if "caution" in text.lower() or "warning" in text.lower() or "danger" in text.lower():
                safety_warnings.append(text)
        
        transformed_steps.append({
            "step_id": step.get("stepid"),
            "title": step.get("title", ""),
            "lines": step_lines,
            "media": step.get("media", {})
        })

    # Generate a dummy embedding for now (in production, use Vertex AI or similar)
    # embedding = await generate_embedding(json.dumps(transformed_steps))
    dummy_embedding = [0.0] * 768

    expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=30)

    transformed_content = {
        "title": guide_data.get("title", ""),
        "summary": guide_data.get("summary", ""),
        "difficulty": guide_data.get("difficulty", ""),
        "category": guide_data.get("category", ""),
        "tools": tools,
        "safety_warnings": safety_warnings,
        "steps": transformed_steps
    }

    doc_ref = db.collection("ifixit_cache").document(str(guide_id))
    doc_ref.set({
        "guide_id": str(guide_id),
        "canonical_url": canonical_url,
        "expires_at": expires_at,
        "transformed_content": transformed_content,
        "embedding": dummy_embedding, # Store vector embedding
        "attribution": "Powered by iFixit"
    })

    return {
        "guide_id": str(guide_id),
        "canonical_url": canonical_url,
        "expires_at": expires_at.isoformat(),
        "status": "success"
    }

async def search_ifixit_cache(query: str):
    """
    Simulates a vector search on the ifixit_cache collection.
    """
    # In a real vector DB, we'd use the query embedding to find nearest neighbors.
    # Here we do a basic mock or text search just to illustrate the RAG fetch.
    cache_ref = db.collection("ifixit_cache").limit(3)
    results = cache_ref.stream()
    
    docs = []
    for doc in results:
        data = doc.to_dict()
        # Ensure it hasn't expired
        if data.get("expires_at") and data["expires_at"].astimezone(datetime.timezone.utc) > datetime.datetime.now(datetime.timezone.utc):
            docs.append(data)
            
    return docs
