"""Local classroom application. Python 3.10+, standard library only."""
import os,json,sqlite3,secrets,hashlib,time,sys
from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from urllib.parse import urlsplit,parse_qs
ROOT=Path(__file__).resolve().parent.parent
DB=Path(os.environ.get('OLIMP_DB',str(ROOT/'webapp'/'classroom.sqlite3')))
ADMIN=os.environ.get('OLIMP_TEACHER_KEY') or secrets.token_urlsafe(32)
SESSIONS={}
def digest(s):return hashlib.sha256(s.encode()).hexdigest()
def connection():
 c=sqlite3.connect(DB);c.row_factory=sqlite3.Row;return c
def init():
 with connection() as c:
  c.executescript('''CREATE TABLE IF NOT EXISTS students(id INTEGER PRIMARY KEY,name TEXT NOT NULL,token TEXT UNIQUE NOT NULL,variant INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS lessons(student INTEGER,lesson INTEGER,PRIMARY KEY(student,lesson));
CREATE TABLE IF NOT EXISTS theory(student INTEGER,topic INTEGER,text TEXT,PRIMARY KEY(student,topic));
CREATE TABLE IF NOT EXISTS materials(lesson INTEGER PRIMARY KEY,text TEXT NOT NULL,updated INTEGER);
CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY,student INTEGER,lesson INTEGER,answer TEXT,correct INTEGER,created INTEGER);''')
class Handler(BaseHTTPRequestHandler):
 def log_message(self,format,*args):pass # Do not log personal URLs or cookie values.
 def send(self,status,value,typ='application/json; charset=utf-8',cookie=None):
  b=value if isinstance(value,bytes) else (json.dumps(value,ensure_ascii=False).encode() if typ.startswith('application/json') else value.encode())
  self.send_response(status);self.send_header('Content-Type',typ);self.send_header('Content-Length',str(len(b)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer');self.send_header('X-Frame-Options','SAMEORIGIN')
  if cookie:self.send_header('Set-Cookie',cookie+('; Secure' if os.environ.get('OLIMP_SECURE_COOKIE')=='1' else ''))
  self.end_headers();self.wfile.write(b)
 def identity(self):
  cookies=dict(x.strip().split('=',1) for x in self.headers.get('Cookie','').split(';') if '=' in x)
  role=self.headers.get('X-Olimp-Role') or parse_qs(urlsplit(self.path).query).get('role',[None])[0]
  if role not in ('teacher','student'):role='student' if urlsplit(self.path).path=='/student' else 'teacher'
  session=SESSIONS.get(cookies.get('olimp_'+role,''))
  if not session:
   legacy=SESSIONS.get(cookies.get('olimp',''))
   if legacy and legacy.get('role')==role:session=legacy
  if not session or session['expires']<time.time():return None
  if session['role']=='student':
   with connection() as c:
    row=c.execute('SELECT active,token FROM students WHERE id=?',(session['id'],)).fetchone()
   if not row or not row['active'] or row['token']!=session['token']:return None
  return session
 def do_GET(self):
  try:self.get()
  except Exception:self.send(500,{'error':'Ошибка сервера. Проверьте доступ к базе данных.'})
 def get(self):
  path=urlsplit(self.path).path;s=self.identity()
  if path=='/assets/style.css':return self.send(200,(ROOT/'style.css').read_bytes(),'text/css; charset=utf-8')
  if path in ('/','/teacher','/student'):return self.send(200,(ROOT/'webapp/portal.html').read_bytes(),'text/html; charset=utf-8')
  if not s:return self.send(401,{'error':'Откройте персональную ссылку или войдите как учитель.'})
  with connection() as c:
   if path=='/api/materials':
    defaults=json.loads((ROOT/'webapp/materials.json').read_text())
    edits={r['lesson']:dict(r) for r in c.execute('SELECT lesson,text,updated FROM materials')}
    for row in defaults:
     row['custom']=row['lesson'] in edits
     if row['custom']:row['text']=edits[row['lesson']]['text']
    return self.send(200,defaults)
   if path=='/api/journal' and s['role']=='teacher':
    return self.send(200,[dict(r) for r in c.execute('SELECT a.id,a.student,s.name,a.lesson,a.answer,a.correct,a.created FROM attempts a JOIN students s ON s.id=a.student ORDER BY a.id DESC')])
   if path=='/api/me':
    result={'role':s['role']}
    if s['role']=='student':
     row=c.execute('SELECT id,name,variant FROM students WHERE id=?',(s['id'],)).fetchone();result.update(dict(row));result['lessons']=[r[0] for r in c.execute('SELECT lesson FROM lessons WHERE student=? ORDER BY lesson',(s['id'],))];result['theory']=[dict(r) for r in c.execute('SELECT topic,text FROM theory WHERE student=?',(s['id'],))]
    return self.send(200,result)
   if path=='/api/students' and s['role']=='teacher':return self.send(200,[dict(r) for r in c.execute('SELECT id,name,variant,active FROM students')])
   if path.startswith('/api/student/') and s['role']=='teacher':
    sid=int(path.rsplit('/',1)[1]);return self.send(200,{'lessons':[r[0] for r in c.execute('SELECT lesson FROM lessons WHERE student=?',(sid,))],'theory':[dict(r) for r in c.execute('SELECT topic,text FROM theory WHERE student=?',(sid,))],'attempts':[dict(r) for r in c.execute('SELECT lesson,answer,correct,created FROM attempts WHERE student=? ORDER BY id',(sid,))]})
   if path=='/api/attempts' and s['role']=='student':return self.send(200,[dict(r) for r in c.execute('SELECT lesson,answer,correct,created FROM attempts WHERE student=? ORDER BY id',(s['id'],))])
  if path.startswith('/course/'):
   name=path[len('/course/'):]
   if '/' in name or name not in {p.name for p in ROOT.iterdir() if p.suffix in ('.js','.css','.html')}:return self.send(404,{'error':'Не найдено'})
   content=(ROOT/name).read_text();typ='text/javascript; charset=utf-8' if name.endswith('.js') else 'text/css; charset=utf-8' if name.endswith('.css') else 'text/html; charset=utf-8'
   if name=='index.html':content=content.replace('<html lang="ru">','<html lang="ru" class="course-loading">').replace('</body>','<script src="/course/bridge.js"></script></body>')
   if name=='index.html':content=content.replace('<body>',"<body><script>window.addEventListener('error',function(e){document.documentElement.classList.remove('course-loading');var p=document.createElement('p');p.setAttribute('role','alert');p.style.cssText='padding:20px;background:#fff0dc;color:#743f20;position:relative;z-index:10';p.textContent='Лаборатория не смогла загрузиться: '+(e.message||'не загружен файл приложения')+'. Обновите страницу; если ошибка повторится, сообщите учителю.';document.body.prepend(p)},true);setTimeout(function(){if(document.documentElement.classList.contains('course-loading')){document.documentElement.classList.remove('course-loading');var p=document.createElement('p');p.textContent='Загрузка кабинета задерживается. Проверьте соединение и обновите страницу.';document.body.prepend(p)}},15000);</script>")
   return self.send(200,content,typ)
  self.send(404,{'error':'Не найдено'})
 def do_POST(self):
  try:self.post()
  except (ValueError,KeyError,TypeError):self.send(400,{'error':'Проверьте введённые данные.'})
  except Exception:self.send(500,{'error':'Не удалось сохранить изменения.'})
 def post(self):
  if self.headers.get('Content-Type','').split(';')[0]!='application/json':return self.send(415,{'error':'Требуется JSON'})
  origin=self.headers.get('Origin')
  if origin and origin!=os.environ.get('OLIMP_PUBLIC_ORIGIN') and urlsplit(origin).netloc!=self.headers.get('Host'):return self.send(403,{'error':'Недопустимый источник запроса'})
  n=int(self.headers.get('Content-Length','0'))
  if n>200000:return self.send(413,{'error':'Слишком большой запрос'})
  body=json.loads(self.rfile.read(n));path=urlsplit(self.path).path
  if path=='/api/login':
   key=str(body.get('key',''));session=None
   if secrets.compare_digest(key,ADMIN):session={'role':'teacher'}
   else:
    with connection() as c:row=c.execute('SELECT id,token FROM students WHERE token=? AND active=1',(digest(key),)).fetchone()
    if row:session={'role':'student','id':row['id'],'token':row['token']}
   if not session:return self.send(401,{'error':'Ссылка недействительна или отозвана.'})
   token=secrets.token_urlsafe(32);session['expires']=time.time()+8*3600;SESSIONS[token]=session
   return self.send(200,{'ok':True,'role':session['role']},cookie='olimp_'+session['role']+'='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800')
  s=self.identity()
  if not s:return self.send(401,{'error':'Войдите снова.'})
  if path=='/api/logout':
   for key,session in list(SESSIONS.items()):
    if session is s:SESSIONS.pop(key,None)
   return self.send(200,{'ok':True},cookie='olimp_'+s['role']+'=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
  with connection() as c:
   if s['role']=='teacher':
    if path=='/api/material':
     lesson=int(body['lesson'])
     if lesson not in range(50):raise ValueError()
     if body.get('reset'):c.execute('DELETE FROM materials WHERE lesson=?',(lesson,))
     else:
      text=str(body['text'])
      if not text.strip() or len(text)>30000:raise ValueError()
      c.execute('INSERT OR REPLACE INTO materials VALUES(?,?,?)',(lesson,text,int(time.time())))
     return self.send(200,{'ok':True})

    if path=='/api/students':
     name=str(body['name']).strip();variant=int(body.get('variant',0))
     if not name or len(name)>100 or variant not in (0,1):raise ValueError()
     key=secrets.token_urlsafe(32);cur=c.execute('INSERT INTO students(name,token,variant) VALUES(?,?,?)',(name,digest(key),variant));return self.send(200,{'id':cur.lastrowid,'link':'/student#'+key})
    if path=='/api/assign':
     sid=int(body['student']);lessons=body['lessons'];variant=int(body['variant'])
     if variant not in (0,1) or not all(type(i)==int and 0<=i<50 for i in lessons):raise ValueError()
     c.execute('DELETE FROM lessons WHERE student=?',(sid,));c.executemany('INSERT OR IGNORE INTO lessons VALUES(?,?)',[(sid,i) for i in lessons]);c.execute('UPDATE students SET variant=? WHERE id=?',(variant,sid))
     for entry in body.get('theory',[]):
      topic=int(entry['topic']);text=str(entry['text'])
      if topic not in range(5) or len(text)>20000:raise ValueError()
      c.execute('INSERT OR REPLACE INTO theory VALUES(?,?,?)',(sid,topic,text))
     return self.send(200,{'ok':True})
    if path=='/api/rotate':
     key=secrets.token_urlsafe(32);c.execute('UPDATE students SET token=?,active=1 WHERE id=?',(digest(key),int(body['student'])));return self.send(200,{'link':'/student#'+key})
    if path=='/api/revoke':c.execute('UPDATE students SET active=0 WHERE id=?',(int(body['student']),));return self.send(200,{'ok':True})
   if path=='/api/attempt' and s['role']=='student':
    lesson=int(body['lesson'])
    if not c.execute('SELECT 1 FROM lessons WHERE student=? AND lesson=?',(s['id'],lesson)).fetchone():return self.send(403,{'error':'Учитель не открыл это задание.'})
    c.execute('INSERT INTO attempts(student,lesson,answer,correct,created) VALUES(?,?,?,?,?)',(s['id'],lesson,json.dumps(body['answer'],ensure_ascii=False),int(body.get('correct') is True),int(time.time())))
    return self.send(200,{'ok':True})
  self.send(403,{'error':'Недостаточно прав'})
if __name__=='__main__':
 init();port=int(os.environ.get('PORT','8000'));print('Кабинет учителя: http://localhost:'+str(port)+'/teacher#'+ADMIN,flush=True)
 ThreadingHTTPServer((os.environ.get('HOST','0.0.0.0'),port),Handler).serve_forever()
