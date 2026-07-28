import os
import json
import base64
import io
from agents.vertex_ai_helper import generate_ai_content



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


def synthesize_mp3_base64(text: str, lang: str = "en") -> str:
    """
    Synthesizes physical MP3 audio binary bytes for narration text
    and returns a base64 Data URL payload ready for HTML5 <audio> playback.
    """
    if GTTS_AVAILABLE:
        try:
            tts = gTTS(text=text, lang=lang, slow=False)
            mp3_fp = io.BytesIO()
            tts.write_to_fp(mp3_fp)
            mp3_fp.seek(0)
            b64_str = base64.b64encode(mp3_fp.read()).decode("utf-8")
            return f"data:audio/mp3;base64,{b64_str}"
        except Exception as err:
            print(f"Notice generating gTTS audio: {err}")

    # Fallback placeholder base64 payload if gTTS is offline
    dummy_bytes = f"AUDIO_SYNTHESIS_FOR: {text}".encode("utf-8")
    return f"data:audio/mp3;base64,{base64.b64encode(dummy_bytes).decode('utf-8')}"

def compose_svg_frame(step_num: int, total_steps: int, step_title: str, tool_required: str) -> str:
    """
    Composes interactive SVG frame markup for a specific repair step.
    """
    progress_width = int((step_num / max(total_steps, 1)) * 740)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" class="w-full h-auto border rounded-xl bg-slate-950 text-white p-4">
  <rect width="100%" height="100%" fill="#090d16" rx="12"/>
  
  <!-- Header Bar -->
  <text x="30" y="40" fill="#38bdf8" font-size="18" font-weight="bold">Step {step_num} of {total_steps}: {step_title}</text>
  <rect x="30" y="55" width="740" height="6" fill="#1e293b" rx="3"/>
  <rect x="30" y="55" width="{progress_width}" height="6" fill="#38bdf8" rx="3"/>

  <!-- Step Visual Graphic -->
  <rect x="200" y="100" width="400" height="260" fill="none" stroke="#0284c7" stroke-width="3" stroke-dasharray="8,8" rx="10"/>
  <circle cx="400" cy="230" r="60" fill="#0369a1" stroke="#38bdf8" stroke-width="4"/>
  <text x="400" y="235" fill="#ffffff" font-size="22" text-anchor="middle" font-weight="bold">STEP {step_num}</text>
  
  <!-- Tool Highlight Badge -->
  <rect x="30" y="420" width="300" height="40" fill="#1e293b" stroke="#f59e0b" stroke-width="2" rx="6"/>
  <text x="45" y="445" fill="#f59e0b" font-size="13" font-weight="bold">🛠️ Tool Required: {tool_required}</text>

  <!-- Safety Badge -->
  <rect x="520" y="420" width="250" height="40" fill="#1e293b" stroke="#10b981" stroke-width="2" rx="6"/>
  <text x="535" y="445" fill="#10b981" font-size="13" font-weight="bold">🛡️ Safety Gear Required</text>
</svg>"""

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


        svg_markup = compose_svg_frame(step_num, total_steps, f"Step {step_num}", tool)
        audio_url = synthesize_mp3_base64(narration)

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
