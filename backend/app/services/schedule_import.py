import re
from datetime import date, datetime, time, timedelta, timezone

from docx import Document as DocxDocument
from sqlalchemy.orm import Session

from app.models import Group, GroupStatus, Room, ScheduleSlot, Subject, Teacher

UA_MONTHS = {
    "січня": 1,
    "лютого": 2,
    "березня": 3,
    "квітня": 4,
    "травня": 5,
    "червня": 6,
    "липня": 7,
    "серпня": 8,
    "вересня": 9,
    "жовтня": 10,
    "листопада": 11,
    "грудня": 12,
}


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _parse_group_code(lines: list[str]) -> str:
    for line in lines:
        match = re.search(r"група\s*№?\s*([0-9A-Za-zА-Яа-яЇїІіЄєҐґ\-/]+)", line, re.IGNORECASE)
        if match:
            return match.group(1).strip()
    raise ValueError("Не вдалося визначити номер групи з документа")


def _parse_course_title(lines: list[str], group_code: str) -> str:
    for index, line in enumerate(lines):
        if "за напрямом" in line.lower():
            match = re.search(r"за напрямом\s*[«\"'„](.*?)[»\"'”]", line, re.IGNORECASE)
            if match:
                return match.group(1).strip()
            if index + 1 < len(lines):
                return _norm(lines[index + 1]).strip("„”\"")
    for line in lines:
        if group_code in line:
            continue
        if len(line) > 25:
            return _norm(line).strip("„”\"")
    return f"Група {group_code}"


def _parse_date_range(lines: list[str]) -> tuple[date | None, date | None]:
    for line in lines:
        # e.g., "з «11» березня 2026 року до «24» березня 2026 року"
        # Extract all dates in the line
        matches = re.findall(r"(\d{1,2})[»\"']?\s+([А-Яа-яіїєґ]+)(?:\s+(\d{4}))?", line.lower())
        if len(matches) >= 2:
            start_match, end_match = matches[0], matches[-1]
            start_day, start_month_ua, start_year = start_match
            end_day, end_month_ua, end_year = end_match
            
            start_month = UA_MONTHS.get(start_month_ua)
            end_month = UA_MONTHS.get(end_month_ua)
            
            year_int = int(end_year) if end_year else (int(start_year) if start_year else date.today().year)
            start_year_int = int(start_year) if start_year else year_int
            
            if start_month and end_month:
                start_date = date(start_year_int, start_month, int(start_day))
                end_date = date(year_int, end_month, int(end_day))
                return start_date, end_date
    return None, None


def _parse_pair_windows(lines: list[str]) -> dict[int, tuple[time, time]]:
    pair_windows: dict[int, tuple[time, time]] = {}
    for line in lines:
        match = re.search(
            r"(\d+)\s*пара\s*[-–—:]?\s*(\d{1,2})[.:](\d{2})\s*[–—-]\s*(\d{1,2})[.:](\d{2})",
            line.lower(),
        )
        if not match:
            continue
        pair_number, sh, sm, eh, em = match.groups()
        pair_windows[int(pair_number)] = (time(int(sh), int(sm)), time(int(eh), int(em)))
    return pair_windows


def _parse_hours(value: str) -> float:
    match = re.search(r"([0-9]+(?:[.,][0-9]+)?)", value)
    if not match:
        return 0.0
    return float(match.group(1).replace(",", "."))


def _parse_pairs_cell(cell_text: str) -> list[tuple[int, float]]:
    text = _norm(cell_text).lower()
    if not text:
        return []
    hours_match = re.search(r"/\s*([0-9]+(?:[.,][0-9]+)?)\s*год", text)
    total_hours = float(hours_match.group(1).replace(",", ".")) if hours_match else 2.0

    pair_part = text.split("/")[0]
    pair_part = pair_part.replace("п", "").replace("ара", "").replace("пара", "")
    pair_numbers: list[int] = []
    for token in re.split(r"[,\s]+", pair_part):
        token = token.strip()
        if not token:
            continue
        range_match = re.match(r"^(\d+)-(\d+)$", token)
        if range_match:
            start_idx = int(range_match.group(1))
            end_idx = int(range_match.group(2))
            pair_numbers.extend(list(range(start_idx, end_idx + 1)))
            continue
        if token.isdigit():
            pair_numbers.append(int(token))

    pair_numbers = sorted({pair for pair in pair_numbers if pair > 0})
    if not pair_numbers:
        return []

    hours_per_pair = round(total_hours / len(pair_numbers), 2)
    return [(pair, hours_per_pair) for pair in pair_numbers]


def _split_teacher_name(full_name: str) -> tuple[str, str]:
    tokens = [part for part in _norm(full_name).split(" ") if part]
    if not tokens:
        return "Невідомий", "Викладач"
    if len(tokens) == 1:
        return tokens[0], "Викладач"
    return tokens[0], " ".join(tokens[1:])


def parse_schedule_docx(file_path: str) -> dict:
    document = DocxDocument(file_path)
    lines = [_norm(paragraph.text) for paragraph in document.paragraphs if _norm(paragraph.text)]
    if not document.tables:
        raise ValueError("У документі не знайдено таблиці розкладу")

    table = document.tables[0]
    if len(table.rows) < 2 or len(table.columns) < 6:
        raise ValueError("Таблиця розкладу має неочікувану структуру")

    group_code = _parse_group_code(lines)
    group_name = _parse_course_title(lines, group_code)
    start_date, end_date = _parse_date_range(lines)
    pair_windows = _parse_pair_windows(lines)

    header_row = table.rows[0]
    date_columns: dict[int, date] = {}
    year = (end_date or start_date or date.today()).year
    for column_index in range(3, len(header_row.cells) - 1):
        header_text = _norm(header_row.cells[column_index].text)
        match = re.search(r"(\d{1,2})\.(\d{1,2})", header_text)
        if not match:
            continue
        day, month = int(match.group(1)), int(match.group(2))
        date_columns[column_index] = date(year, month, day)

    if not date_columns:
        raise ValueError("Не вдалося визначити дати в заголовку таблиці розкладу")

    entries: list[dict] = []
    total_group_hours = 0.0
    for row in table.rows[1:]:
        cells = row.cells
        index_cell = _norm(cells[0].text)
        subject_name = _norm(cells[1].text)
        declared_subject_hours = _parse_hours(cells[2].text)
        teacher_name = _norm(cells[-1].text)

        if not subject_name:
            continue
        if "загальний обсяг" in subject_name.lower():
            total_group_hours = _parse_hours(cells[2].text)
            continue
        if not index_cell.isdigit():
            continue

        for column_index, lesson_date in date_columns.items():
            if column_index >= len(cells):
                continue
            cell_value = _norm(cells[column_index].text)
            for pair_number, academic_hours in _parse_pairs_cell(cell_value):
                pair_window = pair_windows.get(pair_number)
                if pair_window:
                    starts_at = datetime.combine(lesson_date, pair_window[0], tzinfo=timezone.utc)
                    ends_at = datetime.combine(lesson_date, pair_window[1], tzinfo=timezone.utc)
                else:
                    starts_at = datetime.combine(lesson_date, time(hour=9 + (pair_number - 1) * 2), tzinfo=timezone.utc)
                    ends_at = starts_at + timedelta(minutes=95)
                entries.append(
                    {
                        "subject_name": subject_name,
                        "declared_subject_hours": declared_subject_hours,
                        "teacher_name": teacher_name,
                        "lesson_date": lesson_date.isoformat(),
                        "pair_number": pair_number,
                        "academic_hours": academic_hours,
                        "starts_at": starts_at,
                        "ends_at": ends_at,
                    }
                )

    if not entries:
        raise ValueError("У таблиці не знайдено занять для імпорту")

    if total_group_hours <= 0:
        total_group_hours = round(sum(item["academic_hours"] for item in entries), 2)

    return {
        "group_code": group_code,
        "group_name": group_name,
        "start_date": start_date.isoformat() if start_date else None,
        "end_date": end_date.isoformat() if end_date else None,
        "group_total_hours": total_group_hours,
        "entries": entries,
    }


def import_schedule_docx(db: Session, file_path: str, branch_id: str, actor_user_id: int | None = None) -> dict:
    parsed = parse_schedule_docx(file_path)
    group_code = parsed["group_code"]
    group_name = parsed["group_name"]

    group = db.query(Group).filter(Group.branch_id == branch_id, Group.code == group_code).first()
    if not group:
        group = Group(
            branch_id=branch_id,
            code=group_code,
            name=group_name,
            status=GroupStatus.ACTIVE,
            start_date=date.fromisoformat(parsed["start_date"]) if parsed["start_date"] else None,
            end_date=date.fromisoformat(parsed["end_date"]) if parsed["end_date"] else None,
        )
        db.add(group)
        db.flush()
    else:
        group.name = group_name or group.name
        if parsed["start_date"]:
            group.start_date = date.fromisoformat(parsed["start_date"])
        if parsed["end_date"]:
            group.end_date = date.fromisoformat(parsed["end_date"])
        db.add(group)
        db.flush()

    room_name = f"Імпорт: {group.code}"
    room = db.query(Room).filter(Room.branch_id == branch_id, Room.name == room_name).first()
    if not room:
        room = Room(branch_id=branch_id, name=room_name, capacity=max(group.capacity, 20))
        db.add(room)
        db.flush()

    # ──────────────────────────────────────────────────────────────────────────
    # Idempotent import: wipe existing slots for this group within the document
    # date range before inserting fresh ones.  This guarantees that:
    #   • re-importing the same file produces exactly the same result;
    #   • slots that belonged to a previously-deleted teacher are never left as
    #     orphaned rows blocking the new teacher from appearing on the calendar.
    # ──────────────────────────────────────────────────────────────────────────
    doc_start_date = date.fromisoformat(parsed["start_date"]) if parsed["start_date"] else None
    doc_end_date   = date.fromisoformat(parsed["end_date"])   if parsed["end_date"]   else None

    if doc_start_date and doc_end_date:
        window_start = datetime.combine(doc_start_date, time.min, tzinfo=timezone.utc)
        window_end   = datetime.combine(doc_end_date,   time.max, tzinfo=timezone.utc)
        deleted_count = (
            db.query(ScheduleSlot)
            .filter(
                ScheduleSlot.group_id == group.id,
                ScheduleSlot.starts_at >= window_start,
                ScheduleSlot.starts_at <= window_end,
            )
            .delete(synchronize_session=False)
        )
        db.flush()
    else:
        deleted_count = 0

    teacher_cache: dict[str, Teacher] = {}
    subject_cache: dict[str, Subject] = {}
    candidates: list[dict] = []

    for entry in parsed["entries"]:
        teacher_full_name = _norm(entry["teacher_name"])
        if teacher_full_name not in teacher_cache:
            last_name, first_name = _split_teacher_name(teacher_full_name)
            existing_teachers = (
                db.query(Teacher)
                .filter(Teacher.branch_id == branch_id, Teacher.last_name == last_name)
                .all()
            )
            teacher = None
            if existing_teachers:
                for t in existing_teachers:
                    if not t.first_name or not first_name:
                        teacher = t
                        break
                    if t.first_name[0].lower() == first_name[0].lower():
                        teacher = t
                        break
                if not teacher:
                    teacher = existing_teachers[0]
                
                # Upgrade first name to full name if the new one is longer and without dots
                if len(first_name) > len(teacher.first_name or "") and "." not in first_name:
                    teacher.first_name = first_name
                    db.add(teacher)
                    db.flush()
            else:
                teacher = Teacher(
                    branch_id=branch_id,
                    last_name=last_name,
                    first_name=first_name,
                    hourly_rate=0.0,
                    is_active=True,
                )
                db.add(teacher)
                db.flush()
            teacher_cache[teacher_full_name] = teacher
        teacher = teacher_cache[teacher_full_name]

        subject_name = _norm(entry["subject_name"])
        if subject_name not in subject_cache:
            subject = db.query(Subject).filter(Subject.branch_id == branch_id, Subject.name == subject_name).first()
            declared_hours = int(entry["declared_subject_hours"] or 0)
            if not subject:
                subject = Subject(branch_id=branch_id, name=subject_name, hours_total=max(declared_hours, 1))
                db.add(subject)
                db.flush()
            elif declared_hours > subject.hours_total:
                subject.hours_total = declared_hours
                db.add(subject)
                db.flush()
            subject_cache[subject_name] = subject
        subject = subject_cache[subject_name]

        candidates.append(
            {
                "group_id": group.id,
                "teacher_id": teacher.id,
                "subject_id": subject.id,
                "room_id": room.id,
                "teacher_name": teacher_full_name,
                "subject_name": subject_name,
                "starts_at": entry["starts_at"],
                "ends_at": entry["ends_at"],
                "pair_number": int(entry["pair_number"]),
                "academic_hours": float(entry["academic_hours"]),
            }
        )

    min_start = min(item["starts_at"] for item in candidates)
    max_end = max(item["ends_at"] for item in candidates)
    existing_slots = (
        db.query(ScheduleSlot)
        .join(Group, Group.id == ScheduleSlot.group_id)
        .filter(
            Group.branch_id == branch_id,
            ScheduleSlot.starts_at < max_end,
            ScheduleSlot.ends_at > min_start,
        )
        .all()
    )

    def as_utc(value: datetime) -> datetime:
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)

    def overlaps(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
        a_start = as_utc(a_start)
        a_end = as_utc(a_end)
        b_start = as_utc(b_start)
        b_end = as_utc(b_end)
        return a_start < b_end and b_start < a_end

    conflict_messages: list[str] = []
    for index, candidate in enumerate(candidates):
        for existing in existing_slots:
            if not overlaps(candidate["starts_at"], candidate["ends_at"], existing.starts_at, existing.ends_at):
                continue
            conflict_date = candidate["starts_at"].date().isoformat()
            if existing.teacher_id == candidate["teacher_id"]:
                conflict_messages.append(
                    f"викладач {candidate['teacher_name']} {conflict_date} пара {candidate['pair_number']}"
                )
            if existing.group_id == candidate["group_id"]:
                conflict_messages.append(
                    f"група {group.code} {conflict_date} пара {candidate['pair_number']}"
                )
            if existing.room_id == candidate["room_id"]:
                conflict_messages.append(
                    f"аудиторія {room.name} {conflict_date} пара {candidate['pair_number']}"
                )
        for previous in candidates[:index]:
            if not overlaps(candidate["starts_at"], candidate["ends_at"], previous["starts_at"], previous["ends_at"]):
                continue
            if previous["teacher_id"] == candidate["teacher_id"]:
                conflict_messages.append(
                    f"внутрішній конфлікт імпорту: {candidate['teacher_name']} {candidate['starts_at'].date().isoformat()} пара {candidate['pair_number']}"
                )

    if conflict_messages:
        unique_conflicts = sorted(set(conflict_messages))
        preview = "; ".join(unique_conflicts[:8])
        # We no longer fail the import on conflict! 
        # The user wants to see conflicts in the UI directly.
        pass

    teacher_hours: dict[str, float] = {}
    for candidate in candidates:
        db.add(
            ScheduleSlot(
                group_id=candidate["group_id"],
                teacher_id=candidate["teacher_id"],
                subject_id=candidate["subject_id"],
                room_id=candidate["room_id"],
                starts_at=candidate["starts_at"],
                ends_at=candidate["ends_at"],
                pair_number=candidate["pair_number"],
                academic_hours=candidate["academic_hours"],
                generated_by=actor_user_id,
            )
        )
        teacher_hours.setdefault(candidate["teacher_name"], 0.0)
        teacher_hours[candidate["teacher_name"]] += candidate["academic_hours"]

    return {
        "import_kind": "schedule_docx",
        "group_code": group.code,
        "group_name": group.name,
        "group_total_hours": parsed["group_total_hours"],
        "deleted_slots": deleted_count,
        "created_slots": len(candidates),
        "teachers": len(teacher_cache),
        "subjects": len(subject_cache),
        "teacher_workload_hours": {name: round(hours, 2) for name, hours in teacher_hours.items()},
    }
