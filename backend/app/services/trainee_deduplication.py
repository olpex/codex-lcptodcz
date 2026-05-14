import re
from collections import defaultdict
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.core.crypto import cipher
from app.models import GroupMembership, Performance, Trainee


PLAIN_FIELDS = (
    "source_row_number",
    "birth_date",
    "contract_number",
    "certificate_number",
    "certificate_issue_date",
    "postal_index",
    "passport_issued_date",
    "group_code",
    "status",
)
ENCRYPTED_FIELDS = (
    "employment_center_encrypted",
    "address_encrypted",
    "passport_series_encrypted",
    "passport_number_encrypted",
    "passport_issued_by_encrypted",
    "tax_id_encrypted",
    "phone_encrypted",
    "email_encrypted",
    "id_document_encrypted",
)


def _norm(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def _norm_key(value: Any) -> str:
    return re.sub(r"[^0-9a-zа-яіїєґ]", "", _norm(value).casefold())


def _date_key(value: Any) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if hasattr(value, "isoformat") and not isinstance(value, str):
        return value.isoformat()
    return _norm(value).casefold()


def _decrypt(value: str | None) -> str:
    return _norm(cipher.decrypt(value))


def _field_has_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


def _encrypted_has_value(value: str | None) -> bool:
    return bool(_decrypt(value))


def trainee_completeness_score(trainee: Trainee) -> int:
    score = 0
    for field in PLAIN_FIELDS:
        if _field_has_value(getattr(trainee, field)):
            score += 1
    for field in ENCRYPTED_FIELDS:
        if _encrypted_has_value(getattr(trainee, field)):
            score += 1
    if _field_has_value(trainee.first_name):
        score += 1
    if _field_has_value(trainee.last_name):
        score += 1
    return score


def _identity_keys(trainee: Trainee) -> list[tuple[str, str, str, str]]:
    group = _norm_key(trainee.group_code)
    last_name = _norm_key(trainee.last_name)
    first_name = _norm(trainee.first_name).casefold()
    first_token = _norm_key(first_name.split(" ")[0] if first_name else "")
    birth = _date_key(trainee.birth_date)
    tax_id = _norm_key(_decrypt(trainee.tax_id_encrypted))

    keys: list[tuple[str, str, str, str]] = []
    if group and tax_id:
        keys.append(("tax", group, tax_id, ""))
    if group and last_name and first_token and birth:
        keys.append(("name_birth", group, last_name, f"{first_token}:{birth}"))
    return keys


def _copy_missing_values(keeper: Trainee, duplicate: Trainee) -> bool:
    changed = False
    for field in PLAIN_FIELDS:
        if not _field_has_value(getattr(keeper, field)) and _field_has_value(getattr(duplicate, field)):
            setattr(keeper, field, getattr(duplicate, field))
            changed = True
    for field in ENCRYPTED_FIELDS:
        if not _encrypted_has_value(getattr(keeper, field)) and _encrypted_has_value(getattr(duplicate, field)):
            setattr(keeper, field, getattr(duplicate, field))
            changed = True
    return changed


def _transfer_memberships(db: Session, keeper: Trainee, duplicate: Trainee) -> None:
    keeper_group_ids = {
        group_id
        for (group_id,) in db.query(GroupMembership.group_id)
        .filter(GroupMembership.trainee_id == keeper.id)
        .all()
    }
    duplicate_memberships = (
        db.query(GroupMembership)
        .filter(GroupMembership.trainee_id == duplicate.id)
        .all()
    )
    for membership in duplicate_memberships:
        if membership.group_id in keeper_group_ids:
            db.delete(membership)
            continue
        membership.trainee_id = keeper.id
        db.add(membership)
        keeper_group_ids.add(membership.group_id)


def _transfer_performance(db: Session, keeper: Trainee, duplicate: Trainee) -> None:
    keeper_group_ids = {
        group_id
        for (group_id,) in db.query(Performance.group_id)
        .filter(Performance.trainee_id == keeper.id)
        .all()
    }
    duplicate_rows = db.query(Performance).filter(Performance.trainee_id == duplicate.id).all()
    for row in duplicate_rows:
        if row.group_id in keeper_group_ids:
            db.delete(row)
            continue
        row.trainee_id = keeper.id
        db.add(row)
        keeper_group_ids.add(row.group_id)


def _merge_duplicate_group(db: Session, rows: list[Trainee]) -> tuple[int, int]:
    ordered = sorted(
        rows,
        key=lambda item: (
            trainee_completeness_score(item),
            0 if item.is_deleted else 1,
            item.updated_at or item.created_at,
            item.id,
        ),
        reverse=True,
    )
    keeper = ordered[0]
    removed = 0
    merged = 0
    for duplicate in ordered[1:]:
        if _copy_missing_values(keeper, duplicate):
            merged += 1
        _transfer_memberships(db, keeper, duplicate)
        _transfer_performance(db, keeper, duplicate)
        db.delete(duplicate)
        removed += 1
    db.add(keeper)
    return removed, merged


def deduplicate_trainees(db: Session, branch_id: str, *, commit: bool = False) -> dict[str, Any]:
    rows = (
        db.query(Trainee)
        .filter(Trainee.branch_id == branch_id, Trainee.is_deleted.is_(False))
        .order_by(Trainee.id.asc())
        .all()
    )
    buckets: dict[tuple[str, str, str, str], list[Trainee]] = defaultdict(list)
    row_by_id = {row.id: row for row in rows}
    assigned_ids: set[int] = set()

    for row in rows:
        keys = _identity_keys(row)
        if not keys:
            continue
        buckets[keys[0]].append(row)

    removed_count = 0
    merged_count = 0
    duplicate_groups = 0
    for bucket_rows in buckets.values():
        live_rows = [row_by_id[row.id] for row in bucket_rows if row.id in row_by_id and row.id not in assigned_ids]
        if len(live_rows) < 2:
            continue
        duplicate_groups += 1
        for row in live_rows:
            assigned_ids.add(row.id)
        removed, merged = _merge_duplicate_group(db, live_rows)
        removed_count += removed
        merged_count += merged

    if commit:
        db.commit()
    else:
        db.flush()

    return {
        "duplicate_groups": duplicate_groups,
        "removed_count": removed_count,
        "merged_count": merged_count,
    }
