import re
from pathlib import Path

import pytesseract
from PIL import Image

from app.core.config import settings

if settings.tesseract_cmd:
    pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd


def ocr_image_file(file_path: str) -> str:
    path = Path(file_path)
    if not path.exists():
        return ""
    try:
        with Image.open(path) as image:
            return pytesseract.image_to_string(image, lang=settings.ocr_language).strip()
    except Exception:
        return ""


def guess_draft_from_text(text: str) -> tuple[str, dict]:
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

