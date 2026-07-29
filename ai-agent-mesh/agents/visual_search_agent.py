import os
import base64
import json
from agents.vertex_ai_helper import generate_ai_content, get_embedding_vector



try:
    import psycopg2
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False



DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/clearguide")

def get_db_connection():
    if PSYCOPG2_AVAILABLE:
        return psycopg2.connect(DATABASE_URL)
    return None


async def identify_and_search_part(image_base64: str, category: str = None):
    """
    Analyzes camera image with Gemini 1.5 Pro Vision, generates part embedding,
    and executes pgvector similarity search to find matching manual sections & fix steps.
    """
    clean_b64 = image_base64.split(",")[-1] if "," in image_base64 else image_base64

    prompt = (
        "You are an expert equipment maintenance technician and visual part identification agent.\n"
        "Analyze this camera photo. Identify the machinery type, specific part name, part condition, "
        "and fault diagnosis if damage or error codes are visible.\n"
        "Format your ENTIRE output as a single, valid JSON object with the following schema:\n"
        "{\n"
        '  "identified_part": "Name of the part",\n'
        '  "confidence_score": 0.95,\n'
        '  "visual_description": "Detailed visual description",\n'
        '  "fault_diagnosis": "Diagnosis of any visible issues",\n'
        '  "troubleshooting_steps": ["Step 1", "Step 2"]\n'
        "}\n"
        "Return ONLY the valid JSON object, without any markdown formatting."
    )
    
    ai_vision_json_str = generate_ai_content(
        prompt=prompt, 
        file_base64=clean_b64, 
        mime_type="image/jpeg", 
        model_name="gemini-1.5-pro"
    )

    # Defaults
    identified_part = "Unknown Part"
    confidence_score = 0.0
    visual_description = "Could not parse visual description."
    fault_diagnosis = "No diagnosis available."
    troubleshooting_steps = ["1. Please refer to standard manual."]

    try:
        clean_json_str = ai_vision_json_str.strip()
        if clean_json_str.startswith("```json"):
            clean_json_str = clean_json_str[7:]
        if clean_json_str.startswith("```"):
            clean_json_str = clean_json_str[3:]
        if clean_json_str.endswith("```"):
            clean_json_str = clean_json_str[:-3]
            
        parsed_data = json.loads(clean_json_str.strip())
        identified_part = parsed_data.get("identified_part", identified_part)
        confidence_score = float(parsed_data.get("confidence_score", confidence_score))
        visual_description = parsed_data.get("visual_description", visual_description)
        fault_diagnosis = parsed_data.get("fault_diagnosis", fault_diagnosis)
        troubleshooting_steps = parsed_data.get("troubleshooting_steps", troubleshooting_steps)
    except Exception as parse_err:
        print(f"Error parsing JSON from Gemini Visual Search: {parse_err}")

    # 2. Compute 768-dim text embedding for identified part feature text using Vertex AI
    query_text = f"{identified_part} {visual_description}"
    dummy_embedding = get_embedding_vector(query_text)


    # 3. Query PostgreSQL pgvector database for similarity match
    matching_chunks = []
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        vector_str = "[" + ",".join(map(str, dummy_embedding)) + "]"
        cur.execute("""
            SELECT id, manual_id, content, (embedding <=> %s::vector) AS distance
            FROM manual_chunks
            ORDER BY distance ASC
            LIMIT 3
        """, (vector_str,))
        rows = cur.fetchall()
        for r in rows:
            matching_chunks.append({
                "chunkId": r[0],
                "manualId": r[1],
                "content": r[2],
                "distance": float(r[3])
            })
        cur.close()
        conn.close()
    except Exception as db_err:
        print(f"Database query notice in Visual Search: {db_err}")

    matched_manual_id = matching_chunks[0]["manualId"] if matching_chunks else "manual_default"
    relevant_section = matching_chunks[0]["content"] if matching_chunks else "Section 4: Fuel System Maintenance & Part Replacement"

    return {
        "identifiedPart": identified_part,
        "confidenceScore": confidence_score,
        "visualDescription": visual_description,
        "faultDiagnosis": fault_diagnosis,
        "matchedManualId": matched_manual_id,
        "relevantSection": relevant_section,
        "matchingChunks": matching_chunks,
        "troubleshootingSteps": troubleshooting_steps
    }
