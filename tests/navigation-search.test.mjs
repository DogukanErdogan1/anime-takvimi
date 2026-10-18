import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

// Exercise the actual component handlers and effects without a browser. The
// model is production code; only React hooks, DOM refs and time are controlled.
const runtime=resolve('.sites-runtime');mkdirSync(runtime,{recursive:true});const files=[];
function write(name,source){const path=resolve(runtime,`navigation-search-${name}-${process.pid}.mjs`);files.push(path);writeFileSync(path,source);return path;}
const hooksFile=write('hooks',`let values=[],cursor=0,effects=new Map(),queue=[],dirty=false,active=true,late=0;
export function reset(){values=[];cursor=0;effects=new Map();queue=[];dirty=false;active=true;late=0;}
export function begin(){cursor=0;dirty=false;}
export function useState(initial){const index=cursor++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return[values[index],next=>{if(!active)late++;const value=typeof next==='function'?next(values[index]):next;if(!Object.is(value,values[index])){values[index]=value;dirty=true;}}];}
export function useRef(initial){const index=cursor++;if(!(index in values))values[index]={current:initial};return values[index];}
export function useEffect(callback,deps){const index=cursor++,previous=effects.get(index);if(!previous||deps.length!==previous.deps.length||deps.some((value,i)=>!Object.is(value,previous.deps[i])))queue.push({index,callback,deps});}
export function flush(){for(const entry of queue.splice(0)){effects.get(entry.index)?.cleanup?.();effects.set(entry.index,{deps:entry.deps,cleanup:entry.callback()});}return dirty;}
export function unmount(){for(const entry of effects.values())entry.cleanup?.();effects.clear();active=false;}
export function lateUpdates(){return late;}`);
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX};
const modelFile=write('model',ts.transpileModule(readFileSync(new URL('../components/experience/model.ts',import.meta.url),'utf8'),{compilerOptions:options}).outputText);
const source=readFileSync(new URL('../components/experience/experience.tsx',import.meta.url),'utf8');
const start=source.indexOf('function NavigationSearch('),end=source.indexOf('\nfunction useNavigationEffects',start);
assert.ok(start>=0&&end>start,'production NavigationSearch must be located');
const componentFile=write('component',ts.transpileModule(`import {useState,useRef,useEffect} from './${hooksFile.split(/[/\\]/).at(-1)}';
import {searchSuggestions} from './${modelFile.split(/[/\\]/).at(-1)}';
const createPortal=children=>children;
const Search=()=>null,Star=()=>null,ChevronRight=()=>null,X=()=>null,Poster=()=>null;
export ${source.slice(start,end)}`,{compilerOptions:options}).outputText);
after(()=>{for(const path of files)try{unlinkSync(path);}catch{}});
const hooks=await import(pathToFileURL(hooksFile).href),{NavigationSearch}=await import(pathToFileURL(componentFile).href);

function walk(tree,callback){if(tree==null||typeof tree!=='object')return;if(Array.isArray(tree)){for(const child of tree)walk(child,callback);return;}callback(tree);walk(tree.props?.children,callback);}
function find(tree,predicate){let result=null;walk(tree,node=>{if(!result&&predicate(node))result=node;});return result;}
function text(tree){if(tree==null||typeof tree==='boolean')return'';if(typeof tree==='string'||typeof tree==='number')return String(tree);return Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const anime=(malId,title,extra={})=>({id:`mal-${malId}`,malId,title,original:title,synonyms:[],genres:['Aksiyon'],image:`https://cdn.myanimelist.net/images/anime/${malId}/poster.jpg`,format:'TV',year:2026,episodes:12,rating:8,members:1000,...extra});
const naruto=anime(20,'Naruto',{members:2000}),shippuden=anime(1735,'Naruto: Shippuuden'),bebop=anime(1,'Cowboy Bebop'),frieren=anime(52991,'Sousou no Frieren',{synonyms:['Frieren: Beyond Journey’s End']});

function setup(t){
  const previous=Object.fromEntries(['window','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout'].map(key=>[key,globalThis[key]]));
  const timers=new Map(),frames=new Map(),calls=[],details=[],events=[],refs=new Map();let number=0,tree=null,unmounted=false,visibleRefs=new Set();
  globalThis.setTimeout=(callback,delay)=>{const id=++number;timers.set(id,{callback,delay});return id;};
  globalThis.clearTimeout=id=>timers.delete(id);
  globalThis.requestAnimationFrame=callback=>{const id=++number;frames.set(id,callback);return id;};
  globalThis.cancelAnimationFrame=id=>frames.delete(id);
  globalThis.window={dispatchEvent:event=>{events.push(event.type);return true;},AnimeData:{searchAnime:(query,options)=>new Promise((resolve,reject)=>calls.push({query,options,resolve,reject}))}};
  const snapshot={catalog:[naruto,shippuden,bebop,frieren],schedule:[naruto],library:{savedAnime:{[naruto.id]:naruto}}};
  hooks.reset();
  function attach(){const next=new Set();walk(tree,node=>{const ref=node.props?.ref;if(!ref||typeof ref!=='object')return;next.add(ref);if(!refs.has(ref))refs.set(ref,{focuses:0,scrollTop:0,clientHeight:70,focus(){this.focuses++;},querySelector(){const options=[];walk(tree,option=>{if(option.props?.role==='option')options.push(option);});const selected=options.findIndex(option=>option.props['aria-selected']);return selected<0?null:{offsetTop:selected*70,offsetHeight:70,scrollIntoView(){assert.fail('keyboard selection must scroll only its list, never the document');}};}});ref.current=refs.get(ref);});for(const ref of visibleRefs)if(!next.has(ref))ref.current=null;visibleRefs=next;}
  const render=()=>{for(let count=0;count<10;count++){hooks.begin();tree=NavigationSearch({rail:{},snapshot,onDetail:item=>details.push(item)});attach();if(!hooks.flush())return tree;}assert.fail('component did not settle after effects');};
  const byId=id=>find(tree,node=>node.props?.id===id);
  const byLabel=label=>find(tree,node=>node.props?.['aria-label']===label);
  const unmount=()=>{if(!unmounted){hooks.unmount();unmounted=true;}};
  t.after(()=>{unmount();for(const[key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  render();
  return{calls,details,events,snapshot,render,byId,byLabel,unmount,
    open(){byLabel('Aramayı aç').props.onClick();render();for(const[id,callback]of [...frames]){frames.delete(id);callback();}return tree;},
    type(value){const input=byId('nav-anime-search');assert.ok(input);input.props.onChange({target:{value}});return render();},
    runDebounce(){for(const[id,entry]of [...timers])if(entry.delay===350){timers.delete(id);entry.callback();}},
    options(){const result=[];walk(tree,node=>{if(node.props?.role==='option')result.push(node);});return result;},
    key(key,extra={}){const input=byId('nav-anime-search'),form=byId('nav-search-panel');let prevented=false;form.props.onKeyDown({key,target:input.props.ref.current,nativeEvent:{isComposing:false},preventDefault(){prevented=true;},stopPropagation(){},...extra});render();return prevented;},
    submit(){byId('nav-search-panel').props.onSubmit({preventDefault(){}});return render();},
    toggleNode(){return byLabel('Aramayı aç').props.ref.current;},
  };
}

test('typing shows ranked local anime immediately and arrow keys plus Enter open the selected detail',t=>{
  const ui=setup(t);ui.open();ui.type('nar');
  assert.deepEqual(ui.options().map(option=>text(option.props.children)),[
    'NarutoTV · 2026 · 12 bölüm8.0','Naruto: ShippuudenTV · 2026 · 12 bölüm8.0',
  ]);
  assert.equal(ui.calls.length,0,'local results must not wait for the API debounce');
  const input=ui.byId('nav-anime-search');assert.equal(input.props.role,'combobox');assert.equal(input.props['aria-expanded'],true);
  assert.equal(ui.key('ArrowDown'),true);assert.equal(ui.options()[0].props['aria-selected'],true);
  assert.equal(ui.key('ArrowDown'),true);assert.equal(ui.byId('nav-anime-search').props['aria-activedescendant'],'nav-result-mal-1735');assert.equal(ui.byId('nav-search-results').props.ref.current.scrollTop,70,'only the suggestion viewport scrolls to the selected option');
  const toggle=ui.toggleNode();ui.submit();assert.equal(ui.details[0],shippuden);assert.equal(ui.byId('nav-search-panel'),null);assert.equal(toggle.focuses,1);
});

test('matching uses synonyms and Turkish-normalized genres, while Escape closes and restores focus',t=>{
  const ui=setup(t);ui.open();ui.type('Beyond Journey');assert.equal(ui.options()[0].props.id,'nav-result-mal-52991');
  ui.type('AKSİYON');assert.equal(ui.options().length,4,'the same anime from catalog, schedule and library appears only once');
  const toggle=ui.toggleNode();assert.equal(ui.key('Escape'),true);assert.equal(ui.byId('nav-search-panel'),null);assert.equal(toggle.focuses,1);assert.equal(ui.details.length,0);
});

test('changing the query aborts pending API work and late responses cannot replace current suggestions',async t=>{
  const ui=setup(t);ui.open();ui.type('nar');ui.runDebounce();assert.equal(ui.calls[0].query,'nar');
  ui.type('cow');assert.equal(ui.calls[0].options.signal.aborted,true);ui.runDebounce();assert.equal(ui.calls[1].query,'cow');
  const movie=anime(5,'Cowboy Bebop: Tengoku no Tobira',{format:'Movie'});ui.calls[1].resolve({anime:[movie]});await settle();ui.render();
  assert.deepEqual(ui.options().map(option=>option.props.id),['nav-result-mal-1','nav-result-mal-5']);
  ui.calls[0].resolve({anime:[anime(999,'Naruto stale result')]});await settle();ui.render();
  assert.deepEqual(ui.options().map(option=>option.props.id),['nav-result-mal-1','nav-result-mal-5']);assert.match(text(ui.byId('nav-search-status')),/2 öneri/);
});

test('closing or unmounting aborts requests and prevents completed work from reopening or updating the panel',async t=>{
  const ui=setup(t);ui.open();ui.type('nar');ui.runDebounce();const closedCall=ui.calls[0];ui.key('Escape');assert.equal(closedCall.options.signal.aborted,true);
  closedCall.resolve({anime:[anime(999,'Naruto stale result')]});await settle();assert.equal(ui.byId('nav-search-panel'),null);
  ui.open();assert.equal(ui.options().length,2,'reopening retains local matches without the closed request result');ui.runDebounce();const unmountedCall=ui.calls[1];ui.unmount();assert.equal(unmountedCall.options.signal.aborted,true);
  unmountedCall.resolve({anime:[anime(999,'Naruto stale result')]});await settle();assert.equal(hooks.lateUpdates(),0);
});

test('open, result count changes, and close notify navbar layout so suggestions can reserve their height',async t=>{
  const ui=setup(t);const initial=ui.events.length;ui.open();assert.ok(ui.events.length>initial);ui.type('cow');ui.runDebounce();const beforeResults=ui.events.length;
  ui.calls[0].resolve({anime:[anime(5,'Cowboy Bebop: Tengoku no Tobira')]});await settle();ui.render();assert.equal(ui.options().length,2);assert.ok(ui.events.length>beforeResults);
  const beforeClose=ui.events.length;ui.key('Escape');assert.ok(ui.events.length>beforeClose);assert.ok(ui.events.every(type=>type==='anime:navlayout'));
});
