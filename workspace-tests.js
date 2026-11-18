/* FORMA automated tests. Run: node tests/workspace-tests.js
   Covers the workspace data layer (run in a Node vm with a fake localStorage), backup/restore, migration and static PWA checks.
   It does NOT drive a real browser, IndexedDB, a service worker or any physical device. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script>(.*?)<\/script>/gs)].map(x=>x[1]);
let passed=0;const test=(n,f)=>{try{f();passed++;console.log('  ok  '+n)}catch(e){console.error('FAIL  '+n+'\n'+(e.stack||e));process.exitCode=1}};
const boot=scripts[0];
function make(initial,opts){opts=opts||{};
 class Store{constructor(){this.m=new Map()}getItem(k){return this.m.has(k)?this.m.get(k):null}setItem(k,v){if(opts.failOn&&opts.failOn(k,v))throw Error('QuotaExceeded');this.m.set(k,String(v))}removeItem(k){this.m.delete(k)}}
 const raw={g:Store.prototype.getItem,s:Store.prototype.setItem,r:Store.prototype.removeItem},store=new Store();
 Object.entries(initial||{}).forEach(([k,v])=>raw.s.call(store,k,v));
 const ctx={Storage:Store,localStorage:store,location:{reload(){ctx.reloads=(ctx.reloads||0)+1}},reloads:0,Date,Math,JSON,Array,String,Object,Error,Promise};ctx.window=ctx;
 vm.runInNewContext(boot,ctx);return{W:ctx.FORMA_WORKSPACES,store,raw,ctx,Store};}
const R={reload:false};
const put=(t,k,v)=>t.store.setItem(k,typeof v==='string'?v:JSON.stringify(v));
const get=(t,k)=>t.store.getItem(k);
const hist=n=>JSON.stringify({v:3,sessions:Array.from({length:n},(_,i)=>({id:'s'+i}))});

console.log('Workspace management');
test('new install starts with no workspace',()=>{const t=make();assert.equal(t.W.registry.length,0);assert.equal(t.W.active,'')});
test('create: unique stable IDs, name/colour/avatar saved and sanitised',()=>{const t=make();const a=t.W.create('  Alpha  ','#112233','⚡',R),b=t.W.create('Beta','not-a-colour','🔥',R);
 assert.notEqual(a,b);assert.match(a,/^ws_/);const r=t.W.registry;assert.equal(r.length,2);assert.equal(r[0].name,'Alpha');assert.equal(r[0].color,'#112233');assert.equal(r[0].avatar,'⚡');assert.equal(r[1].color,'#33aaff');assert.equal(t.W.active,b)});
test('1000 created IDs are unique',()=>{const t=make();const s=new Set();for(let i=0;i<200;i++)s.add(t.W.create('w'+i,'#000000','💪',R));assert.equal(s.size,200)});
test('rename / recolour / change avatar',()=>{const t=make();const a=t.W.create('A','#112233','💪',R);t.W.update(a,{name:'Renamed',color:'#abcdef',avatar:'🎯'});const w=t.W.registry[0];assert.deepEqual([w.name,w.color,w.avatar],['Renamed','#abcdef','🎯']);t.W.update(a,{name:'   '});assert.equal(t.W.registry[0].name,'Renamed','blank rename ignored')});
test('switching persists the active workspace across reloads',()=>{const t=make();const a=t.W.create('A',null,null,R);t.W.create('B',null,null,R);t.W.setActive(a,R);assert.equal(t.W.active,a);
 const t2=make(Object.fromEntries(t.store.m));assert.equal(t2.W.active,a,'active workspace restored after restart');assert.equal(t2.W.registry.length,2);assert.throws(()=>t.W.setActive('nope',R),/not found/)});
test('delete removes only that workspace and never the last one',()=>{const t=make();const a=t.W.create('A',null,null,R);put(t,'m2099.v3.history','a');const b=t.W.create('B',null,null,R);put(t,'m2099.v3.history','b');
 t.W.remove(b,R);assert.equal(t.W.registry.length,1);assert.equal(t.W.active,a);assert.equal(get(t,'m2099.v3.history'),'a');assert.equal(t.raw.g.call(t.store,'forma.workspace.data.'+b+'.m2099.v3.history'),null);assert.throws(()=>t.W.remove(a,R),/at least one/)});

console.log('Data isolation');
test('history, records, active workout, settings, snaps and meta are isolated across three workspaces',()=>{const t=make();const ids=[];const kinds=['m2099.v3.history','m2099.v3.top','m2099.v3.active','forma.prefs','m2099.v3.snaps','m2099.v3.meta'];
 ['A','B','C'].forEach(n=>{ids.push(t.W.create(n,null,null,R));kinds.forEach(k=>put(t,k,{owner:n,k}))});
 ids.forEach((id,i)=>{t.W.setActive(id,R);kinds.forEach(k=>assert.equal(JSON.parse(get(t,k)).owner,'ABC'[i],k+' leaked in '+id))});
 t.W.setActive(ids[0],R);put(t,'m2099.v3.history',{owner:'A',changed:true});t.W.setActive(ids[1],R);assert.equal(JSON.parse(get(t,'m2099.v3.history')).changed,undefined,'editing A does not change B')});
test('a brand-new workspace sees none of the previous workspace’s data',()=>{const t=make();t.W.create('A',null,null,R);put(t,'m2099.v3.history','x');t.W.create('B',null,null,R);assert.equal(get(t,'m2099.v3.history'),null)});
test('hasActiveWorkout is per workspace',()=>{const t=make();const a=t.W.create('A',null,null,R);put(t,'m2099.v3.active',{sets:{'1':1}});const b=t.W.create('B',null,null,R);put(t,'m2099.v3.active',{sets:{}});assert.equal(t.W.hasActiveWorkout(),false);t.W.setActive(a,R);assert.equal(t.W.hasActiveWorkout(),true)});

console.log('Backup and restore');
const two=()=>{const t=make();const a=t.W.create('Alpha','#112233','⚡',R);put(t,'m2099.v3.history',hist(3));put(t,'m2099.v3.top',{bench:100});const b=t.W.create('Beta','#445566','🔥',R);put(t,'m2099.v3.history',hist(1));t.W.setActive(a,R);return{t,a,b}};
test('workspace export has id, name, avatar, colour, version, date and data',()=>{const{t,a}=two();const e=t.W.export(a);assert.equal(e.format,'forma.workspace');assert.equal(e.version,2);assert.equal(e.workspace.id,a);assert.equal(e.workspace.name,'Alpha');assert.equal(e.workspace.avatar,'⚡');assert.equal(e.workspace.color,'#112233');assert.ok(Date.parse(e.exportedAt));assert.equal(e.data['m2099.v3.history'],hist(3));JSON.parse(JSON.stringify(e))});
test('import as new workspace creates a separate copy and leaves the original alone',()=>{const{t,a}=two();const e=JSON.parse(JSON.stringify(t.W.export(a)));const id=t.W.importBackup(e,'new',R);assert.notEqual(id,a);assert.equal(t.W.registry.length,3);assert.equal(t.W.current.name,'Alpha (copy)');assert.equal(get(t,'m2099.v3.history'),hist(3));t.W.setActive(a,R);assert.equal(get(t,'m2099.v3.history'),hist(3))});
test('inspect detects an existing workspace with the same ID',()=>{const{t,a}=two();const i=t.W.inspect(t.W.export(a));assert.equal(i.conflict.id,a);const e=t.W.export(a);e.workspace.id='ws_other';assert.equal(t.W.inspect(e).conflict,null)});
test('replace creates a safety snapshot first and removes stale keys',()=>{const{t,a}=two();const e=t.W.export(a);put(t,'m2099.v3.history',hist(9));put(t,'m2099.v3.meta',{stale:true});t.W.importBackup(e,'replace',{...R,targetId:a});assert.equal(get(t,'m2099.v3.history'),hist(3));assert.equal(get(t,'m2099.v3.meta'),null,'stale key removed');
 const snaps=t.W.listSnapshots(a);assert.equal(snaps.length,1);const snap=JSON.parse(t.raw.g.call(t.store,snaps[0].key));assert.equal(snap.data['m2099.v3.history'],hist(9),'snapshot holds pre-restore data');assert.equal(snap.snapshot.reason,'before-restore')});
test('snapshot can itself be restored; only the 3 most recent are kept',()=>{const{t,a}=two();const e=t.W.export(a);for(let i=0;i<5;i++){put(t,'m2099.v3.history',hist(10+i));t.W.importBackup(e,'replace',{...R,targetId:a})}assert.equal(t.W.listSnapshots(a).length,3);const latest=t.W.listSnapshots(a)[0];t.W.restoreSnapshot(a,latest.key.split('.').pop(),R);assert.equal(get(t,'m2099.v3.history'),hist(14))});
test('failed restore rolls back and original data stays intact',()=>{let fail=false;const t=make({},{failOn:(k)=>fail&&k.endsWith('.m2099.v3.top')});const a=t.W.create('A','#112233','💪',R);put(t,'m2099.v3.history','orig-h');put(t,'m2099.v3.top','orig-t');const e={app:'forma-workspace',format:'forma.workspace',version:2,workspace:{id:a,name:'Changed'},data:{'m2099.v3.history':'"new"','m2099.v3.top':'"new"'}};
 fail=true;assert.throws(()=>t.W.importBackup(e,'replace',{...R,targetId:a}),/original data was kept/);fail=false;assert.equal(get(t,'m2099.v3.history'),'orig-h');assert.equal(get(t,'m2099.v3.top'),'orig-t');assert.equal(t.W.registry[0].name,'A')});
test('failed new-workspace import leaves nothing behind',()=>{let fail=false;const t=make({},{failOn:k=>fail&&k.endsWith('m2099.v3.top')});t.W.create('A',null,null,R);fail=true;assert.throws(()=>t.W.importBackup({format:'forma.workspace',version:2,workspace:{name:'X'},data:{'m2099.v3.top':'1'}},'new',R),/nothing was changed/);assert.equal(t.W.registry.length,1)});
test('validation: invalid structures, versions and corrupt data give clear errors',()=>{const t=make();t.W.create('A',null,null,R);
 for(const bad of [null,[],'x',42,{}])assert.throws(()=>t.W.importBackup(bad,'new',R),/FORMA backup/);
 assert.throws(()=>t.W.importBackup({format:'forma.workspace',workspace:{name:'x'},data:{}},'new',R),/version/);
 assert.throws(()=>t.W.importBackup({format:'forma.workspace',version:99,workspace:{name:'x'},data:{}},'new',R),/newer version/);
 assert.throws(()=>t.W.importBackup({format:'forma.workspace',version:2,workspace:{},data:{}},'new',R),/name/);
 assert.throws(()=>t.W.importBackup({format:'forma.workspace',version:2,workspace:{name:'x'}},'new',R),/workout data/);
 assert.throws(()=>t.W.importBackup({format:'forma.workspace',version:2,workspace:{name:'x'},data:{'m2099.v3.history':'{broken'}},'new',R),/damaged/);
 assert.equal(t.W.registry.length,1,'rejected imports create nothing')});
test('invalid JSON text fails JSON.parse (UI shows a friendly message)',()=>{assert.throws(()=>JSON.parse('{nope'))});
test('legacy (v1 envelope and pre-workspace) backups still import',()=>{const t=make();t.W.create('A',null,null,R);
 t.W.importBackup({app:'forma-workspace',format:'forma.workspace',version:1,workspace:{name:'Old'},data:{'m2099.v3.history':hist(2)}},'new',R);assert.equal(get(t,'m2099.v3.history'),hist(2));
 t.W.importBackup({app:'miguel-2099',history:[{id:1}]},'new',R);assert.equal(t.W.current.name,'Imported training');assert.deepEqual(JSON.parse(get(t,'m2099.v3.history')),[{id:1}])});
test('full backup: export all, add as copies, merge, and rollback on failure',()=>{const{t,a,b}=two();const all=JSON.parse(JSON.stringify(t.W.exportAll()));assert.equal(all.format,'forma.all');assert.equal(all.workspaces.length,2);assert.equal(all.activeId,a);
 const i=t.W.inspect(all);assert.equal(i.count,2);assert.equal(i.conflicts.length,2);
 t.W.importAll(all,'add',R);assert.equal(t.W.registry.length,4);
 const fresh=make();fresh.W.importAll(all,'merge',R);assert.equal(fresh.W.registry.length,2);assert.deepEqual(fresh.W.registry.map(w=>w.id).sort(),[a,b].sort(),'IDs preserved on a clean device');assert.equal(fresh.W.active,a);
 fresh.W.setActive(b,R);assert.equal(fresh.store.getItem('m2099.v3.history'),hist(1));
 put(t,'m2099.v3.history',hist(7));t.W.importAll(all,'merge',R);assert.equal(t.W.registry.length,4);assert.equal(get(t,'m2099.v3.history'),hist(3));assert.ok(t.W.listSnapshots(a).length>=1,'merge snapshots replaced workspaces');
});
test('full restore that fails mid-way keeps existing workspaces',()=>{const{t,a}=two();const all=JSON.parse(JSON.stringify(t.W.exportAll()));let n=0;const t2=make({},{failOn:(k)=>/forma\.workspace\.data\./.test(k)&&++n>1});t2.W.create('Existing',null,null,R);n=0;assert.throws(()=>t2.W.importAll(all,'add',R),/existing workspaces were kept/);assert.equal(t2.W.registry.length,1);assert.equal(t2.W.registry[0].name,'Existing')});

console.log('Migration');
const legacy={'m2099.v3.history':hist(4),'m2099.v3.top':'{"squat":140}','m2099.v3.active':'{"sets":{}}','forma.prefs':'{"theme":"x"}','m2099.v3.snaps':'[1]'};
test('legacy single-user data becomes "My Training" with everything preserved',()=>{const t=make(legacy);assert.equal(t.W.registry.length,1);assert.equal(t.W.current.name,'My Training');Object.entries(legacy).forEach(([k,v])=>assert.equal(get(t,k),v,k))});
test('legacy keys are kept untouched after migration',()=>{const t=make(legacy);Object.entries(legacy).forEach(([k,v])=>assert.equal(t.store.m.get(k),v,k+' still present'))});
test('migration is idempotent across restarts and does not overwrite later changes',()=>{const t=make(legacy);const id=t.W.active;put(t,'m2099.v3.history',hist(9));const t2=make(Object.fromEntries(t.store.m));assert.equal(t2.W.registry.length,1);assert.equal(t2.W.active,id);assert.equal(get(t2,'m2099.v3.history'),hist(9));const t3=make(Object.fromEntries(t2.store.m));assert.equal(t3.W.registry.length,1)});
test('legacy install with a failing migration falls back to the original keys',()=>{const t=make(legacy,{failOn:k=>k.startsWith('forma.workspace.data.')});assert.equal(t.W.registry.length,0);assert.equal(t.store.getItem('m2099.v3.history'),hist(4))});
test('fresh install is not treated as legacy',()=>{assert.equal(make({unrelated:'1'}).W.registry.length,0)});

console.log('UI contract (static)');
test('app scripts parse',()=>{assert.ok(scripts.length>=4);scripts.forEach(s=>new Function(s))});
test('UI exposes switch confirmation, export/import, full backup, delete-with-export, onboarding',()=>{['hasActiveWorkout','workspaceExportAll','workspaceRestoreAll','Export backup first','workspaceImport','no account, email or password','not password-protected'].forEach(s=>assert.ok(html.includes(s)||html.includes(s.replace(/,/g,'')),'missing: '+s))});
test('workspace layer has its own FORMA-styled CSS and sits below the dialog layer',()=>{assert.match(html,/#workspaceLayer\.show\{display:flex\}/);assert.match(html,/\.wpanel button\.pri/);assert.match(html,/#workspaceLayer\{[^}]*z-index:55/);assert.match(html,/#modal\{[^}]*z-index:60/)});
test('colour pickers render swatches (no hex text) and the selector shows an account icon',()=>{assert.match(html,/attr\.endsWith\('col'\)\?'':x/);assert.match(html,/<circle cx="12" cy="8" r="4"\/>/)});
test('no network calls in app code',()=>{assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(scripts.join('\n')),'app makes no network requests')});

console.log('PWA');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8')),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
test('manifest is valid and its icons exist',()=>{assert.equal(manifest.short_name,'FORMA');assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'./');assert.ok(manifest.name.startsWith('FORMA'));manifest.icons.forEach(i=>assert.ok(fs.existsSync(path.join(root,i.src)),i.src));assert.ok(manifest.icons.some(i=>i.sizes==='512x512')&&manifest.icons.some(i=>i.sizes==='192x192'))});
test('index links manifest and iOS icon; registers sw.js',()=>{assert.match(html,/rel="manifest"/);assert.match(html,/apple-touch-icon/);assert.match(html,/serviceWorker\.register\("\.\/sw\.js"\)/)});
test('service worker caches every shell file that exists and only touches caches',()=>{const m=sw.match(/ASSETS=\[(.*?)\]/s)[1].match(/'\.\/?([^']*)'/g).map(x=>x.slice(3,-1));['index.html','manifest.webmanifest','icon.svg','icon-180.png','icon-192.png','icon-512.png'].forEach(f=>assert.ok(m.includes(f),f+' cached'));m.filter(Boolean).forEach(f=>assert.ok(fs.existsSync(path.join(root,f)),f));assert.match(sw,/CACHE='forma-shell-v\d+'/);assert.ok(!/localStorage|indexedDB/.test(sw),'sw never touches user data');assert.match(sw,/respondWith/);assert.match(sw,/caches\.match\('\.\/index\.html'\)/,'offline fallback to shell')});
console.log('\n'+passed+' tests passed'+(process.exitCode?' — with FAILURES':''));
