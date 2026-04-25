from app.services import mail_ingest


def test_extract_contract_group_code_accepts_number_before_keyword_in_xls(monkeypatch):
    monkeypatch.setattr(mail_ingest.settings, "imap_contract_attachment_prefix", "Договори")
    filename = "184-25 Договори  Цифровий світ для початківців.xls"
    assert mail_ingest.extract_contract_group_code(filename) == "184-25"


def test_extract_contract_group_code_accepts_dash_variants(monkeypatch):
    monkeypatch.setattr(mail_ingest.settings, "imap_contract_attachment_prefix", "Договори")
    filename = "184‑25 Договори Цифровий світ для початківців.xls"
    assert mail_ingest.extract_contract_group_code(filename) == "184-25"


def test_extract_contract_group_code_works_if_prefix_setting_differs(monkeypatch):
    monkeypatch.setattr(mail_ingest.settings, "imap_contract_attachment_prefix", "Реєстр слухачів")
    filename = "184-25 Договори Цифровий світ для початківців.xls"
    assert mail_ingest.extract_contract_group_code(filename) == "184-25"
