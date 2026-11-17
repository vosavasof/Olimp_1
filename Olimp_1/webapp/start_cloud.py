"""Start/resume the same classroom in GitHub Codespaces; never commit its data."""
import os,secrets,subprocess,sys,time,urllib.request
from pathlib import Path
root=Path(__file__).resolve().parent
state=root/'.cloud-state';state.mkdir(mode=0o700,exist_ok=True)
keyfile=state/'teacher.key'
if not keyfile.exists():
 fd=os.open(keyfile,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:f.write(secrets.token_urlsafe(32))
key=keyfile.read_text().strip()
name=os.environ.get('CODESPACE_NAME');domain=os.environ.get('GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN','app.github.dev')
origin=f'https://{name}-8000.{domain}' if name else 'http://localhost:8000'
env={**os.environ,'OLIMP_TEACHER_KEY':key,'OLIMP_DB':str(state/'classroom.sqlite3'),'PORT':'8000','OLIMP_PUBLIC_ORIGIN':origin,'OLIMP_SECURE_COOKIE':'1' if name else '0'}
def running():
 try:
  with urllib.request.urlopen('http://127.0.0.1:8000/',timeout=2) as response:return response.status==200
 except Exception:return False
if not running():
 with open(state/'server.log','ab') as log:
  subprocess.Popen([sys.executable,str(root/'server.py')],env=env,stdout=log,stderr=log,start_new_session=True)
 for _ in range(40):
  if running():break
  time.sleep(.25)
 if not running():raise SystemExit('Сервер не запустился. Проверьте Olimp_1/webapp/.cloud-state/server.log')
print('\nЛаборатория запущена. Личная ссылка УЧИТЕЛЯ (не передавать ученикам):\n'+origin+'/teacher#'+key)
print('\nДля учеников: Ports → 8000 → Port Visibility → Public. Затем создайте учеников в кабинете и передайте их личные ссылки.')
print('Продолжайте работать в этом же Codespace: здесь хранятся ученики и результаты. Не удаляйте его без резервной копии базы.')
