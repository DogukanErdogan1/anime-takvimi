import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,readdirSync,mkdirSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {createMembershipService,validateLibrary} from '../lib/membership.mjs';

// Drive the production React form handler with hook state, then pass its actual
// patch through app.js install/persist and the real membership SQL service.
const runtime=resolve('.sites-runtime');mkdirSync(runtime,{recursive:true});
const files=[];
function write(name,source){const file=resolve(runtime,`collection-form-${name}-${process.pid}.mjs`);files.push(file);writeFileSync(file,source);return file;}
const hooksFile=write('hooks',`let values=[],cursor=0,profile=null;export function reset(value){values=[];profile=value;}export function begin(){cursor=0;}export function useState(initial){const index=cursor++;if(!(index in values))values[index]=index===0?profile:typeof initial==='function'?initial():initial;return[values[index],next=>{values[index]=typeof next==='function'?next(values[index]):next;}];}export function useEffect(){}export function useMemo(callback){return callback();}export function useRef(initial){const index=cursor++;if(!(index in values))values[index]={current:initial};return values[index];}`);
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX};
const modelFile=write('model',ts.transpileModule(readFileSync(new URL('../components/experience/model.ts',import.meta.url),'utf8'),{compilerOptions:options}).outputText);
const watchStatusFile=write('watch-status-select',ts.transpileModule(readFileSync(new URL('../components/experience/watch-status-select.tsx',import.meta.url),'utf8'),{compilerOptions:options}).outputText);
const source=readFileSync(new URL('../components/experience/detail-profile.tsx',import.meta.url),'utf8')
  .replace(/import \{AvatarFrame\} from '\.\/avatar-frame';/, 'const AvatarFrame=()=>null;')
  .replace(/import AvatarFramePicker from '\.\/avatar-frame-picker';/, 'const AvatarFramePicker=()=>null;')
  .replace("from '../../lib/avatar-frames.mjs'", `from '${new URL('../lib/avatar-frames.mjs',import.meta.url).href}'`)
  .replace("from 'react'",`from './${hooksFile.split(/[/\\]/).at(-1)}'`)
  .replace("from './model'",`from './${modelFile.split(/[/\\]/).at(-1)}'`)
  .replace("from './watch-status-select'",`from './${watchStatusFile.split(/[/\\]/).at(-1)}'`);
const componentFile=write('component',ts.transpileModule(source,{compilerOptions:options}).outputText);
after(()=>{for(const file of files)try{unlinkSync(file);}catch{}});
const hooks=await import(pathToFileURL(hooksFile).href);
const {ProfileView}=await import(pathToFileURL(componentFile).href);

class SQLiteD1{
  constructor(){this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON;');const root=new URL('../drizzle/',import.meta.url);for(const name of readdirSync(root).filter(name=>name.endsWith('.sql')).sort())this.sqlite.exec(readFileSync(new URL(name,root),'utf8'));}
  prepare(sql){const query=this.sqlite.prepare(sql);const create=(values=[])=>({bind(...next){return create(next);},async first(column){const row=query.get(...values);return row?column?row[column]:{...row}:null;},async all(){return{results:query.all(...values).map(row=>({...row}))};},async run(){return this._run();},_run(){return{meta:{changes:Number(query.run(...values).changes)}};}});return create();}
  async batch(statements){this.sqlite.exec('BEGIN;');try{const result=statements.map(statement=>statement._run());this.sqlite.exec('COMMIT;');return result;}catch(error){this.sqlite.exec('ROLLBACK;');throw error;}}
}
const clone=value=>JSON.parse(JSON.stringify(value));
const empty=()=>({saved:[],reminders:[],progress:{},view:'grid',savedAnime:{},tracking:{},scores:{},favorites:[],collections:[]});
function client(storage=new Map()){
  const events=[];
  const window={addEventListener(){},dispatchEvent(event){events.push(event);},scrollTo(){}};
  const location={hash:'#seasons'};
  const context={window,location,document:{readyState:'complete',body:{dataset:{}},querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    history:{replaceState(_state,_title,hash){location.hash=hash;}},Date,Intl,URL,AbortController,DOMException,
    CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}},setInterval(){return 1;},setTimeout(){return 1;},clearTimeout(){}};
  runInNewContext(readFileSync(new URL('../public/site/app.js',import.meta.url),'utf8'),context,{filename:'app.js'});
  return {bridge:window.animeTakvimi,events,storage};
}
function find(tree,predicate){if(!tree||typeof tree!=='object')return null;if(Array.isArray(tree)){for(const child of tree){const found=find(child,predicate);if(found)return found;}return null;}if(predicate(tree))return tree;return find(tree.props?.children,predicate);}
function text(tree){if(tree==null||typeof tree==='boolean')return'';if(typeof tree==='string'||typeof tree==='number')return String(tree);return Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}
function profileUI(ui,{reject=false,onOpenDetail=()=>{}}={}){
  hooks.reset({id:'collection-user',displayName:'Collection user',bio:'',isPublic:false});
  const render=()=>{hooks.begin();return ProfileView({snapshot:{ready:true,page:'profile',catalog:[],schedule:[],library:clone(ui.bridge.getLibrarySnapshot()),account:{authenticated:true,registered:true,user:{id:'collection-user',displayName:'Collection user',role:'member',status:'active'}},accountScope:'collection-user',loading:false,error:null,libraryLoading:false,blocked:false},onClose(){},onOpenDetail,onChange(patch){if(reject)return;const current=ui.bridge.getLibrarySnapshot();ui.bridge.replaceLibrarySnapshot({...current,...(typeof patch==='function'?patch(current):patch)},{emit:true});}});};
  return {render,create(title){let tree=render();const input=find(tree,node=>node.props?.id==='at-new-collection');assert.ok(input,'real profile form must be rendered');input.props.onChange({target:{value:title}});tree=render();const form=find(tree,node=>node.type==='form'&&node.props.className==='at-collection-create');let prevented=false;form.props.onSubmit({preventDefault(){prevented=true;}});assert.equal(prevented,true);return render();}};
}
function withCrypto(value,action){const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');Object.defineProperty(globalThis,'crypto',{configurable:true,value});try{return action();}finally{if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto;}}

test('actual collection form works without randomUUID and persists through client, database and reload',async t=>{
  const db=new SQLiteD1();t.after(()=>db.sqlite.close());
  const membership=createMembershipService(db),identity={userId:'collection-user',email:'collection-user@example.test'};
  await membership.register(identity,{displayName:'Collection user'});
  const ui=client();ui.bridge.setAccountScope(identity.userId,{...empty(),saved:['mal-1'],progress:{'mal-1':3},savedAnime:{'mal-1':{id:'mal-1',malId:1,title:'Existing anime',image:null,episodes:12,genres:['Aksiyon']}},collections:[{id:'legacy',title:'Existing collection',animeIds:[]}]});
  const form=profileUI(ui);
  const tree=withCrypto({getRandomValues(bytes){return bytes.fill(7);}},()=>form.create('  Hafta sonu  '));
  const created=clone(ui.bridge.getLibrarySnapshot()).collections.find(value=>value.title==='Hafta sonu');
  assert.ok(created);assert.match(created.id,/^[a-z0-9][a-z0-9_-]{0,47}$/);
  assert.deepEqual(created.animeIds,[]);
  const checkbox=find(tree,node=>node.type==='input'&&node.props.type==='checkbox');assert.ok(checkbox);checkbox.props.onChange({target:{checked:true}});
  const submitted=clone(ui.bridge.getLibrarySnapshot());
  assert.equal(submitted.collections[0].title,'Existing collection');assert.equal(submitted.progress['mal-1'],3);
  assert.deepEqual(submitted.collections[1].animeIds,['mal-1']);
  assert.deepEqual(validateLibrary({library:submitted}),submitted);
  await membership.putLibrary(identity,{library:submitted});
  const stored=(await membership.getLibrary(identity)).library;
  assert.deepEqual(stored.collections,submitted.collections);
  const reloaded=client(ui.storage);reloaded.bridge.setAccountScope(identity.userId);assert.deepEqual(clone(reloaded.bridge.getLibrarySnapshot()).collections,stored.collections);
  reloaded.bridge.replaceLibrarySnapshot(stored,{emit:false});assert.deepEqual(clone(reloaded.bridge.getLibrarySnapshot()).collections,submitted.collections);
  assert.ok(ui.events.some(event=>event.type==='anime:librarychange'&&event.detail.collections.length===2));
});

test('missing crypto and repeated random bytes still create unique server-valid collection IDs',()=>{
  const ui=client();ui.bridge.setAccountScope('collection-user',empty());const form=profileUI(ui);
  withCrypto(undefined,()=>form.create('No crypto'));
  withCrypto({getRandomValues(bytes){return bytes.fill(1);}},()=>{form.create('First');form.create('Second');});
  const stored=clone(ui.bridge.getLibrarySnapshot());assert.equal(stored.collections.length,3);assert.equal(new Set(stored.collections.map(value=>value.id)).size,3);assert.deepEqual(validateLibrary({library:stored}).collections,stored.collections);
});

test('rejected library change retains the typed collection name and gives useful feedback',()=>{
  const ui=client();ui.bridge.setAccountScope('collection-user',empty());const form=profileUI(ui,{reject:true});
  const tree=form.create('Keep this draft');assert.equal(find(tree,node=>node.props?.id==='at-new-collection').props.value,'Keep this draft');assert.match(text(tree),/Hesap listen henüz hazır değil/);assert.deepEqual(clone(ui.bridge.getLibrarySnapshot()).collections,[]);
});

test('invalid collection names do not mutate or discard existing library data',()=>{
  const ui=client();ui.bridge.setAccountScope('collection-user',{...empty(),collections:[{id:'legacy',title:'Keep me',animeIds:[]}]});const form=profileUI(ui);
  const tree=form.create('Bad\u0001name');assert.match(text(tree),/Koleksiyon adı 1–60 geçerli karakter/);assert.equal(find(tree,node=>node.props?.id==='at-new-collection').props.value,'Bad\u0001name');assert.deepEqual(clone(ui.bridge.getLibrarySnapshot()).collections,[{id:'legacy',title:'Keep me',animeIds:[]}]);
});

test('cinematic collection preview uses only its own safe posters and opening reveals every member',()=>{
  const ui=client(),opened=[];
  const anime=Array.from({length:5},(_,i)=>({id:`mal-${i+1}`,malId:i+1,title:`Anime ${i+1}`,image:`https://cdn.myanimelist.net/images/anime/${i+1}.jpg`,episodes:12,genres:['Aksiyon']}));
  anime[1].image='https://attacker.example/poster.jpg';
  ui.bridge.setAccountScope('collection-user',{...empty(),saved:anime.map(item=>item.id),savedAnime:Object.fromEntries(anime.map(item=>[item.id,item])),collections:[{id:'first',title:'First',animeIds:anime.slice(0,4).map(item=>item.id)},{id:'other',title:'Other',animeIds:['mal-5']}]});
  const form=profileUI(ui,{onOpenDetail:item=>opened.push(item.id)});
  let tree=form.render();
  const article=find(tree,node=>node.type==='article'&&text(node).includes('First'));
  const montage=find(article,node=>node.props?.className==='at-collection-montage');
  assert.deepEqual(montage.props.children.map(scene=>scene.props.children.props.item.id),['mal-1','mal-3','mal-4']);
  const toggle=find(article,node=>node.props?.['aria-label']==='First koleksiyonunu aç');
  assert.equal(toggle.props['aria-expanded'],false);
  assert.equal(find(article,node=>node.props?.id===toggle.props['aria-controls']).props.hidden,true);
  toggle.props.onClick();tree=form.render();
  const content=find(tree,node=>node.props?.id==='at-collection-content-first');
  assert.equal(content.props.hidden,false);
  const grid=find(content,node=>node.props?.className==='at-collection-anime-grid');
  assert.equal(grid.props.children.length,4);
  find(grid,node=>node.props?.['aria-label']==='Anime 4 detaylarını aç').props.onClick();
  assert.deepEqual(opened,['mal-4']);
  find(tree,node=>node.props?.['aria-label']==='First koleksiyonunu kapat').props.onClick();
  assert.equal(find(form.render(),node=>node.props?.id==='at-collection-content-first').props.hidden,true);
});

test('collection editing updates its membership and delete removes only the selected collection',()=>{
  const ui=client();
  const anime={id:'mal-1',malId:1,title:'One',image:null,episodes:12,genres:[]};
  ui.bridge.setAccountScope('collection-user',{...empty(),saved:['mal-1'],savedAnime:{'mal-1':anime},collections:[{id:'first',title:'First',animeIds:[]},{id:'keep',title:'Keep',animeIds:[]}]});
  const form=profileUI(ui);
  find(form.render(),node=>node.props?.['aria-label']==='First koleksiyonunu düzenle').props.onClick();
  const tree=form.render();
  const content=find(tree,node=>node.props?.id==='at-collection-content-first');
  assert.equal(content.props.hidden,false);
  find(content,node=>node.type==='input'&&node.props.type==='checkbox').props.onChange();
  assert.deepEqual(clone(ui.bridge.getLibrarySnapshot()).collections[0].animeIds,['mal-1']);
  find(form.render(),node=>node.props?.['aria-label']==='First koleksiyonunu düzenlemeyi bitir').props.onClick();
  assert.equal(find(form.render(),node=>node.props?.id==='at-collection-content-first').props.hidden,true);
  find(form.render(),node=>node.props?.['aria-label']==='First koleksiyonunu sil').props.onClick();
  assert.deepEqual(clone(ui.bridge.getLibrarySnapshot()).collections,[{id:'keep',title:'Keep',animeIds:[]}]);
  assert.equal(find(form.render(),node=>node.props?.id==='at-collection-content-first'),null);
});

test('both library designs paginate five anime, keep the current page when switching view, and reset for filters',()=>{
  const ui=client();
  const anime=Array.from({length:12},(_,i)=>({id:`mal-${i+1}`,malId:i+1,title:`Anime ${i+1}`,image:null,episodes:12,genres:[]}));
  ui.bridge.setAccountScope('collection-user',{...empty(),saved:anime.map(item=>item.id),savedAnime:Object.fromEntries(anime.map(item=>[item.id,item])),tracking:Object.fromEntries(anime.map((item,i)=>[item.id,i<7?'watching':'planned'])),favorites:['mal-12']});
  const form=profileUI(ui);
  const list=tree=>find(tree,node=>node.props?.id==='at-library-page-items');
  const ids=tree=>list(tree).props.children.map(node=>node.props.item?.id||find(node,child=>child.props?.item)?.props.item.id);
  let tree=form.render();
  assert.deepEqual(ids(tree),anime.slice(0,5).map(item=>item.id));
  assert.equal(find(tree,node=>node.props?.['aria-label']==='Önceki sayfa').props.disabled,true);
  find(tree,node=>node.props?.['aria-label']==='2. sayfa').props.onClick();tree=form.render();
  assert.deepEqual(ids(tree),anime.slice(5,10).map(item=>item.id));
  find(tree,node=>node.props?.title==='Eski afiş tasarımı').props.onClick();tree=form.render();
  assert.match(list(tree).props.className,/at-library-classic/);
  assert.deepEqual(ids(tree),anime.slice(5,10).map(item=>item.id));
  find(tree,node=>node.props?.['aria-label']==='Sonraki sayfa').props.onClick();tree=form.render();
  assert.deepEqual(ids(tree),['mal-11','mal-12']);
  assert.equal(find(tree,node=>node.props?.['aria-label']==='Sonraki sayfa').props.disabled,true);
  const filters=find(tree,node=>node.props?.['aria-label']==='İzleme listesi filtresi');
  find(filters,node=>node.type==='button'&&text(node)==='İzliyorum').props.onClick();tree=form.render();
  assert.deepEqual(ids(tree),anime.slice(0,5).map(item=>item.id));
  find(tree,node=>node.props?.['aria-label']==='Sonraki sayfa').props.onClick();tree=form.render();
  assert.deepEqual(ids(tree),['mal-6','mal-7']);
  find(find(tree,node=>node.props?.['aria-label']==='İzleme listesi filtresi'),node=>node.type==='button'&&text(node)==='Favoriler').props.onClick();tree=form.render();
  assert.deepEqual(ids(tree),['mal-12']);
  assert.equal(find(tree,node=>node.props?.['aria-label']==='Anime listesi sayfaları'),null);
});

test('a shrinking library clamps the last page immediately instead of showing an empty list',()=>{
  const ui=client();
  const anime=Array.from({length:11},(_,i)=>({id:`mal-${i+1}`,malId:i+1,title:`Anime ${i+1}`,image:null,episodes:12,genres:[]}));
  ui.bridge.setAccountScope('collection-user',{...empty(),saved:anime.map(item=>item.id),savedAnime:Object.fromEntries(anime.map(item=>[item.id,item]))});
  const form=profileUI(ui);
  find(form.render(),node=>node.props?.['aria-label']==='3. sayfa').props.onClick();
  ui.bridge.replaceLibrarySnapshot({...empty(),saved:anime.slice(0,6).map(item=>item.id),savedAnime:Object.fromEntries(anime.slice(0,6).map(item=>[item.id,item]))},{emit:true});
  const tree=form.render();
  const list=find(tree,node=>node.props?.id==='at-library-page-items');
  assert.equal(list.props.children.length,1);assert.equal(list.props.children[0].props.item.id,'mal-6');
  assert.equal(find(tree,node=>node.props?.['aria-label']==='2. sayfa').props['aria-current'],'page');
});
