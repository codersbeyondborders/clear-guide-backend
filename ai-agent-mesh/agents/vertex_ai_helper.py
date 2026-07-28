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
    image_base64: str = None,
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
            if image_base64:
                img_bytes = base64.b64decode(image_base64)
                contents.append(Part.from_data(img_bytes, mime_type="image/jpeg"))
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
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
            )
            if response and response.text:
                return response.text.strip()
        except Exception as err:
            print(f"[google.genai] generate_content notice: {err}")


    return ""


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

    # -- Offline deterministic fallback (development only) --
    return [0.01 * (i % 10) for i in range(768)]
