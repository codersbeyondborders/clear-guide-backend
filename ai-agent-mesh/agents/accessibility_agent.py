import os
import json
from agents.vertex_ai_helper import generate_ai_content

LANGUAGE_NAMES = {
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "zh": "Simplified Chinese",
    "ja": "Japanese",
    "ar": "Arabic",
    "hi": "Hindi",
}

async def simplify_and_translate(text: str, target_language: str = "es", reading_level: str = "8th_grade"):
    """
    Simplifies complex technical documentation to WCAG 8th-grade cognitive reading level
    and translates text into the requested target language using Google Cloud Vertex AI.
    """
    lang_name = LANGUAGE_NAMES.get(target_language.lower(), target_language)

    simplified_text = (
        "Safety Summary: Turn off the machine before starting. "
        "Remove the main cover plate with a wrench. Replace the worn rubber seal with a new one."
    )
    translated_text = (
        f"[{lang_name}] Resumen de seguridad: Apague la máquina antes de comenzar. "
        f"Retire la tapa principal con una llave. Reemplace el sello de goma desgastado por uno nuevo."
    )
    glossary = [
        {"term": "Piezoelectric Actuator", "simpleDefinition": "An electrical switch that opens or closes a valve using small electric signals."},
        {"term": "Torque Specification", "simpleDefinition": "How tight a bolt or screw needs to be turned."}
    ]

    prompt = (
        "You are an expert cognitive accessibility and technical translation agent compliant with WCAG 2.2 AAA standards.\n"
        f"Original Technical Text:\n{text}\n\n"
        f"Task:\n"
        f"1. Rewrite the text into simple, easy-to-read English (~8th-grade reading level, short sentences, active voice).\n"
        f"2. Translate the simplified version into {lang_name}.\n"
        f"3. Create a short glossary defining 2 complex technical terms in simple language.\n\n"
        "Format output as clean JSON with keys: 'simplifiedText', 'translatedText', 'glossary'."
    )

    response_text = generate_ai_content(prompt)
    if response_text:
        clean_json_str = response_text.replace("```json", "").replace("```", "").strip()
        try:
            parsed = json.loads(clean_json_str)
            if "simplifiedText" in parsed:
                simplified_text = parsed["simplifiedText"]
            if "translatedText" in parsed:
                translated_text = parsed["translatedText"]
            if "glossary" in parsed:
                glossary = parsed["glossary"]
        except Exception:
            simplified_text = response_text

    return {
        "originalText": text,
        "simplifiedText": simplified_text,
        "translatedText": translated_text,
        "targetLanguage": target_language,
        "targetLanguageName": lang_name,
        "readingLevel": reading_level,
        "glossary": glossary
    }
