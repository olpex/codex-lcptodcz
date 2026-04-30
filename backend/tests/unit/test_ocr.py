from app.services.ocr import guess_draft_from_text


def test_guess_order_draft_from_text():
    draft_type, payload = guess_draft_from_text("Наказ № 15/2026 про зарахування")
    assert draft_type == "order"
    assert payload["order_number"] == "15/2026"
    assert payload["status"] == "draft"


def test_guess_trainee_card_draft_from_text():
    draft_type, payload = guess_draft_from_text("Іван Петренко\nЗаява на навчання")
    assert draft_type == "trainee_card"
    assert payload["first_name"] == "Іван"
    assert payload["last_name"] == "Петренко"


def test_guess_schedule_draft_from_text():
    draft_type, payload = guess_draft_from_text("Розклад занять групи 46-26")
    assert draft_type == "schedule"
    assert payload["group_code"] == "46-26"
    assert payload["entries"] == []
