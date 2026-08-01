import os
import json
import base64
import io
import uuid
from google.cloud import storage
from agents.vertex_ai_helper import generate_ai_content, SVG_PROMPT_RULES, sanitize_svg_markup



try:
    import psycopg2
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False

try:
    from gtts import gTTS
    GTTS_AVAILABLE = True
except ImportError:
    GTTS_AVAILABLE = False



DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/clearguide")

def get_db_connection():
    if PSYCOPG2_AVAILABLE:
        return psycopg2.connect(DATABASE_URL)
    return None


def synthesize_mp3_url(text: str, lang: str = "en") -> str:
    """
    Synthesizes physical MP3 audio binary bytes for narration text,
    uploads it to Google Cloud Storage, and returns the public URL.
    """
    audio_bytes = None
    if GTTS_AVAILABLE:
        try:
            tts = gTTS(text=text, lang=lang, slow=False)
            mp3_fp = io.BytesIO()
            tts.write_to_fp(mp3_fp)
            mp3_fp.seek(0)
            audio_bytes = mp3_fp.read()
        except Exception as err:
            print(f"Notice generating gTTS audio: {err}")

    if not audio_bytes:
        # Fallback placeholder bytes
        audio_bytes = f"AUDIO_SYNTHESIS_FOR: {text}".encode("utf-8")

    bucket_name = os.getenv("STORAGE_BUCKET")
    if bucket_name:
        try:
            client = storage.Client()
            bucket = client.bucket(bucket_name)
            blob_name = f"video_audio/{uuid.uuid4()}.mp3"
            blob = bucket.blob(blob_name)
            blob.upload_from_string(audio_bytes, content_type="audio/mp3")
            blob.make_public()
            return blob.public_url
        except Exception as upload_err:
            print(f"Failed to upload audio to GCS: {upload_err}")

    # Fallback to base64 if GCS fails or is not configured
    b64_str = base64.b64encode(audio_bytes).decode('utf-8')
    return f"data:audio/mp3;base64,{b64_str}"


async def generate_step_walkthrough_video(manual_id: str, procedure_title: str = None, repair_steps: list = None):
    """
    Generates dynamic step-by-step video walkthrough with SVG frame sequences & physical MP3 TTS audio voiceovers.
    """
    title = procedure_title or f"Equipment Repair Procedure ({manual_id})"
    steps_list = repair_steps or [
        "Isolate main power and disconnect pressure lines.",
        "Unscrew housing bolts counter-clockwise and remove cover plate.",
        "Replace worn seal filter with new component P-2.",
        "Re-tighten housing bolts to 25 Nm torque specification."
    ]

    tools_by_step = [
        "Safety Gloves & Eye Protection",
        "10mm Socket Wrench",
        "Replacement Seal Kit (P-2)",
        "Calibrated Torque Wrench"
    ]

    frames = []
    total_steps = len(steps_list)

    for idx, step_desc in enumerate(steps_list):
        step_num = idx + 1
        tool = tools_by_step[idx % len(tools_by_step)]
        
        narration = f"Step {step_num}: {step_desc}"
        prompt = (
            f"Create a concise 1-sentence audio narration script for repair step {step_num}: {step_desc}. "
            "Make it clear, instructional, and safe."
        )
        ai_narr = generate_ai_content(prompt)
        if ai_narr:
            narration = ai_narr


        svg_prompt = (
            f"You are an expert technical illustrator.\n"
            f"Create an interactive SVG frame (800x500) for a repair video.\n"
            f"Procedure: {title}\n"
            f"Current Step ({step_num}/{total_steps}): {step_desc}\n"
            f"Tool Required: {tool}\n"
            f"Include a progress bar showing step {step_num} of {total_steps}.\n"
            f"{SVG_PROMPT_RULES}"
        )
        ai_svg = generate_ai_content(prompt=svg_prompt, model_name="gemini-1.5-pro")
        
        if ai_svg:
            svg_markup = sanitize_svg_markup(ai_svg)
        else:
            # Fallback if generation completely fails
            progress_width = int((step_num / max(total_steps, 1)) * 740)
            svg_markup = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" class="w-full h-auto border rounded-xl bg-slate-950 text-white p-4">
              <rect width="100%" height="100%" fill="#090d16" rx="12"/>
              <text x="30" y="40" fill="#38bdf8" font-size="18" font-weight="bold">Step {step_num} of {total_steps}: Step {step_num}</text>
              <rect x="30" y="55" width="740" height="6" fill="#1e293b" rx="3"/>
              <rect x="30" y="55" width="{progress_width}" height="6" fill="#38bdf8" rx="3"/>
              <rect x="200" y="100" width="400" height="260" fill="none" stroke="#ef4444" stroke-width="3" stroke-dasharray="8,8" rx="10"/>
              <text x="400" y="235" fill="#ffffff" font-size="22" text-anchor="middle" font-weight="bold">SVG GENERATION FAILED</text>
            </svg>"""
        audio_url = synthesize_mp3_url(narration)

        frames.append({
            "step": step_num,
            "title": f"Step {step_num}: {step_desc[:40]}...",
            "description": step_desc,
            "narration": narration,
            "toolRequired": tool,
            "svgFrame": svg_markup,
            "audioUrl": audio_url,
            "durationSeconds": 10
        })

    return {
        "manualId": manual_id,
        "procedureTitle": title,
        "totalSteps": total_steps,
        "totalDurationSeconds": total_steps * 10,
        "frames": frames
    }
