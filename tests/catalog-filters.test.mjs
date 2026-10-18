import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

// Retain the real filter bridge, component handlers, dependencies and cleanup;
// replace React scheduling and DOM observation so this needs no browser.
const runtime=resolve('.sites-runtime');mkdirSync(runtime,{recursive:true});const files=[];
function write(name,source){const path=resolve(runtime,`catalog-filters-${name}-${process.pid}.mjs`);files.push(path);writeFileSync(path,source);return path;}
const hooksFile=write('hooks',`let values=[],cursor=0,effects=new Map(),queue=[],dirty=false;
export function reset(){values=[];cursor=0;effects=new Map();queue=[];dirty=false;}
export function begin(){cursor=0;dirty=false;}
export function useState(initial){const index=cursor++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return[values[index],next=>{const value=typeof next==='function'?next(values[index]):next;if(!Object.is(value,values[index])){values[index]=value;dirty=true;}}];}
export function useRef(initial){const index=cursor++;if(!(index in values))values[index]={current:initial};return values[index];}
export function useId(){const index=cursor++;return 'catalog-filter-'+index;}
export function useEffect(callback,deps){const index=cursor++,previous=effects.get(index);if(!previous||deps.length!==previous.deps.length||deps.some((value,i)=>!Object.is(value,previous.deps[i])))queue.push({index,callback,deps});}
export function flush(){for(const entry of queue.splice(0)){effects.get(entry.index)?.cleanup?.();effects.set(entry.index,{deps:entry.deps,cleanup:entry.callback()});}return dirty;}
export function unmount(){for(const entry of effects.values())entry.cleanup?.();effects.clear();}`);
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX};
const source=readFileSync(new URL('../components/experience/catalog-filters.tsx',import.meta.url),'utf8').replace("from 'react'",`from './${hooksFile.split(/[/\\]/).at(-1)}'`);
const componentFile=write('component',ts.transpileModule(`${source}\nexport {CatalogFilter};`,{compilerOptions:options}).outputText);
after(()=>{for(const path of files)try{unlinkSync(path);}catch{}});
const hooks=await import(pathToFileURL(hooksFile).href),{readCatalogFilter,changeCatalogFilter,CatalogFilter}=await import(pathToFileURL(componentFile).href);
const option=(value,label,disabled=false)=>({value,label,disabled});
class NativeSelect extends EventTarget{
  constructor(options,value=options[0].value){super();this.options=options;this.value=value;this.disabled=false;this.visible=true;}
  closest(){return{parentElement:{getClientRects:()=>this.visible?[{}]:[]}};}
}
function walk(tree,visit){if(tree==null||typeof tree!=='object')return;if(Array.isArray(tree)){for(const child of tree)walk(child,visit);return;}visit(tree);walk(tree.props?.children,visit);}
function find(tree,predicate){let result=null;walk(tree,node=>{if(!result&&predicate(node))result=node;});return result;}
function text(tree){if(tree==null||typeof tree==='boolean')return'';if(typeof tree==='string'||typeof tree==='number')return String(tree);return Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}
function setup(t,kind='genre'){
  const previous={window:globalThis.window,MutationObserver:globalThis.MutationObserver},observers=[],refs=new Map(),events=[];
  globalThis.window=new EventTarget();globalThis.MutationObserver=class{constructor(callback){this.callback=callback;this.connected=false;observers.push(this);}observe(){this.connected=true;}disconnect(){this.connected=false;}};
  const select=new NativeSelect(kind==='sort'?[option('popular','En popüler'),option('rating','Puana göre')]:[option('all','Tüm türler'),option('action','Aksiyon'),option('romance','Romantik'),option('romcom','Romantik Komedi'),option('disabled','Devre dışı',true)]);
  select.addEventListener('change',event=>events.push({value:select.value,bubbles:event.bubbles}));hooks.reset();let tree,unmounted=false;
  function render(){for(let count=0;count<8;count++){hooks.begin();tree=CatalogFilter({kind,select});walk(tree,node=>{const ref=node.props?.ref;if(!ref||typeof ref!=='object')return;if(!refs.has(ref))refs.set(ref,{focus(){},scrollTop:0,clientHeight:50,querySelector(){const rows=[];walk(tree,node=>{if(node.props?.role==='option')rows.push(node);});const index=rows.findIndex(node=>node.props['data-highlighted']);return index<0?null:{offsetTop:index*50,offsetHeight:50};}});ref.current=refs.get(ref);});if(!hooks.flush())return tree;}assert.fail('catalog filter effects did not settle');}
  const unmount=()=>{if(!unmounted){hooks.unmount();unmounted=true;}};
  t.after(()=>{unmount();for(const[key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  const input=()=>find(tree,node=>node.type==='input'),rows=()=>{const result=[];walk(tree,node=>{if(node.props?.role==='option')result.push(node);});return result;};render();
  return{select,events,observers,render,unmount,input,rows,tree:()=>tree,
    open(){tree.props.onOpenChange(true);return render();},
    type(value){input().props.onChange({target:{value}});return render();},
    key(key){let prevented=false;input().props.onKeyDown({key,nativeEvent:{isComposing:false},preventDefault(){prevented=true;}});render();return prevented;},
  };
}

test('catalog bridge snapshots native options and only emits changes for enabled valid values',()=>{
  const select=new NativeSelect([option('popular','En popüler'),option('rating','Puana göre'),option('locked','Kapalı',true)]),events=[];
  select.addEventListener('change',event=>events.push({value:select.value,bubbles:event.bubbles}));
  assert.deepEqual(readCatalogFilter(select),{value:'popular',disabled:false,options:[option('popular','En popüler'),option('rating','Puana göre'),option('locked','Kapalı',true)]});
  assert.equal(changeCatalogFilter(select,'rating'),true);assert.deepEqual(events,[{value:'rating',bubbles:true}]);
  for(const value of ['missing','locked'])assert.equal(changeCatalogFilter(select,value),false);
  select.disabled=true;assert.equal(changeCatalogFilter(select,'popular'),false);assert.equal(select.value,'rating');assert.equal(events.length,1);
});

test('actual genre filter follows external native changes and rebuilt genre options',t=>{
  const ui=setup(t);ui.open();assert.deepEqual(ui.rows().map(text),['Tüm türler','Aksiyon','Romantik','Romantik Komedi']);
  ui.select.value='action';ui.select.dispatchEvent(new Event('change'));ui.render();assert.match(text(ui.tree().props.children[0]),/Aksiyon/);
  ui.select.options=[option('all','Tüm türler'),option('scifi','Bilim Kurgu'),option('drama','Dram')];ui.select.value='all';ui.observers[0].callback();ui.render();
  assert.deepEqual(ui.rows().map(text),['Tüm türler','Bilim Kurgu','Dram']);assert.doesNotMatch(text(ui.tree()),/Romantik|Aksiyon/);
  ui.select.disabled=true;ui.observers[0].callback();ui.render();assert.equal(ui.tree().props.children[0].props.disabled,true);
});

test('genre search handles Turkish letters and keyboard choice updates the native filter and resets on close',t=>{
  const ui=setup(t);ui.open();ui.type('ROMANTİK');assert.deepEqual(ui.rows().map(text),['Romantik','Romantik Komedi']);
  assert.equal(ui.key('ArrowDown'),true);assert.equal(ui.rows()[0].props['data-highlighted'],true);assert.equal(ui.rows()[0].props['aria-selected'],false);assert.equal(ui.key('ArrowDown'),true);assert.equal(ui.rows()[1].props['data-highlighted'],true);
  assert.equal(ui.key('Enter'),true);assert.equal(ui.select.value,'romcom');assert.deepEqual(ui.events,[{value:'romcom',bubbles:true}]);assert.equal(ui.tree().props.open,false);
  ui.open();assert.equal(ui.input().props.value,'');assert.equal(ui.rows().length,4);assert.equal(ui.rows().some(row=>row.props['data-highlighted']),false);assert.equal(text(ui.rows().find(row=>row.props['aria-selected'])),'Romantik Komedi');
});

test('navigation closes genre search, hidden filters close on refresh, and unmount removes observers and listeners',t=>{
  const ui=setup(t);ui.open();ui.type('rom');window.dispatchEvent(new Event('anime:navigate'));ui.render();assert.equal(ui.tree().props.open,false);assert.equal(ui.input().props.value,'');
  ui.open();ui.select.visible=false;window.dispatchEvent(new Event('anime:viewrender'));ui.render();assert.equal(ui.tree().props.open,false);
  ui.unmount();assert.equal(ui.observers[0].connected,false);ui.select.options=[option('all','After unmount')];ui.select.dispatchEvent(new Event('change'));window.dispatchEvent(new Event('anime:librarychange'));ui.render();assert.doesNotMatch(text(ui.tree()),/After unmount/);
});
