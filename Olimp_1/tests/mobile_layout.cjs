const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'..');
for(const name of fs.readdirSync(root).filter(n=>n.endsWith('.js')))new vm.Script(fs.readFileSync(path.join(root,name),'utf8'),{filename:name});
new vm.Script(fs.readFileSync(path.join(root,'webapp/portal.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]);
// A repeated sync must not reassign the hint's hidden attribute: the observer watches it.
let hiddenWrites=0,hidden=false;const hint={get hidden(){return hidden},set hidden(v){hidden=v;hiddenWrites++}};
const classes=new Set(),nodes={'#coursePhoneTopic':{textContent:''},'#coursePhoneStep':{textContent:''},'#courseActionDock':{hidden:false},'.phone-array-hint':hint};
nodes['#arena']={scrollWidth:100,clientWidth:100,parentElement:{querySelector:()=>({})}};
const context={document:{body:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)}},querySelector:s=>nodes[s]||null,querySelectorAll:()=>[]},position:0,topicTheoryView:false,meta:()=>({topic:0}),names:['Тема'],route:[0],matchMedia:()=>({matches:true})};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'mobile.js'),'utf8'),context);vm.runInContext('syncCoursePhone();syncCoursePhone()',context);
assert.equal(hiddenWrites,1,'Stable layout must not continuously trigger its own observer');
// Large or negative input values must not produce enormous or negative tap targets.
const arena={style:{setProperty(){}},innerHTML:''},live={};
const game={document:{querySelector:s=>s==='#arena'?arena:s==='#live'?live:null,querySelectorAll:()=>[]},localStorage:{getItem:()=>null},topics:[{a:[-5000,100000,5,100000]}]};
vm.createContext(game);let source=fs.readFileSync(path.join(root,'app.js'),'utf8');vm.runInContext(source.slice(0,source.indexOf("if($('#journal'))")),game);vm.runInContext('drawGame(0)',game);
const heights=[...arena.innerHTML.matchAll(/--height:([\d.]+)px/g)].map(m=>Number(m[1]));assert.equal(heights.length,4);assert(heights.every(h=>h>=48&&h<=148));
console.log('PASS: mobile observer converges, numeric values stay within usable bar heights, scripts parse');
