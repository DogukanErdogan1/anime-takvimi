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
const source=readFileSync(new URL('../components/experience/detail-profile.tsx',import.meta.url),'utf8')
  .replace("from 'react'",`from './${hooksFile.split(/[/\\]/).at(-1)}'`)
  .replace("from './model'",`from './${modelFile.split(/[/\\]/).at(-1)}'`);
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
function profileUI(ui,{reject=false}={}){
  hooks.reset({id:'collection-user',displayName:'Collection user',bio:'',isPublic:false});
  const render=()=>{hooks.begin();return ProfileView({snapshot:{ready:true,page:'profile',catalog:[],schedule:[],library:clone(ui.bridge.getLibrarySnapshot()),account:{authenticated:true,registered:true,user:{id:'collection-user',displayName:'Collection user',role:'member',status:'active'}},accountScope:'collection-user',loading:false,error:null,libraryLoading:false,blocked:false},onClose(){},onOpenDetail(){},onChange(patch){if(reject)return;const current=ui.bridge.getLibrarySnapshot();ui.bridge.replaceLibrarySnapshot({...current,...(typeof patch==='function'?patch(current):patch)},{emit:true});}});};
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
