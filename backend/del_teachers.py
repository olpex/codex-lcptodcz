import sys
sys.path.append('.')
from app.models import Teacher
from app.db.session import SessionLocal

db = SessionLocal()
teachers = db.query(Teacher).filter(Teacher.last_name.in_(['Сидоренко', 'Коваль'])).all()
for t in teachers:
    print('Deleting', t.first_name, t.last_name)
    db.delete(t)
db.commit()
print('Done.')

