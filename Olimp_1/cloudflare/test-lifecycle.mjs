import fs from 'node:fs';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import worker from './worker.mjs';
import {SqliteD1} from './sqlite-d1.mjs';

const filename=path.join(os.tmpdir(),'olimp-lifecycle-'+process.pid+'.sqlite3');
const db=new SqliteD1(filename);
db.connection.exec(fs.readFileSync(new URL('./migrations/0001_initial.sql',import.meta.url),'utf8'));
const env={DB:db,TEACHER_KEY:'test-archive-key',ASSETS:{fetch:async()=>new Response('test')}};
async function request(path,body,cookie='',role='teacher') {
  const response=await worker.fetch(new Request('https://school.example/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Olimp-Role':role,Cookie:cookie},body:body?JSON.stringify(body):undefined}),env);
  return {status:response.status,value:await response.json(),cookie:response.headers.get('Set-Cookie')?.split(';')[0]};
}
try {
  const teacher=(await request('login',{key:'test-archive-key'})).cookie;
  const pupil=(await request('students',{name:'Archive test',variant:0},teacher)).value;
  const other=(await request('students',{name:'Other test',variant:1},teacher)).value;
  let child=(await request('login',{key:pupil.link.split('#')[1]})).cookie;
  const group=(await request('cohort',{name:'Test group',kind:'group',members:[pupil.id,other.id]},teacher)).value.id;
  assert.equal((await request('access',{students:[pupil.id,other.id],changes:[{lesson:0,open:true},{lesson:1,open:true}],cohort:group},teacher)).status,200);
  assert.equal((await request('attempt',{lesson:0,answer:{choice:1},correct:true},child,'student')).status,200);
  assert.equal((await request('lifecycle',{entity:'student',id:other.id,action:'archive'},child,'student')).status,403);
  assert.equal((await request('lifecycle',{entity:'student',id:pupil.id,action:'archive'},teacher)).status,200);
  assert.equal((await request('me',undefined,child,'student')).status,401);
  assert.equal((await request('login',{key:pupil.link.split('#')[1]})).status,401);
  let roster=(await request('students',undefined,teacher)).value;
  assert.equal(roster.find(p=>p.id===pupil.id).lifecycle,'archived');
  assert.deepEqual(roster.find(p=>p.id===pupil.id).lessons,[0,1]);
  assert.equal((await request('journal',undefined,teacher)).value.length,0,'archived pupils must be absent from journal');assert.equal((await request('journal-delta?after=0&reviewed_after=0',undefined,teacher)).value.rows.length,0);assert.equal((await request('student/'+pupil.id,undefined,teacher)).value.attempts[0].score,1,'archived records remain in pupil profile');
  assert.equal((await request('access',{students:[other.id,pupil.id],changes:[{lesson:2,open:true}]},teacher)).status,400);
  assert(!((await request('students',undefined,teacher)).value.find(p=>p.id===other.id).lessons.includes(2)),'invalid recipients must not partly change access');
  await request('lifecycle',{entity:'student',id:pupil.id,action:'remove'},teacher);
  assert.equal((await request('students',undefined,teacher)).value.find(p=>p.id===pupil.id).lifecycle,'removed');assert.equal((await request('journal',undefined,teacher)).value.length,0,'removed pupils must be absent from journal');
  await request('lifecycle',{entity:'student',id:pupil.id,action:'restore'},teacher);
  assert.equal((await request('me',undefined,child,'student')).status,401,'old session must remain revoked after restore');
  child=(await request('login',{key:pupil.link.split('#')[1]})).cookie;
  assert(child,'restored original personal link must work');
  assert.deepEqual((await request('me',undefined,child,'student')).value.lessons,[0,1]);
  await request('access',{students:[pupil.id],changes:[{lesson:0,open:false}]},teacher);
  assert.equal((await request('attempt',{lesson:0,answer:{},correct:true},child,'student')).status,403);
  assert.equal((await request('journal',undefined,teacher)).value.length,1,'closing access must preserve all answers');
  await request('revoke',{student:other.id},teacher);
  await request('lifecycle',{entity:'student',id:other.id,action:'archive'},teacher);
  await request('lifecycle',{entity:'student',id:other.id,action:'restore'},teacher);
  assert.equal((await request('students',undefined,teacher)).value.find(p=>p.id===other.id).active,0,'restore must not undo a prior manual revocation');
  for(const action of ['archive','remove','restore'])assert.equal((await request('lifecycle',{entity:'cohort',id:group,action},teacher)).status,200);
  const restored=(await request('cohorts',undefined,teacher)).value.find(g=>g.id===group);
  assert.equal(restored.lifecycle,'active');assert.deepEqual(restored.members,[pupil.id,other.id]);
  assert.deepEqual((await request('me',undefined,child,'student')).value.lessons,[1]);
  const revision=(await request('updates',undefined,teacher)).value.revision;
  await request('lifecycle',{entity:'cohort',id:group,action:'archive'},teacher);
  assert((await request('updates',undefined,teacher)).value.revision>revision,'archive must invalidate cached rosters');
  assert.equal((await request('lifecycle',{entity:'student',id:99999,action:'remove'},teacher)).status,404);
  console.log('PASS: archives, reversible removal, original links, session revocation, preserved journals/memberships, immediate individual/group access and cache invalidation');
} finally {db.close();fs.rmSync(filename,{force:true});}
