from typing import TypedDict
from langgraph.graph import StateGraph, END
from agents.vertex_ai_helper import generate_ai_content

class FixBotState(TypedDict):
    message: str
    file_base64: str
    file_url: str
    mime_type: str
    device_context: str
    system_prompt: str
    user_prompt: str
    final_prompt: str
    response_text: str
    error: str

async def analyze_input(state: FixBotState) -> dict:
    """Analyze context and construct prompts."""
    system_prompt = (
        "You are FixBot, an expert repair technician and assistant grounded in iFixit's repair philosophy. "
        "Your goal is to help users diagnose and fix devices safely and effectively. "
        "Always prioritize safety (e.g., unplugging devices, discharging capacitors, handling batteries safely). "
        "Be encouraging, concise, and highly practical.\n\n"
    )

    device_context = state.get("device_context")
    if device_context:
        system_prompt += f"The user is asking about the following device context: {device_context}.\n"

    user_prompt = ""
    file_base64 = state.get("file_base64")
    file_url = state.get("file_url")
    mime_type = state.get("mime_type")
    
    if (file_base64 or file_url) and mime_type:
        if "pdf" in mime_type:
            user_prompt += "I have attached a PDF document. Please analyze this document to answer my question. "
        elif "image" in mime_type:
            user_prompt += "I have attached an image. Please analyze this image to identify the device, part, or damage. "

    message = state.get("message")
    if message:
        user_prompt += f"Here is my question/message: {message}\n"
    else:
        user_prompt += "Please tell me what you see in the attached file and how you can help me fix it."

    return {
        "system_prompt": system_prompt,
        "user_prompt": user_prompt,
        "final_prompt": system_prompt + user_prompt
    }

async def generate_response(state: FixBotState) -> dict:
    """Generate response using Vertex AI/Gemini."""
    try:
        response_text = generate_ai_content(
            prompt=state["final_prompt"],
            file_base64=state.get("file_base64"),
            file_url=state.get("file_url"),
            mime_type=state.get("mime_type"),
            model_name="gemini-1.5-pro"
        )
        return {"response_text": response_text or "I'm sorry, I couldn't generate a response."}
    except Exception as e:
        print(f"Error in FixBot generation: {e}")
        return {"error": str(e), "response_text": "I'm sorry, I encountered an error while trying to analyze your request."}

# Compile LangGraph Workflow
workflow = StateGraph(FixBotState)
workflow.add_node("analyze_input", analyze_input)
workflow.add_node("generate_response", generate_response)

workflow.set_entry_point("analyze_input")
workflow.add_edge("analyze_input", "generate_response")
workflow.add_edge("generate_response", END)

fixbot_graph = workflow.compile()

async def process_fixbot_chat(message: str, file_base64: str = None, file_url: str = None, mime_type: str = None, device_context: str = None) -> str:
    """
    Multimodal LangGraph endpoint for FixBot chat.
    """
    initial_state = {
        "message": message,
        "file_base64": file_base64,
        "file_url": file_url,
        "mime_type": mime_type,
        "device_context": device_context,
        "system_prompt": "",
        "user_prompt": "",
        "final_prompt": "",
        "response_text": "",
        "error": ""
    }
    
    result = await fixbot_graph.ainvoke(initial_state)
    return result.get("response_text", "Error processing request.")
