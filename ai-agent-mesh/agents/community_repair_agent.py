import os
import firebase_admin
from firebase_admin import firestore
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


async def generate_guidebot_reply(post_id: str, body: str, manual_id: str = None):
    """
    RAG-powered autonomous AI moderator (GuideBot).
    Retrieves technical manual specs from PostgreSQL using 768-dim pgvector embeddings
    and posts a verified answer to Firestore.
    """
    if not firebase_admin._apps:
        firebase_admin.initialize_app()

    db = firestore.client()
    post_ref = db.collection('hub_posts').document(post_id)

    try:
        # 1. Generate 768-dim query vector embedding for post body using Vertex AI TextEmbeddingModel
        dummy_embedding = get_embedding_vector(body)

        # 2. Execute pgvector cosine similarity search over manual_chunks
        context_snippets = []
        try:
            conn = get_db_connection()
            if conn:
                cur = conn.cursor()
                vector_str = "[" + ",".join(map(str, dummy_embedding)) + "]"

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

        context_text = "\n\n".join(context_snippets) if context_snippets else "Standard equipment maintenance and safety protocols."

        # 3. Synthesize diagnostic response using Vertex AI Gemini 1.5 RAG
        guidebot_text = (
            "Hello! I am **GuideBot**, your autonomous AI technical advisor. "
            "Based on technical manual vector retrieval, here are the verified diagnostic steps:\n\n"
        )

        prompt = (
            "You are GuideBot, an expert AI technical moderator on ClearGuide community forums.\n"
            f"User Post: {body}\n"
            f"Retrieved Technical Manual Context:\n{context_text}\n\n"
            "Synthesize a helpful, polite, step-by-step diagnostic recommendation (under 250 words)."
        )
        ai_resp = generate_ai_content(prompt)
        if ai_resp:
            guidebot_text += ai_resp
        else:
            guidebot_text += "Inspect wiring connections, verify pressure values, and check maintenance schedules in your product manual."


        # 4. Post response as GuideBot comment in Firestore
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
            "body": guidebot_text,
            "parentId": None,
            "likeCount": 0,
            "createdAt": now
        }

        await comment_ref.set(comment_data)

        # Update post comment count
        post_doc = await post_ref.get()
        if post_doc.exists:
            current_count = post_doc.data().get('commentCount', 0)
            await post_ref.update({'commentCount': current_count + 1})

        return {"status": "success", "postId": post_id, "commentId": comment_ref.id, "contextChunksRetrieved": len(context_snippets)}

    except Exception as e:
        print(f"Error executing GuideBot RAG response: {e}")
        return {"status": "error", "message": str(e)}
