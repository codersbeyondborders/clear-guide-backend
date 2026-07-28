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
    "pt": "Portuguese",
    "sw": "Swahili",
    "it": "Italian",
    "nl": "Dutch",
    "ko": "Korean",
}

async def translate_content(text: str, target_language: str = "es", source_language: str = None):
    """
    Dedicated Language Translation Agent using Google Cloud Vertex AI Enterprise SDK.
    Preserves HTML/markdown formatting, UI template tags ({name}), and brand names.
    """
    target_name = LANGUAGE_NAMES.get(target_language.lower(), target_language)
    source_name = LANGUAGE_NAMES.get(source_language.lower(), source_language) if source_language else "Auto-detected"

    translated_text = f"[{target_name}] {text}"

    prompt = (
        f"You are an expert real-time UI and documentation translator for modern web applications.\n"
        f"Target Language: {target_name} (code: {target_language})\n"
        f"Source Language: {source_name}\n"
        f"Text to Translate:\n{text}\n\n"
        "Rules:\n"
        "1. Provide a natural, fluent, and contextual translation.\n"
        "2. Preserve all HTML tags, Markdown symbols, and variable placeholders like {user} or {count}.\n"
        "3. Keep brand names like 'ClearGuide' unchanged.\n\n"
        "Return clean translation text."
    )

    response_text = generate_ai_content(prompt)
    if response_text:
        translated_text = response_text.strip()

    return {
        "originalText": text,
        "translatedText": translated_text,
        "sourceLanguage": source_language or "en",
        "targetLanguage": target_language,
        "targetLanguageName": target_name,
        "agent": "Language-Translation-Agent"
    }
