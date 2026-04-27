import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), 'suptc_local.db')
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

cursor.execute("SELECT id, subject, message_id, status, snippet FROM mail_messages ORDER BY received_at DESC LIMIT 10")
for row in cursor.fetchall():
    print(row)

cursor.execute("SELECT id, message, status, result_payload FROM import_jobs ORDER BY started_at DESC LIMIT 5")
print("\nRecent Import Jobs:")
for row in cursor.fetchall():
    print(row)

conn.close()
