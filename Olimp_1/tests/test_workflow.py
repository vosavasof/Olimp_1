import os,importlib.util,tempfile,json,io
from pathlib import Path
with tempfile.TemporaryDirectory() as tmp:
 os.environ['OLIMP_DB']=str(Path(tmp)/'test.sqlite3');os.environ['OLIMP_TEACHER_KEY']='test-teacher-key'
 spec=importlib.util.spec_from_file_location('classserver',str(Path(__file__).resolve().parent.parent/'webapp/server.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.init()
 def request(path,body=None,cookie='',role=None):
  h=m.Handler.__new__(m.Handler);h.path=path;raw=json.dumps(body).encode();h.headers={'Content-Type':'application/json','Content-Length':str(len(raw)),'Cookie':cookie,'Host':'school:8000','X-Olimp-Role':role or ('student' if 'olimp_student=' in cookie else 'teacher')};h.rfile=io.BytesIO(raw)
  h.send=lambda status,value,typ='application/json',cookie=None:setattr(h,'result',(status,value,cookie))
  h.post() if body is not None else h.get()
  return h.result
 admin=request('/api/login',{'key':'test-teacher-key'})[2].split(';')[0]

 created=request('/api/students',{'name':'Pupil','variant':0},admin)[1];sid=created['id'];key=created['link'].split('#')[1]
 pupil=request('/api/login',{'key':key})[2].split(';')[0]
 request('/api/assign',{'student':sid,'variant':0,'lessons':[0,1,2,35],'theory':[]},admin)
 def attempt(lesson,correct):return request('/api/attempt',{'lesson':lesson,'answer':{'choice':'x'},'correct':correct},pupil)
 assert attempt(0,False)[1]['score']==0
 assert attempt(0,True)[1]['score']==0.5
 assert attempt(0,True)[0]==409
 assert attempt(1,True)[1]['score']==1
 assert attempt(1,False)[0]==409
 assert attempt(2,False)[0]==200 and attempt(2,False)[0]==200
 assert attempt(2,True)[0]==409
 request('/api/self-profile',{'display_name':'Learner','about':'Algorithms','learning_goal':'Olympiad','variant':1,'note':'not allowed'},pupil)
 me=request('/api/me',cookie=pupil)[1];assert me['display_name']=='Learner' and me['variant']==0 and 'note' not in me
 assert request('/api/self-profile',{'about':'x'},admin)[0]==403
 body={'lesson':35,'answer':{'python':'print(1)','explanation':'First draft'},'correct':True}
 first=request('/api/attempt',body,pupil);assert first[1]['review_status']=='pending';aid=first[1]['id']
 assert request('/api/attempt',body,pupil)[0]==409
 assert request('/api/review',{'attempt':aid,'action':'return','comment':''},admin)[0]==400
 assert request('/api/review',{'attempt':aid,'action':'return','comment':'Check equal values'},admin)[0]==200
 notices=request('/api/notifications',cookie=pupil)[1];assert len(notices)==1 and notices[0]['seen']==0 and notices[0]['lesson']==35
 assert request('/api/review',{'attempt':aid,'action':'return','comment':'Again'},admin)[0]==409
 assert request('/api/review',{'attempt':aid,'score':3},admin)[0]==409
 request('/api/notification-read',{'id':notices[0]['id']},pupil)
 assert request('/api/notifications',cookie=pupil)[1][0]['seen']==1
 body['answer']['python']='print(2)';second=request('/api/attempt',body,pupil);assert second[0]==200 and second[1]['id']!=aid
 assert request('/api/review',{'attempt':second[1]['id'],'score':4,'comment':'Good'},admin)[0]==200
 assert len(request('/api/notifications',cookie=pupil)[1])==2
 assert request('/api/attempt',body,pupil)[0]==409
 m.init();assert attempt(0,True)[0]==409
 assert request('/api/student/'+str(sid),cookie=admin)[1]['profile']['about']=='Algorithms'
 print('PASS: 2 attempts persisted, 1/0.5/0 scoring, early success lock, manual return/resubmit/grade, notification/read, pupil profile permission')

 # Course assets must carry the pupil role when no teacher session exists.
 page=request('/course/index.html?role=student',cookie=pupil)[1]
 import re
 urls=re.findall(r'(?:src|href)="([^"]+\.(?:js|css)[^"]*)"',page)
 assert urls and all('role=student' in url for url in urls)
 second=request('/api/students',{'name':'Second','variant':1},admin)[1]['id']
 group=request('/api/cohort',{'name':'9A','kind':'class','members':[sid,second]},admin)[1]['id']
 request('/api/cohort',{'name':'Olympiad','kind':'group','members':[sid]},admin)
 assert len(request('/api/cohorts',cookie=admin)[1])==2
 assert request('/api/cohorts',cookie=pupil)[0]==404
 assert request('/api/bulk-assign',{'students':[sid,second],'lessons':[3,4]},admin)[0]==200
 assert 35 in request('/api/me',cookie=pupil)[1]['lessons']
 assert request('/api/bulk-assign',{'students':[sid,99999],'lessons':[5],'mode':'replace'},admin)[0]==400
 assert 35 in request('/api/me',cookie=pupil)[1]['lessons']
 print('PASS: student-only assets, classes/groups and atomic assignment validation')

 manifest=request('/manifest.webmanifest')[1]
 assert json.loads(manifest)['display']=='standalone'
 assert request('/assets/phone.css')[0]==200
 for size in (192,512):assert request('/assets/app-icon-'+str(size)+'.png')[1].startswith(b'\x89PNG')
 def launch(cookie=''):
  h=m.Handler.__new__(m.Handler);h.path='/app';h.headers={'Cookie':cookie,'Host':'school:8000'};out={}
  h.send_response=lambda status:out.update(status=status);h.send_header=lambda k,v:out.update({k:v});h.end_headers=lambda:None
  h.get();return out
 assert launch()['Location']=='/student'
 assert launch(pupil)['Location']=='/student'
 assert launch(admin)['Location']=='/teacher'
 print('PASS: home-screen manifest, icon assets, role-aware app launch')
