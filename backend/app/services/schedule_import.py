import re
from datetime import date, datetime, time, timedelta, timezone

from docx import Document as DocxDocument
from sqlalchemy import func
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
    def _normalize_group_code(raw: str) -> str:
        value = (raw or "").strip()
        for sep in ("–", "—", "−", "/", "."):
            value = value.replace(sep, "-")
        value = re.sub(r"\s+", "", value)
        value = re.sub(r"-{2,}", "-", value)
        return value

    # Read from bottom to top so the nearest heading to a table wins.
    for line in reversed(lines):
        match = re.search(
            r"група\s*№?\s*([0-9]{1,4}[A-Za-zА-Яа-яЇїІіЄєҐґ]?\s*[-/.]\s*\d{1,4})",
            line,
            re.IGNORECASE,
        )
        if match:
            return _normalize_group_code(match.group(1))
        fallback = re.search(r"група\s*№?\s*([0-9A-Za-zА-Яа-яЇїІіЄєҐґ\-/\.]+)", line, re.IGNORECASE)
        if fallback:
            cleaned = re.sub(r"[^0-9A-Za-zА-Яа-яЇїІіЄєҐґ\-/\.]", "", fallback.group(1))
            if cleaned:
                return _normalize_group_code(cleaned)

    # Fallback 3: look for common group code patterns even without the word "група"
    # We do not use '.' here to avoid matching dates like '23.06'
    for line in reversed(lines):
        match = re.search(
            r"\b([0-9]{1,4}[A-Za-zА-Яа-яЇїІіЄєҐґ]?\s*[-/]\s*\d{2})\b",
            line,
            re.IGNORECASE,
        )
        if match:
            return _normalize_group_code(match.group(1))

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
    def _year_to_int(value: str | None) -> int | None:
        if not value:
            return None
        normalized = value.strip()
        if not normalized.isdigit():
            return None
        if len(normalized) == 2:
            return 2000 + int(normalized)
        if len(normalized) == 4:
            return int(normalized)
        return None

    for line in lines:
        # e.g., "з «11» березня 2026 року до «24» березня 2026 року"
        # Extract all dates in the line
        matches = re.findall(
            r"(\d{1,2})[»\"']?\s+([А-Яа-яіїєґ]+)(?:\s+(\d{2,4})(?:-?го)?)?",
            line.lower(),
        )
        if len(matches) >= 2:
            start_match, end_match = matches[0], matches[-1]
            start_day, start_month_ua, start_year = start_match
            end_day, end_month_ua, end_year = end_match

            start_month = UA_MONTHS.get(start_month_ua)
            end_month = UA_MONTHS.get(end_month_ua)

            year_int = _year_to_int(end_year) or _year_to_int(start_year) or date.today().year
            start_year_int = _year_to_int(start_year) or year_int

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


def parse_schedule_docx(file_path: str) -> list[dict]:
    document = DocxDocument(file_path)
    lines = [_norm(paragraph.text) for paragraph in document.paragraphs if _norm(paragraph.text)]
    if not document.tables:
        raise ValueError("У документі не знайдено таблиці розкладу")

    # Global fallback parsing
    try:
        global_group_code = _parse_group_code(lines)
    except ValueError:
        global_group_code = "Невідома група"
        
    global_group_name = _parse_course_title(lines, global_group_code)
    global_start_date, global_end_date = _parse_date_range(lines)
    global_pair_windows = _parse_pair_windows(lines)

    # Preserve table order from document body and capture nearby paragraph context
    # so each table can resolve its own group/date metadata.
    table_contexts: list[tuple[object, list[str]]] = []
    context_lines: list[str] = []
    table_index = 0
    for body_child in document.element.body.iterchildren():
        tag = body_child.tag.lower()
        if tag.endswith("}p"):
            text = _norm("".join(body_child.itertext()))
            if text:
                context_lines.append(text)
            continue
        if tag.endswith("}tbl"):
            if table_index >= len(document.tables):
                continue
            table = document.tables[table_index]
            table_index += 1
            # Pass all preceding paragraphs instead of just the last 40.
            # Since we search bottom-up, this guarantees we find the nearest group code
            # even if there is a massive header with >40 paragraphs.
            table_contexts.append((table, list(context_lines)))

    # Fallback when body traversal did not map tables (rare malformed DOCX).
    if not table_contexts:
        table_contexts = [(table, list(lines)) for table in document.tables]

    grouped_results: dict[str, dict] = {}

    for table, table_lines in table_contexts:
        if len(table.rows) < 2 or len(table.columns) < 4:
            continue

        table_cell_lines = [_norm(cell.text) for row in table.rows for cell in row.cells if _norm(cell.text)]
        # We want to check the table cells first (they are the most specific to the table),
        # and then fallback to the paragraphs above the table.
        # Since `_parse_group_code` searches `reversed(lines)`, we put `table_cell_lines`
        # at the end of the list, so they are searched FIRST.
        metadata_lines = table_lines + table_cell_lines

        try:
            local_group_code = _parse_group_code(metadata_lines)
        except ValueError:
            # Fallback 1: try to find any group code in JUST the table lines (if table_cell_lines confused it)
            try:
                local_group_code = _parse_group_code(table_lines)
            except ValueError:
                # Fallback 2: try to find any group code in JUST the table cell lines
                try:
                    local_group_code = _parse_group_code(table_cell_lines)
                except ValueError:
                    local_group_code = global_group_code

        local_group_name = _parse_course_title(table_lines or lines, local_group_code)
        local_start_date, local_end_date = _parse_date_range(table_lines or lines)
        if not local_start_date and global_start_date:
            local_start_date = global_start_date
        if not local_end_date and global_end_date:
            local_end_date = global_end_date

        local_pair_windows = _parse_pair_windows(table_lines or lines) or global_pair_windows

        header_row_index = -1
        date_columns: dict[int, date] = {}
        year = (local_end_date or local_start_date or global_end_date or global_start_date or date.today()).year
        for row_index, row in enumerate(table.rows):
            current_date_columns: dict[int, date] = {}
            for column_index in range(0, len(row.cells)):
                header_text = _norm(row.cells[column_index].text)
                match = re.search(r"(\d{1,2})\.(\d{1,2})", header_text)
                if not match:
                    continue
                day, month = int(match.group(1)), int(match.group(2))
                current_date_columns[column_index] = date(year, month, day)
            if current_date_columns:
                header_row_index = row_index
                date_columns = current_date_columns
                break

        if not date_columns:
            continue

        table_entries: list[dict] = []
        table_total_group_hours = 0.0
        previous_teacher_name = ""
        for row in table.rows[header_row_index + 1 :]:
            cells = row.cells
            if len(cells) < 6:
                continue
            index_cell = _norm(cells[0].text)
            subject_name = _norm(cells[1].text)
            declared_subject_hours = _parse_hours(cells[2].text)
            teacher_name = _norm(cells[-1].text) or previous_teacher_name
            if teacher_name:
                previous_teacher_name = teacher_name

            if not subject_name:
                continue
            if "загальний обсяг" in subject_name.lower():
                current_total = _parse_hours(cells[2].text)
                if current_total > table_total_group_hours:
                    table_total_group_hours = current_total
                continue
            if not re.search(r"^\d+", index_cell):
                continue

            for column_index, lesson_date in date_columns.items():
                if column_index >= len(cells):
                    continue
                cell_value = _norm(cells[column_index].text)
                for pair_number, academic_hours in _parse_pairs_cell(cell_value):
                    pair_window = local_pair_windows.get(pair_number)
                    if pair_window:
                        starts_at = datetime.combine(lesson_date, pair_window[0], tzinfo=timezone.utc)
                        ends_at = datetime.combine(lesson_date, pair_window[1], tzinfo=timezone.utc)
                    else:
                        starts_at = datetime.combine(lesson_date, time(hour=9 + (pair_number - 1) * 2), tzinfo=timezone.utc)
                        ends_at = starts_at + timedelta(minutes=95)
                    table_entries.append(
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

        if not table_entries:
            continue

        if table_total_group_hours <= 0:
            table_total_group_hours = round(sum(item["academic_hours"] for item in table_entries), 2)

        bucket = grouped_results.get(local_group_code)
        if not bucket:
            grouped_results[local_group_code] = {
                "group_code": local_group_code,
                "group_name": local_group_name,
                "start_date": local_start_date.isoformat() if local_start_date else None,
                "end_date": local_end_date.isoformat() if local_end_date else None,
                "group_total_hours": table_total_group_hours,
                "entries": table_entries,
            }
        else:
            bucket["entries"].extend(table_entries)
            bucket["group_total_hours"] = round(float(bucket["group_total_hours"]) + table_total_group_hours, 2)
            if not bucket.get("start_date") and local_start_date:
                bucket["start_date"] = local_start_date.isoformat()
            if not bucket.get("end_date") and local_end_date:
                bucket["end_date"] = local_end_date.isoformat()
            if local_group_name and (
                not bucket.get("group_name") or bucket.get("group_name") == f"Група {local_group_code}"
            ):
                bucket["group_name"] = local_group_name

    if not grouped_results:
        raise ValueError("У таблицях не знайдено занять для імпорту")

    return list(grouped_results.values())


def _merge_duplicate_teachers(db: Session, branch_id: str, teacher_ids: list[int]) -> int:
    """Merge any duplicate Teacher records that share the same normalised last name.

    When two imports run in close succession (e.g. concurrent Vercel lambdas) or
    when the same surname appears in different cases (ALL-CAPS vs proper case),
    the lookup may fail and create a second record.  This function:
      1. Finds all teachers in *branch_id* whose normalised last_name collides
         with any teacher in *teacher_ids*.
      2. Keeps the record with the smallest id (the 'canonical' one).
      3. Reassigns all ScheduleSlot rows from duplicates to the canonical record.
      4. Deletes the duplicate Teacher rows.

    Returns the number of duplicate records removed.
    """
    if not teacher_ids:
        return 0

    # Fetch the teachers we just touched in this import
    touched = db.query(Teacher).filter(Teacher.id.in_(teacher_ids)).all()
    merged = 0
    seen_last: dict[str, Teacher] = {}  # normalised_last_name -> canonical teacher

    for t in sorted(touched, key=lambda x: x.id):
        key = (t.last_name or "").strip().lower()
        if key in seen_last:
            # This teacher is a duplicate of an already-seen canonical record
            canonical = seen_last[key]
            # Reassign all slots that belong to the duplicate
            db.query(ScheduleSlot).filter(ScheduleSlot.teacher_id == t.id).update(
                {"teacher_id": canonical.id}, synchronize_session=False
            )
            db.delete(t)
            merged += 1
        else:
            seen_last[key] = t

    # Also look for pre-existing duplicates across ALL teachers in the branch
    # that share a normalised last_name with any teacher we just created/used.
    for norm_last, canonical in list(seen_last.items()):
        others = (
            db.query(Teacher)
            .filter(
                Teacher.branch_id == branch_id,
                func.lower(Teacher.last_name) == norm_last,
                Teacher.id != canonical.id,
            )
            .all()
        )
        for dup in others:
            # Prefer the teacher with a longer / more complete first name
            dup_first = (dup.first_name or "").strip()
            can_first = (canonical.first_name or "").strip()
            if len(dup_first) > len(can_first) and "." not in dup_first:
                canonical.first_name = dup_first
                db.add(canonical)
            db.query(ScheduleSlot).filter(ScheduleSlot.teacher_id == dup.id).update(
                {"teacher_id": canonical.id}, synchronize_session=False
            )
            db.delete(dup)
            merged += 1

    if merged:
        db.flush()
    return merged


def import_schedule_docx(db: Session, file_path: str, branch_id: str, actor_user_id: int | None = None) -> dict:
    parsed_list = parse_schedule_docx(file_path)

    total_deleted = 0
    total_created = 0
    all_merged = 0
    
    # We will accumulate stats across all groups
    all_teacher_hours: dict[int, tuple[str, float]] = {}
    total_group_hours = 0.0
    group_codes = []
    group_names = []
    
    global_teacher_id_cache = {}
    global_subject_cache = {}

    for parsed in parsed_list:
        group_code = parsed["group_code"]
        group_name = parsed["group_name"]

        if group_code not in group_codes:
            group_codes.append(group_code)
        if group_name not in group_names:
            group_names.append(group_name)

        total_group_hours += parsed.get("group_total_hours", 0.0)

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


        teacher_cache: dict[str, Teacher] = {}  # keyed by normalised name string from the document
        teacher_id_cache: dict[int, Teacher] = {}  # keyed by DB teacher.id for deduplication
        subject_cache: dict[str, Subject] = {}
        candidates: list[dict] = []

        for entry in parsed["entries"]:
            teacher_full_name = _norm(entry["teacher_name"])
            if teacher_full_name not in teacher_cache:
                last_name, first_name = _split_teacher_name(teacher_full_name)
                # Case-insensitive lookup — Ukrainian DOCX files often store surnames
                # in ALL-CAPS while the DB may have them in proper case (or vice versa).
                existing_teachers = (
                    db.query(Teacher)
                    .filter(
                        Teacher.branch_id == branch_id,
                        func.lower(Teacher.last_name) == last_name.lower(),
                    )
                    .all()
                )
                teacher = None
                if existing_teachers:
                    for t in existing_teachers:
                        t_first = (t.first_name or "").strip()
                        new_first = (first_name or "").strip()
                        # Match when either side has no first name, or first letters agree
                        if not t_first or not new_first:
                            teacher = t
                            break
                        if t_first[0].lower() == new_first[0].lower():
                            teacher = t
                            break
                    if not teacher:
                        teacher = existing_teachers[0]

                    # If the incoming name is more complete (longer, no dots), upgrade the DB record
                    t_first = (teacher.first_name or "").strip()
                    new_first = (first_name or "").strip()
                    if new_first and len(new_first) > len(t_first) and "." not in new_first:
                        teacher.first_name = new_first
                        db.add(teacher)
                        db.flush()
                        # Invalidate any previous cache entry that pointed to this teacher
                        if teacher.id in teacher_id_cache:
                            teacher_id_cache[teacher.id] = teacher
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

                # Use the canonical teacher object (deduplicated by ID)
                if teacher.id in teacher_id_cache:
                    teacher = teacher_id_cache[teacher.id]
                else:
                    teacher_id_cache[teacher.id] = teacher

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

        if not candidates:
            continue

        min_start = min(item["starts_at"] for item in candidates)
        max_end = max(item["ends_at"] for item in candidates)

        # ──────────────────────────────────────────────────────────────────────────
        # Idempotent import: wipe THIS group's slots in the exact date window that
        # the document covers before inserting fresh ones.
        # Using actual entry dates (not the unreliable header) guarantees the wipe
        # always runs, even when the DOCX omits a date-range header line.
        # This prevents hours from doubling on every re-import of the same file.
        # ──────────────────────────────────────────────────────────────────────────
        deleted_count = (
            db.query(ScheduleSlot)
            .filter(
                ScheduleSlot.group_id == group.id,
                ScheduleSlot.starts_at >= min_start,
                ScheduleSlot.starts_at <= max_end,
            )
            .delete(synchronize_session=False)
        )
        db.flush()

        # Conflict detection: look for clashes with OTHER groups in the same window
        # (run AFTER the wipe so this group's old slots don't create false alarms)
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
            tid = candidate["teacher_id"]
            prev_name, prev_hours = all_teacher_hours.get(tid, (candidate["teacher_name"], 0.0))
            # Prefer the longer (more complete) display name
            display_name = candidate["teacher_name"] if len(candidate["teacher_name"]) > len(prev_name) else prev_name
            all_teacher_hours[tid] = (display_name, prev_hours + candidate["academic_hours"])

        # Merge any duplicate teacher records that may have been created by concurrent
        # imports or case-mismatch lookups (e.g. ALL-CAPS surname vs. proper case).
        all_teacher_ids = list(teacher_id_cache.keys())
        merged_count = _merge_duplicate_teachers(db, branch_id, all_teacher_ids)

        global_teacher_id_cache.update(teacher_id_cache)
        global_subject_cache.update(subject_cache)
        
        total_deleted += deleted_count
        total_created += len(candidates)
        all_merged += merged_count

    return {
        "import_kind": "schedule_docx",
        "group_code": group_codes[0] if group_codes else "",
        "group_name": group_names[0] if group_names else "",
        "group_total_hours": total_group_hours,
        "deleted_slots": total_deleted,
        "created_slots": total_created,
        "merged_duplicate_teachers": all_merged,
        "teachers": len(global_teacher_id_cache),
        "subjects": len(global_subject_cache),
        "teacher_workload_hours": {name: round(hours, 2) for (_tid, (name, hours)) in all_teacher_hours.items()},
    }
