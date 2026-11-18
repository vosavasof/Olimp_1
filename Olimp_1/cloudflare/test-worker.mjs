import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
const here=path.dirname(fileURLToPath(import.meta.url));
export class TestD1{constructor(database){this.database=database;this.queries=0}query(queries,atomic=false){this.queries+=queries.length;let out;try{out=JSON.parse(execFileSync('python3',[path.join(here,'tests_sqlite_bridge.py')],{input:JSON.stringify({database:this.database,queries,atomic}),encoding:'utf8'}))}catch(e){throw Error(e.stdout?.toString()||e.message)}return out}prepare(sql){let db=this;return {sql,args:[],bind(...args){return {...this,args}},async all(){return db.query([{sql:this.sql,args:this.args}])[0]},async first(){return (await this.all()).results[0]??null},async run(){return this.all()}}}async batch(statements){return this.query(statements.map(s=>({sql:s.sql,args:s.args})),true)}init(){execFileSync('python3',[path.join(here,'tests_sqlite_bridge.py')],{input:JSON.stringify({database:this.database,schema:fs.readFileSync(path.join(here,'migrations/0001_initial.sql'),'utf8')})})}}
export async function testWorker(worker,database){fs.rmSync(database,{force:true});const db=new TestD1(database);db.init();const env={DB:db,TEACHER_KEY:'cloud-test-teacher',ASSETS:{fetch:async()=>new Response('test asset')}};
async function req(route,body,cookie='',role='teacher'){let response=await worker.fetch(new Request('https://school.example'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Olimp-Role':role,Cookie:cookie},body:body?JSON.stringify(body):undefined}),env);let value=await response.json();if(response.status===500)throw Error('Unexpected 500: '+route);return {status:response.status,value,cookie:response.headers.get('Set-Cookie')?.split(';')[0]}}
const admin=(await req('/api/login',{key:'cloud-test-teacher'})).cookie;assert(admin);
const p=(await req('/api/students',{name:'Cloud pupil',variant:0},admin)).value;const p2=(await req('/api/students',{name:'Other pupil',variant:1},admin)).value;let sid=p.id;
assert.equal((await req('/api/assign',{student:sid,variant:0,lessons:[0,1,2,3,20,35],theory:[]},admin)).status,200);
let pupil=(await req('/api/login',{key:p.link.split('#')[1]})).cookie;
assert.equal((await req('/api/students',undefined,pupil,'student')).status,404);
assert.equal((await req('/api/me',undefined,pupil,'student')).value.role,'student');
async function attempt(lesson,correct){return req('/api/attempt',{lesson,answer:{choice:1},correct},pupil,'student')}
assert.equal((await attempt(0,false)).value.score,0);assert.equal((await attempt(0,true)).value.score,0.5);assert.equal((await attempt(0,true)).status,409);
assert.equal((await attempt(1,true)).value.score,1);assert.equal((await attempt(1,false)).status,409);
let simultaneous=await Promise.all([attempt(3,false),attempt(3,false),attempt(3,false)]);assert.equal(simultaneous.filter(r=>r.status===200).length,2);
assert.equal((await req('/api/self-profile',{display_name:'Student',about:'Arrays',learning_goal:'Practice',variant:1},pupil,'student')).status,200);
let me=(await req('/api/me',undefined,pupil,'student')).value;assert.equal(me.display_name,'Student');assert.equal(me.variant,0);assert(!('note' in me));
let sent=await req('/api/attempt',{lesson:35,answer:{python:'print(1)'},correct:true},pupil,'student');assert.equal(sent.status,200);let aid=sent.value.id;
assert.equal((await req('/api/review',{attempt:aid,action:'return',comment:''},admin)).status,400);
assert.equal((await req('/api/review',{attempt:aid,action:'return',comment:'Check equal values'},admin)).status,200);
assert.equal((await req('/api/review',{attempt:aid,score:3},admin)).status,409);
let notifications=(await req('/api/notifications',undefined,pupil,'student')).value;assert.equal(notifications.length,1);assert.equal(notifications[0].seen,0);
await req('/api/notification-read',{id:notifications[0].id},pupil,'student');assert.equal((await req('/api/notifications',undefined,pupil,'student')).value[0].seen,1);
let newer=await req('/api/attempt',{lesson:35,answer:{python:'print(2)'},correct:true},pupil,'student');assert.equal(newer.status,200);assert.notEqual(newer.value.id,aid);
assert.equal((await req('/api/review',{attempt:newer.value.id,score:4.5,comment:'Improved'},admin)).status,200);
assert.equal((await req('/api/attempt',{lesson:35,answer:{python:'print(3)'}},pupil,'student')).status,409);
let delta=(await req('/api/journal-delta?after=0&reviewed_after=0',undefined,admin)).value;assert(delta.rows.length>=4);assert(delta.rows.some(r=>r.id===newer.value.id&&r.score===4.5));
let own=(await req('/api/attempts-delta?after=0&reviewed_after=0',undefined,pupil,'student')).value;assert.equal(own.rows.length,delta.rows.length);
let group=(await req('/api/cohort',{name:'9A',kind:'class',members:[sid,p2.id]},admin)).value.id;assert(group);
assert.equal((await req('/api/bulk-assign',{students:[sid,p2.id],lessons:[4,5],mode:'add'},admin)).status,200);
assert.equal((await req('/api/bulk-assign',{students:[sid,999999],lessons:[6],mode:'replace'},admin)).status,400);assert((await req('/api/me',undefined,pupil,'student')).value.lessons.includes(35));
const more=[];for(let i=0;i<100;i++){let r=await db.prepare('INSERT INTO students(name,token,variant) VALUES(?,?,0)').bind('Bulk '+i,'fake-'+i).run();more.push(r.meta.last_row_id)}let before=db.queries;assert.equal((await req('/api/bulk-assign',{students:more,lessons:Array.from({length:50},(_,i)=>i)},admin)).status,200);assert(db.queries-before<10,'Bulk assignment must not exceed the Free plan query limit');
assert.equal((await req('/api/materials',undefined,pupil,'student')).value.length,50);
await req('/api/revoke',{student:sid},admin);assert.equal((await req('/api/me',undefined,pupil,'student')).status,401);
await db.prepare('UPDATE app_meta SET teacher_hash=? WHERE id=1').bind(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('cloud-test-teacher')).then(a=>[...new Uint8Array(a)].map(b=>b.toString(16).padStart(2,'0')).join(''))).run();delete env.TEACHER_KEY;
assert.equal((await req('/api/me',undefined,admin)).status,200,'Imported teacher hash must preserve the existing key and sessions');
assert.equal((await req('/api/login',{key:'cloud-test-teacher'})).status,200);
console.log('PASS cloud worker: authentication, persistent sessions, 2 attempts, grading/return/notifications, profiles, groups, deltas, 100×50 bulk assignment, imported teacher key');return {db,env,admin,pupil,pupilId:sid}}
