import re

DASH_VARIANTS = '–—‑‒−﹘﹣'

def _normalize_compact(value: str) -> str:
    return ' '.join((value or '').strip().lower().split())

def _normalized_contract_filename_stem(filename: str) -> str:
    if not filename:
        return None
    lower = filename.strip().lower()
    if '.' not in lower:
        return None
    stem, ext = lower.rsplit('.', 1)
    if ext not in {'xlsx', 'xls'}:
        return None

    normalized_stem = stem.replace('_', ' ').replace('\u00a0', ' ')
    for dash in DASH_VARIANTS:
        normalized_stem = normalized_stem.replace(dash, '-')
    return _normalize_compact(normalized_stem)

filename = '180-25 Договори  Штучний інтелект.xls'
stem = _normalized_contract_filename_stem(filename)
print(f'Stem: {stem!r}')

keyword = _normalize_compact('Договори')
print(f'Keyword: {keyword!r}')
print(f'Matched: {keyword in stem}')
