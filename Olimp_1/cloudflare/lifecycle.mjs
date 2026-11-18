export const lifecycleSchema = [
  "CREATE TABLE IF NOT EXISTS entity_states(kind TEXT NOT NULL CHECK(kind IN('student','cohort')),entity_id INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('archived','removed')),previous_active INTEGER,changed_at INTEGER NOT NULL,PRIMARY KEY(kind,entity_id))",
  ...['INSERT','UPDATE','DELETE'].map(action => `CREATE TRIGGER IF NOT EXISTS entity_states_revision_${action.toLowerCase()} AFTER ${action} ON entity_states BEGIN UPDATE app_meta SET revision=revision+1 WHERE id=1; END`)
];
const initialized = new WeakMap();
export async function ensureLifecycle(db) {
  if (!initialized.has(db)) initialized.set(db, db.batch(lifecycleSchema.map(sql => db.prepare(sql))).catch(error => { initialized.delete(db); throw error; }));
  return initialized.get(db);
}
const query = (db,sql,args=[]) => db.prepare(sql).bind(...args);
const all = async(db,sql,args=[]) => (await query(db,sql,args).all()).results;
export async function setLifecycle(db,body,need) {
  const {entity,id,action}=body;
  need(['student','cohort'].includes(entity)&&Number.isSafeInteger(id)&&['archive','remove','restore'].includes(action));
  const table=entity==='student'?'students':'cohorts';
  const row=await query(db,'SELECT * FROM '+table+' WHERE id=?',[id]).first();
  need(row,'Запись не найдена.',404);
  const state=await query(db,'SELECT * FROM entity_states WHERE kind=? AND entity_id=?',[entity,id]).first();
  const statements=[];
  if(action==='restore') {
    if(!state)return {ok:true};
    if(entity==='student')statements.push(query(db,'UPDATE students SET active=? WHERE id=?',[state.previous_active??1,id]));
    statements.push(query(db,'DELETE FROM entity_states WHERE kind=? AND entity_id=?',[entity,id]));
  } else {
    statements.push(query(db,'INSERT INTO entity_states(kind,entity_id,state,previous_active,changed_at) VALUES(?,?,?,?,?) ON CONFLICT(kind,entity_id) DO UPDATE SET state=excluded.state,changed_at=excluded.changed_at',[entity,id,action==='archive'?'archived':'removed',state?.previous_active??(entity==='student'?row.active:null),Math.floor(Date.now()/1000)]));
    if(entity==='student')statements.push(query(db,'UPDATE students SET active=0 WHERE id=?',[id]),query(db,"DELETE FROM sessions WHERE student=? AND role='student'",[id]));
  }
  await db.batch(statements);
  return {ok:true};
}
export async function setAccess(db,body,need) {
  need(Array.isArray(body.students)&&body.students.length>0&&body.students.length<=1000&&body.students.every(id=>Number.isSafeInteger(id)&&id>0));
  const pupils=[...new Set(body.students)],changes=body.changes??[],variant=body.variant??-1;
  need(Array.isArray(changes)&&changes.length<=50&&changes.every(c=>Number.isSafeInteger(c.lesson)&&c.lesson>=0&&c.lesson<50&&typeof c.open==='boolean')&&new Set(changes.map(c=>c.lesson)).size===changes.length&&[-1,0,1].includes(variant));
  need(changes.length>0||variant!==-1);
  const recipients=JSON.stringify(pupils);
  const known=await all(db,"SELECT id FROM students WHERE id IN(SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM entity_states WHERE kind='student' AND entity_id=students.id)",[recipients]);
  need(known.length===pupils.length,'Восстановите архивных или убранных учеников перед изменением заданий.');
  if(body.cohort!==undefined)need(Number.isSafeInteger(body.cohort)&&await query(db,"SELECT 1 AS ok FROM cohorts WHERE id=? AND NOT EXISTS(SELECT 1 FROM entity_states WHERE kind='cohort' AND entity_id=cohorts.id)",[body.cohort]).first(),'Группа больше не находится в текущем списке.');
  const closed=changes.filter(c=>!c.open).map(c=>c.lesson),opened=changes.filter(c=>c.open).map(c=>c.lesson),statements=[];
  if(closed.length)statements.push(query(db,'DELETE FROM lessons WHERE student IN(SELECT value FROM json_each(?)) AND lesson IN(SELECT value FROM json_each(?))',[recipients,JSON.stringify(closed)]));
  if(opened.length)statements.push(query(db,'INSERT OR IGNORE INTO lessons SELECT p.value,l.value FROM json_each(?) p CROSS JOIN json_each(?) l',[recipients,JSON.stringify(opened)]));
  if(variant!==-1)statements.push(query(db,'UPDATE students SET variant=? WHERE id IN(SELECT value FROM json_each(?))',[variant,recipients]));
  await db.batch(statements);
  const assignments=await all(db,'SELECT student,lesson FROM lessons WHERE student IN(SELECT value FROM json_each(?)) ORDER BY lesson',[recipients]);
  const profiles=await all(db,'SELECT id,variant FROM students WHERE id IN(SELECT value FROM json_each(?))',[recipients]);
  return {ok:true,students:profiles.map(p=>({...p,lessons:assignments.filter(r=>r.student===p.id).map(r=>r.lesson)}))};
}
