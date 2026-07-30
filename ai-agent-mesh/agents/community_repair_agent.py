import os
import firebase_admin
from firebase_admin import firestore
from agents.vertex_ai_helper import generate_ai_content, get_embedding_vector
from agents.ifixit_ingestion_agent import search_ifixit_cache
from typing import TypedDict, List
from langgraph.graph import StateGraph, END

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

class AgentState(TypedDict):
    post_id: str
    body: str
    manual_id: str
    context_snippets: List[str]
    ifixit_citations: List[str]
    draft_reply: str
    final_reply: str
    error: str

async def analyze_intent(state: AgentState) -> dict:
    """Analyze the user's post to understand the intent."""
    return state

async def search_vector_db(state: AgentState) -> dict:
    """Search postgres and firestore for context."""
    context_snippets = []
    ifixit_citations = []
    body = state.get("body", "")
    manual_id = state.get("manual_id")

    try:
        query_embedding = get_embedding_vector(body)
        conn = get_db_connection()
        if conn:
            cur = conn.cursor()
            vector_str = "[" + ",".join(map(str, query_embedding)) + "]"
            if manual_id:
                cur.execute("""
                    SELECT content FROM manual_chunks 
                    WHERE manual_id = %s 
                    ORDER BY embedding <=> %s::vector 
                    LIMIT 3
                """, (manual_id, vector_str))
            else:
                cur.execute("""
                    SELECT content FROM manual_chunks 
                    ORDER BY embedding <=> %s::vector 
                    LIMIT 3
                """, (vector_str,))
            rows = cur.fetchall()
            for r in rows:
                context_snippets.append(r[0])
            cur.close()
            conn.close()
    except Exception as db_err:
        print(f"Database pgvector query notice in GuideBot: {db_err}")

    try:
        ifixit_docs = await search_ifixit_cache(body)
        for doc in ifixit_docs:
            transformed = doc.get("transformed_content", {})
            title = transformed.get("title", "")
            url = doc.get("canonical_url", "")
            if title:
                context_snippets.append(f"iFixit Guide ({title}): {transformed.get('summary', '')}")
                ifixit_citations.append(f"Powered by iFixit: [{title}]({url})")
    except Exception as ifixit_err:
        print(f"Firestore iFixit cache query notice in GuideBot: {ifixit_err}")

    return {"context_snippets": context_snippets, "ifixit_citations": ifixit_citations}

async def draft_reply(state: AgentState) -> dict:
    """Draft a response based on context."""
    body = state.get("body", "")
    context_snippets = state.get("context_snippets", [])
    context_text = "\n\n".join(context_snippets) if context_snippets else "Standard equipment maintenance and safety protocols."

    prompt = (
        "You are GuideBot, an expert AI technical moderator on ClearGuide community forums.\n"
        f"User Post: {body}\n"
        f"Retrieved Technical Manual Context:\n{context_text}\n\n"
        "Synthesize a helpful, polite, step-by-step diagnostic recommendation (under 250 words)."
    )
    ai_resp = generate_ai_content(prompt, model_name="gemini-1.5-pro")
    
    return {"draft_reply": ai_resp or "I apologize, but I am currently unable to process your request."}

async def safety_reflection(state: AgentState) -> dict:
    """Reflect on safety protocols and finalize."""
    draft = state.get("draft_reply", "")
    ifixit_citations = state.get("ifixit_citations", [])
    
    guidebot_text = (
        "Hello! I am **GuideBot**, your autonomous AI technical advisor. "
        "Based on technical manual vector retrieval, here are the verified diagnostic steps:\n\n"
    )
    
    final_reply = guidebot_text + draft
    if ifixit_citations:
        final_reply += "\n\n" + "\n".join(ifixit_citations)
        
    return {"final_reply": final_reply}

async def finalize_post(state: AgentState) -> dict:
    """Write the comment to Firestore."""
    post_id = state.get("post_id")
    final_reply = state.get("final_reply")
    
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    db = firestore.client()
    post_ref = db.collection('hub_posts').document(post_id)
    
    now = firestore.SERVER_TIMESTAMP
    guidebot_author = {
        "name": "GuideBot AI",
        "username": "guidebot",
        "avatarUrl": "https://clear-guide.app/icons/guidebot-avatar.png",
        "isBot": True,
        "specialty": "Technical Moderator"
    }

    comment_ref = post_ref.collection('comments').doc()
    comment_data = {
        "id": comment_ref.id,
        "postId": post_id,
        "userId": "guidebot_agent_id",
        "author": guidebot_author,
        "body": final_reply,
        "parentId": None,
        "likeCount": 0,
        "createdAt": now
    }

    await comment_ref.set(comment_data)

    # Update post comment count
    post_doc = post_ref.get() # Corrected get() block - await is not needed in python firestore SDK unless using AsyncClient
    if post_doc.exists:
        current_count = post_doc.to_dict().get('commentCount', 0)
        post_ref.update({'commentCount': current_count + 1})
        
    return state

# Compile LangGraph Workflow
workflow = StateGraph(AgentState)
workflow.add_node("analyze_intent", analyze_intent)
workflow.add_node("search_vector_db", search_vector_db)
workflow.add_node("draft_reply_node", draft_reply)
workflow.add_node("safety_reflection", safety_reflection)
workflow.add_node("finalize_post", finalize_post)

workflow.set_entry_point("analyze_intent")
workflow.add_edge("analyze_intent", "search_vector_db")
workflow.add_edge("search_vector_db", "draft_reply_node")
workflow.add_edge("draft_reply_node", "safety_reflection")
workflow.add_edge("safety_reflection", "finalize_post")
workflow.add_edge("finalize_post", END)

guidebot_graph = workflow.compile()

async def generate_guidebot_reply(post_id: str, body: str, manual_id: str = None):
    """
    LangGraph-powered autonomous AI moderator (GuideBot).
    """
    try:
        initial_state = {
            "post_id": post_id,
            "body": body,
            "manual_id": manual_id,
            "context_snippets": [],
            "ifixit_citations": [],
            "draft_reply": "",
            "final_reply": "",
            "error": ""
        }
        
        # Run LangGraph StateMachine
        result = await guidebot_graph.ainvoke(initial_state)
        
        return {"status": "success", "postId": post_id, "contextChunksRetrieved": len(result.get("context_snippets", []))}

    except Exception as e:
        print(f"Error executing GuideBot LangGraph response: {e}")
        return {"status": "error", "message": str(e)}
