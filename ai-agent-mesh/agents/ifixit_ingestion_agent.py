import requests
import datetime
from google.cloud import firestore
import json
import os
import uuid

try:
    import psycopg2
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False

from agents.vertex_ai_helper import get_embedding_vector

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/clearguide")

_db = None
def get_db():
    global _db
    if _db is None:
        _db = firestore.Client()
    return _db

def get_db_connection():
    if PSYCOPG2_AVAILABLE:
        return psycopg2.connect(DATABASE_URL)
    return None

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

    # Generate real embeddings for pgvector
    conn = get_db_connection()
    if conn:
        try:
            cur = conn.cursor()
            for i, step in enumerate(transformed_steps):
                step_title = step.get("title") or f"Step {i+1}"
                step_lines_text = "\n".join(step.get("lines", []))
                chunk_content = f"{step_title}\n{step_lines_text}"
                
                # Create embedding
                embedding_vector = get_embedding_vector(chunk_content)
                vector_str = "[" + ",".join(map(str, embedding_vector)) + "]"
                
                chunk_id = f"{guide_id}_{i}"
                guide_title = guide_data.get("title", "")
                
                # Insert into PostgreSQL
                cur.execute("""
                    INSERT INTO ifixit_chunks (id, guide_id, title, canonical_url, content, embedding)
                    VALUES (%s, %s, %s, %s, %s, %s::vector)
                    ON CONFLICT (id) DO UPDATE SET 
                        content = EXCLUDED.content,
                        embedding = EXCLUDED.embedding
                """, (chunk_id, str(guide_id), guide_title, canonical_url, chunk_content, vector_str))
                
            conn.commit()
            cur.close()
            conn.close()
        except Exception as db_err:
            print(f"Failed to insert iFixit guide into pgvector: {db_err}")
            if conn:
                conn.rollback()

    # Keep a dummy embedding for the Firestore metadata cache document
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

    doc_ref = get_db().collection("ifixit_cache").document(str(guide_id))
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
    Performs a vector search on the PostgreSQL ifixit_chunks table.
    """
    conn = get_db_connection()
    if not conn:
        raise Exception("Database connection failed. PostgreSQL is required for vector search.")
        
    try:
        docs = []
        query_embedding = get_embedding_vector(query)
        vector_str = "[" + ",".join(map(str, query_embedding)) + "]"
        
        cur = conn.cursor()
        cur.execute("""
            SELECT guide_id, title, canonical_url, content
            FROM ifixit_chunks 
            ORDER BY embedding <=> %s::vector 
            LIMIT 3
        """, (vector_str,))
        rows = cur.fetchall()
        
        for row in rows:
            guide_id, title, url, content = row
            docs.append({
                "guide_id": guide_id,
                "canonical_url": url,
                "transformed_content": {
                    "title": title,
                    "summary": content
                }
            })
            
        cur.close()
        conn.close()
        return docs
    except Exception as db_err:
        if conn:
            conn.close()
        raise Exception(f"pgvector iFixit search failed: {db_err}")
