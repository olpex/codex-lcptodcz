import re
from datetime import date
from pathlib import Path
from typing import Any

import pytesseract
from PIL import Image
from celery.utils.log import get_task_logger

from app.core.config import settings

if settings.tesseract_cmd:
    pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd

logger = get_task_logger(__name__)

GROUP_CODE_PATTERN = re.compile(r"\b([0-9]{1,4}[A-Za-zА-Яа-яЇїІіЄєҐґ]?\s*[-/.]\s*\d{2})\b")
DATE_PATTERN = re.compile(r"\b([0-3]?\d)[./]([01]?\d)(?:[./](\d{2,4}))?\b")
PAIR_HOURS_PATTERN = re.compile(r"\b(\d{1,2})\s*[пpn]\s*/\s*(\d+(?:[.,]\d+)?)\s*год", re.IGNORECASE)
CYRILLIC_NAME_PATTERN = re.compile(r"\b[А-ЯІЇЄҐ][а-яіїєґ'’.-]+(?:\s+[А-ЯІЇЄҐ][а-яіїєґ'’.-]+){1,3}\b")

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
    except Exception as exc:
        logger.warning("Tesseract OCR failed for %s: %s", path, exc)
        return ""


def _normalize_group_code(raw: str) -> str:
    value = (raw or "").strip()
    for sep in ("–", "—", "−", "/", "."):
        value = value.replace(sep, "-")
    value = re.sub(r"\s+", "", value)
    value = re.sub(r"-{2,}", "-", value)
    return value


def _extract_group_code(text: str, group_code_hint: str | None = None) -> str:
    if group_code_hint:
        return _normalize_group_code(group_code_hint)

    match = re.search(
        r"група\s*№?\s*([0-9]{1,4}[A-Za-zА-Яа-яЇїІіЄєҐґ]?\s*[-/.]\s*\d{2})",
        text,
        re.IGNORECASE,
    )
    if match:
        return _normalize_group_code(match.group(1))

    fallback = GROUP_CODE_PATTERN.search(text)
    return _normalize_group_code(fallback.group(1)) if fallback else ""


def _infer_year(group_code: str, text: str) -> int:
    year_match = re.search(r"\b(20\d{2})\b", text)
    if year_match:
        return int(year_match.group(1))
    suffix = re.search(r"-(\d{2})$", group_code or "")
    if suffix:
        return 2000 + int(suffix.group(1))
    return date.today().year


def _parse_ocr_dates(text: str, group_code: str) -> list[str]:
    default_year = _infer_year(group_code, text)
    result: list[str] = []
    seen: set[str] = set()
    for match in DATE_PATTERN.finditer(text):
        day = int(match.group(1))
        month = int(match.group(2))
        raw_year = match.group(3)
        year = int(raw_year) if raw_year and len(raw_year) == 4 else 2000 + int(raw_year) if raw_year else default_year
        try:
            parsed = date(year, month, day).isoformat()
        except ValueError:
            continue
        if parsed not in seen:
            seen.add(parsed)
            result.append(parsed)
    return result


def _meaningful_lines(segment: str) -> list[str]:
    lines = [re.sub(r"\s+", " ", line).strip(" ,;:") for line in segment.splitlines()]
    result: list[str] = []
    stop_words = (
        "розклад",
        "група",
        "дата",
        "пара",
        "предмет",
        "викладач",
        "години",
        "кількість",
        "загальний обсяг",
        "навчального часу",
        "за напрямом",
    )
    for line in lines:
        lower = line.lower()
        if not line or len(line) < 3:
            continue
        if DATE_PATTERN.search(line) or PAIR_HOURS_PATTERN.search(line):
            continue
        if any(word in lower for word in stop_words):
            continue
        if re.fullmatch(r"[\d\s.,/-]+", line):
            continue
        result.append(line)
    return result


def _looks_like_teacher(value: str) -> bool:
    lower = value.lower()
    if any(word in lower for word in ("занят", "практич", "завдан", "охорон", "підсумков", "навчальн")):
        return False
    return bool(CYRILLIC_NAME_PATTERN.search(value))


def _find_teacher(segment: str, previous_teacher: str) -> str:
    for line in _meaningful_lines(segment):
        if _looks_like_teacher(line):
            return line
    match = CYRILLIC_NAME_PATTERN.search(segment)
    return match.group(0).strip() if match else previous_teacher


def _find_subject(segment: str) -> str:
    candidates = [line for line in _meaningful_lines(segment) if not _looks_like_teacher(line)]
    if not candidates:
        return "Заняття з OCR"
    return " ".join(candidates[-3:])[:255]


def _parse_schedule_payload(text: str, group_code_hint: str | None = None) -> dict:
    normalized_text = text.replace("\\r\\n", "\n").replace("\\n", "\n")
    group_code = _extract_group_code(normalized_text, group_code_hint)
    dates = _parse_ocr_dates(normalized_text, group_code)
    pair_matches = list(PAIR_HOURS_PATTERN.finditer(normalized_text))
    entries: list[dict[str, object]] = []
    previous_teacher = ""
    previous_subject = ""

    for index, match in enumerate(pair_matches):
        if not dates:
            break
        before_start = pair_matches[index - 1].end() if index > 0 else 0
        before_segment = normalized_text[before_start : match.start()]
        after_segment = normalized_text[match.end() : min(len(normalized_text), match.end() + 700)]
        teacher = _find_teacher(after_segment, previous_teacher) or "Невідомий викладач"
        previous_teacher = teacher
        subject = _find_subject(before_segment)
        if subject == "Заняття з OCR" and previous_subject:
            subject = previous_subject
        previous_subject = subject
        entries.append(
            {
                "date": dates[index % len(dates)],
                "pair_number": int(match.group(1)),
                "teacher_name": teacher,
                "subject_name": subject,
                "room_name": "OCR",
                "academic_hours": float(match.group(2).replace(",", ".")),
            }
        )

    return {
        "group_code": group_code,
        "group_name": f"Група {group_code}" if group_code else "",
        "entries": entries,
        "raw_text": text[:12000],
        "source": "ocr",
    }


def parse_schedule_ocr_text(text: str, group_code_hint: str | None = None) -> dict:
    return _parse_schedule_payload(text, group_code_hint)


def extract_group_code_hint(text: str | None) -> str:
    return _extract_group_code(text or "")


def guess_draft_from_text(text: str, group_code_hint: str | None = None) -> tuple[str, dict]:
    openai_result = _guess_draft_openai(text)
    if openai_result:
        draft_type, payload = openai_result
        if draft_type == "schedule" and group_code_hint and not payload.get("group_code"):
            payload["group_code"] = _normalize_group_code(group_code_hint)
            payload["group_name"] = payload.get("group_name") or f"Група {payload['group_code']}"
        return draft_type, payload
    return _guess_draft_rule_based(text, group_code_hint)


def _guess_draft_rule_based(text: str, group_code_hint: str | None = None) -> tuple[str, dict]:
    lower = text.lower()
    if "розклад" in lower or "пара" in lower or ("занять" in lower and ("група" in lower or "групи" in lower)):
        return "schedule", _parse_schedule_payload(text, group_code_hint)

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
    contract_match = re.search(r"(?:догов[оі]р|№)\s*([A-Za-zА-Яа-я0-9/-]+)", text, re.IGNORECASE)
    group_code = _extract_group_code(text, group_code_hint)
    return "trainee_card", {
        "first_name": first_name,
        "last_name": last_name,
        "status": "active",
        "contract_number": contract_match.group(1) if contract_match else "",
        "group_code": group_code,
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
                        "Поверни JSON: {\"draft_type\":\"order|trainee_card|schedule\",\"payload\":{...}}. "
                        "Для order обов'язково order_number, status. "
                        "Для trainee_card обов'язково first_name, last_name, status; якщо є, додай group_code, contract_number, birth_date, phone, email. "
                        "Для schedule поверни group_code, group_name, entries. "
                        "entries: [{date:'YYYY-MM-DD', pair_number:1, teacher_name:'...', subject_name:'...', room_name:'...', academic_hours:2}]."
                    ),
                },
                {"role": "user", "content": text[:12000]},
            ],
        )
        content = response.choices[0].message.content or "{}"
        parsed = _parse_json_object(content)
        draft_type = str(parsed.get("draft_type") or "").strip().lower()
        payload = parsed.get("payload") if isinstance(parsed.get("payload"), dict) else {}

        if draft_type not in {"order", "trainee_card", "schedule"}:
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
    if draft_type == "schedule":
        entries = payload.get("entries") if isinstance(payload.get("entries"), list) else []
        return {
            "group_code": str(payload.get("group_code") or ""),
            "group_name": str(payload.get("group_name") or ""),
            "entries": entries,
            "source": "openai_ocr",
        }
    return {
        "first_name": str(payload.get("first_name") or "Невідомо"),
        "last_name": str(payload.get("last_name") or "Невідомо"),
        "status": str(payload.get("status") or "active"),
        "group_code": str(payload.get("group_code") or ""),
        "contract_number": str(payload.get("contract_number") or ""),
        "birth_date": str(payload.get("birth_date") or ""),
        "phone": str(payload.get("phone") or ""),
        "email": str(payload.get("email") or ""),
        "source": "openai_ocr",
    }
