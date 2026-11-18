"""Export the existing classroom to a private D1 import SQL file without changing it."""
import argparse,hashlib,json,os,sqlite3
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('database');p.add_argument('output');p.add_argument('--teacher-key-file');a=p.parse_args()
source=Path(a.database).resolve();dest=Path(a.output).resolve()
if source==dest:raise SystemExit('Output must differ from the database.')
con=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True);con.row_factory=sqlite3.Row;con.execute('BEGIN')
names=['students','lessons','theory','materials','cohorts','cohort_members','attempts','notifications'];existing={r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")};sql=[];counts={}
for name in names:
 if name not in existing:continue
 columns=[r[1] for r in con.execute('PRAGMA table_info('+name+')')];data=con.execute('SELECT * FROM '+name).fetchall();counts[name]=len(data)
 for row in data:
  # Keep every statement on one line for the dashboard's single-line console.
  values=[con.execute('SELECT quote(?)',(row[c],)).fetchone()[0].replace('\r',"'||char(13)||'").replace('\n',"'||char(10)||'") for c in columns]
  sql.append('INSERT INTO "'+name+'"('+','.join('"'+c+'"' for c in columns)+') VALUES('+','.join(values)+');')
if a.teacher_key_file:
 secret=Path(a.teacher_key_file).read_text().strip();digest=hashlib.sha256(secret.encode()).hexdigest();sql.append("UPDATE app_meta SET teacher_hash='"+digest+"' WHERE id=1;")
# A private file: contains pupil access links. It must never be committed to Git.
fd=os.open(dest,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
with os.fdopen(fd,'w') as f:f.write('-- Import once, into an empty classroom after applying migrations.\n'+'\n'.join(sql)+'\n')
print(json.dumps({'counts':counts,'output':str(dest),'teacher_key_preserved':bool(a.teacher_key_file)},ensure_ascii=False))
