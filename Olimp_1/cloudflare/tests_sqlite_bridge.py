"""Local test adapter for D1 prepared statements, using SQLite without third-party libraries."""
import json,sqlite3,sys
body=json.load(sys.stdin);con=sqlite3.connect(body['database']);con.row_factory=sqlite3.Row
try:
 if 'schema' in body:con.executescript(body['schema']);con.commit();print('{}');raise SystemExit()
 out=[]
 if body.get('atomic'):con.execute('BEGIN IMMEDIATE')
 for item in body['queries']:
  cur=con.execute(item['sql'],item.get('args',[]));result=[dict(r) for r in cur.fetchall()] if cur.description else []
  out.append({'results':result,'success':True,'meta':{'changes':max(0,cur.rowcount),'last_row_id':cur.lastrowid}})
 con.commit();print(json.dumps(out))
except Exception as e:
 con.rollback();print(json.dumps({'error':str(e)}));sys.exit(1)
finally:con.close()
