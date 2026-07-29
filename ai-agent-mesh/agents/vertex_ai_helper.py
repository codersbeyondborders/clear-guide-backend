"""
ClearGuide AI Helper — Google Cloud Agent Platform
Primary:  Vertex AI GenerativeModel + TextEmbeddingModel   (google-cloud-aiplatform)
Fallback: New Google Gen AI SDK  (google-genai >= 0.3.0)
"""
import os
import base64

# ---------------------------------------------------------------------------
# 1. Vertex AI Agent Platform (primary)
# ---------------------------------------------------------------------------
VERTEX_AVAILABLE = False
try:
    import vertexai
    from vertexai.generative_models import GenerativeModel, Part
    from vertexai.language_models import TextEmbeddingModel
    VERTEX_AVAILABLE = True
except ImportError:
    pass

PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "clear-guide")
LOCATION = os.getenv("GCP_REGION", "us-central1")
_VERTEX_INIT_DONE = False


def _init_vertex():
    global _VERTEX_INIT_DONE
    if VERTEX_AVAILABLE and not _VERTEX_INIT_DONE:
        try:
            vertexai.init(project=PROJECT_ID, location=LOCATION)
            _VERTEX_INIT_DONE = True
        except Exception as err:
            print(f"[VertexAI] Init notice: {err}")


# ---------------------------------------------------------------------------
# 2. Google Gen AI SDK fallback (google-genai >= 0.3.0)
# ---------------------------------------------------------------------------
GENAI_AVAILABLE = False
_genai_client = None

try:
    from google import genai as google_genai
    from google.genai import types as genai_types
    GENAI_AVAILABLE = True
except ImportError:
    pass


def _get_genai_client():
    global _genai_client
    if _genai_client is None and GENAI_AVAILABLE:
        api_key = os.getenv("GOOGLE_API_KEY")
        if api_key:
            try:
                _genai_client = google_genai.Client(api_key=api_key)
            except Exception as err:
                print(f"[google.genai] Client init notice: {err}")
    return _genai_client



# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_ai_content(
    prompt: str,
    file_base64: str = None,
    mime_type: str = "application/pdf",
    model_name: str = "gemini-1.5-flash"
) -> str:
    """
    Unified AI content generation using Google Cloud Agent Platform.
    Priority: Vertex AI Agent Engine → Google Gen AI SDK → empty string fallback.
    """
    _init_vertex()

    # -- Vertex AI (primary) --
    if VERTEX_AVAILABLE and _VERTEX_INIT_DONE:
        try:
            vertex_model = GenerativeModel(model_name)
            contents = []
            if file_base64:
                file_bytes = base64.b64decode(file_base64)
                contents.append(Part.from_data(file_bytes, mime_type=mime_type))
            contents.append(prompt)
            response = vertex_model.generate_content(contents)
            if response and response.text:
                return response.text.strip()
        except Exception as err:
            print(f"[VertexAI] generate_content notice: {err}")

    # -- Google Gen AI SDK fallback --
    client = _get_genai_client()
    if client:
        try:
            contents = []
            if file_base64:
                file_bytes = base64.b64decode(file_base64)
                contents.append(genai_types.Part.from_bytes(data=file_bytes, mime_type=mime_type))
            contents.append(prompt)

            response = client.models.generate_content(
                model=model_name,
                contents=contents,
            )
            if response and response.text:
                return response.text.strip()
        except Exception as err:
            print(f"[google.genai] generate_content notice: {err}")

    raise RuntimeError("AI content generation failed across all available SDKs. Check your credentials and quotas.")


def get_embedding_vector(text: str, model_name: str = "text-embedding-004") -> list:
    """
    Unified 768-dimensional text embedding.
    Priority: Vertex AI TextEmbeddingModel → Google Gen AI SDK → deterministic zero fallback.
    """
    _init_vertex()

    # -- Vertex AI (primary) --
    if VERTEX_AVAILABLE and _VERTEX_INIT_DONE:
        try:
            embed_model = TextEmbeddingModel.from_pretrained(model_name)
            embeddings = embed_model.get_embeddings([text])
            if embeddings:
                return embeddings[0].values
        except Exception as err:
            print(f"[VertexAI] get_embeddings notice: {err}")

    # -- Google Gen AI SDK fallback --
    client = _get_genai_client()
    if client:
        try:
            result = client.models.embed_content(
                model=model_name,
                contents=text,
            )
            if result and result.embeddings:
                return result.embeddings[0].values
        except Exception as err:
            print(f"[google.genai] embed_content notice: {err}")

    raise RuntimeError("AI embedding generation failed across all available SDKs. Check your credentials and quotas.")


# ---------------------------------------------------------------------------
# SVG Generation Utilities
# ---------------------------------------------------------------------------

SVG_PROMPT_RULES = (
    "CRITICAL SVG GENERATION RULES:\n"
    "1. You MUST include xmlns=\"http://www.w3.org/2000/svg\" and viewBox=\"0 0 800 500\".\n"
    "2. Use a sleek dark theme: Set the background to fill=\"#090d16\", use cyan/blue (e.g., #38bdf8, #0369a1) for primary shapes/lines, and white (#ffffff) for text.\n"
    "3. Use ONLY basic, universally compatible SVG shapes: <rect>, <circle>, <path>, <line>, <text>, <g>. Do NOT use complex filters or unsupported CSS.\n"
    "4. If returning JSON, ensure all SVG attribute quotes are properly escaped (e.g., using single quotes like fill='red' or escaped double quotes).\n"
    "5. Output ONLY the valid raw <svg>...</svg> element, no markdown fencing."
)

def sanitize_svg_markup(raw_str: str) -> str:
    """
    Cleans up LLM-generated SVG markup by stripping markdown fencing
    and ensuring the root <svg> tags exist.
    """
    if not raw_str:
        return ""

    clean_str = raw_str.strip()
    if clean_str.startswith("```svg"):
        clean_str = clean_str[6:]
    elif clean_str.startswith("```xml"):
        clean_str = clean_str[6:]
    elif clean_str.startswith("```html"):
        clean_str = clean_str[7:]
    elif clean_str.startswith("```"):
        clean_str = clean_str[3:]
    
    if clean_str.endswith("```"):
        clean_str = clean_str[:-3]
        
    clean_str = clean_str.strip()
    
    # Clean up potentially escaped characters from JSON hallucination
    clean_str = clean_str.replace('\\"', '"').replace("\\'", "'").replace("\\n", "\n").replace("\\t", "\t")
    
    if not clean_str.startswith("<svg"):
        clean_str = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" class="w-full h-auto border rounded-xl bg-slate-950 p-4">{clean_str}'
        
    if not clean_str.endswith("</svg>"):
        clean_str += "</svg>"
        
    return clean_str
