import re
from pathlib import Path
from typing import Any

import pytesseract
from PIL import Image
from celery.utils.log import get_task_logger

from app.core.config import settings

if settings.tesseract_cmd:
    pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd

logger = get_task_logger(__name__)

try:
    from openai import OpenAI
except Exception:  # pragma: no cover - optional runtime dependency fallback
    OpenAI = None  # type: ignore[assignment]


def ocr_image_file(file_path: str) -> str:
    path = Path(file_path)
    if not path.exists():
        return ""
    try:
        with Image.open(path) as image:
            return pytesseract.image_to_string(image, lang=settings.ocr_language).strip()
    except Exception:
        return ""


def _guess_draft_rule_based(text: str) -> tuple[str, dict]:
    lower = text.lower()
    if "наказ" in lower:
        number_match = re.search(r"№\s*([A-Za-zА-Яа-я0-9/-]+)", text)
        return "order", {
            "order_number": number_match.group(1) if number_match else "AUTO",
            "status": "draft",
            "source": "ocr",
        }

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    first = lines[0] if lines else "Невідомо"
    tokens = first.split(" ")
    first_name = tokens[0] if tokens else "Невідомо"
    last_name = tokens[1] if len(tokens) > 1 else "Невідомо"
    return "trainee_card", {
        "first_name": first_name,
        "last_name": last_name,
        "status": "active",
        "source": "ocr",
    }


def _guess_draft_openai(text: str) -> tuple[str, dict] | None:
    if not settings.openai_ocr_enabled or not settings.openai_api_key or OpenAI is None:
        return None
    if not text.strip():
        return None

    client = OpenAI(api_key=settings.openai_api_key)
    try:
        response = client.chat.completions.create(
            model=settings.openai_model,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Ти парсер OCR-тексту для СУПТЦ. "
                        "Поверни JSON: {\"draft_type\":\"order|trainee_card\",\"payload\":{...}}. "
                        "Для order обов'язково order_number, status. "
                        "Для trainee_card обов'язково first_name, last_name, status."
                    ),
                },
                {"role": "user", "content": text[:12000]},
            ],
        )
        content = response.choices[0].message.content or "{}"
        parsed = _parse_json_object(content)
        draft_type = str(parsed.get("draft_type") or "").strip().lower()
        payload = parsed.get("payload") if isinstance(parsed.get("payload"), dict) else {}

        if draft_type not in {"order", "trainee_card"}:
            return None
        normalized = _normalize_payload(draft_type, payload)
        return draft_type, normalized
    except Exception as exc:
        logger.warning("OpenAI OCR parse failed, fallback to rule-based parser: %s", exc)
        return None


def _parse_json_object(raw: str) -> dict[str, Any]:
    import json

    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _normalize_payload(draft_type: str, payload: dict[str, Any]) -> dict:
    if draft_type == "order":
        return {
            "order_number": str(payload.get("order_number") or "AUTO"),
            "status": str(payload.get("status") or "draft"),
            "source": "openai_ocr",
        }
    return {
        "first_name": str(payload.get("first_name") or "Невідомо"),
        "last_name": str(payload.get("last_name") or "Невідомо"),
        "status": str(payload.get("status") or "active"),
        "source": "openai_ocr",
    }


def guess_draft_from_text(text: str) -> tuple[str, dict]:
    openai_result = _guess_draft_openai(text)
    if openai_result:
        return openai_result
    return _guess_draft_rule_based(text)
