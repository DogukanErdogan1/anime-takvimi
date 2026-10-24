import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

const directory=path.resolve('.sites-runtime');mkdirSync(directory,{recursive:true});
const files=[];
function write(name,source){const file=path.join(directory,`reviews-${name}-${process.pid}.mjs`);files.push(file);writeFileSync(file,source);return file;}
const hooksFile=write('hooks',`let values=[],cursor=0,effects=new Map(),queue=[],active=true,late=0;
export function reset(){values=[];cursor=0;effects=new Map();queue=[];active=true;late=0;}
export function begin(){cursor=0;}
export function useState(initial){const index=cursor++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return [values[index],next=>{if(!active)late++;values[index]=typeof next==='function'?next(values[index]):next;}];}
export function useRef(initial){const index=cursor++;if(!(index in values))values[index]={current:initial};return values[index];}
export function useEffect(callback,deps){const index=cursor++,previous=effects.get(index);if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))queue.push({index,callback,deps});}
export function flush(){for(const entry of queue.splice(0)){effects.get(entry.index)?.cleanup?.();effects.set(entry.index,{deps:entry.deps,cleanup:entry.callback()});}}
export function unmount(){for(const entry of effects.values())entry.cleanup?.();effects.clear();active=false;}
export function lateUpdates(){return late;}`);
const source=readFileSync(new URL('../components/experience/detail-profile.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('detail-profile.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=new Set(['Reviews','api','avatarUrl','initial','dateLabel','userCanEdit']);
const functions=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.has(node.name?.text)).map(node=>node.getText(ast));
assert.equal(functions.length,names.size,'exercise the actual production functions');
const icons=ast.statements.find(node=>ts.isImportDeclaration(node)&&node.moduleSpecifier.text==='lucide-react').getText(ast);
const code=`import {useState,useRef,useEffect} from './${path.basename(hooksFile)}';\n${icons}\n${functions.join('\n')}`;
const componentFile=write('component',ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText);
const hooks=await import(pathToFileURL(hooksFile).href),{Reviews}=await import(pathToFileURL(componentFile).href);
after(()=>{for(const file of files)try{unlinkSync(file);}catch{}});
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
const review=(patch={})=>({id:'review-own',userId:'owner',displayName:'rinrintan',body:'Mevcut yorum',spoiler:false,score:8,createdAt:'2026-10-24T09:00:00Z',...patch});
const page=reviews=>({reviews,total:reviews.length,average:null});
function find(tree,predicate){if(!tree||typeof tree!=='object')return null;if(Array.isArray(tree)){for(const child of tree){const result=find(child,predicate);if(result)return result;}return null;}return predicate(tree)?tree:find(tree.props?.children,predicate);}
function all(tree,predicate){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(child=>all(child,predicate));return [...(predicate(tree)?[tree]:[]),...all(tree.props?.children,predicate)];}
function text(tree){if(tree==null||typeof tree==='boolean')return '';if(typeof tree==='string'||typeof tree==='number')return String(tree);return Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}
function setup(t,{fetcher=async()=>response(page([])),guest=false}={}){
  hooks.reset();let closed=false;
  const previous={fetch:globalThis.fetch,window:globalThis.window};
  globalThis.window={location:{origin:'http://localhost:5173'}};
  const requests=[];
  globalThis.fetch=async(url,options={})=>{const request={url:String(url),...options,payload:options.body?JSON.parse(options.body):undefined};requests.push(request);return fetcher(request);};
  const snapshot={ready:true,blocked:false,libraryLoading:false,accountScope:guest?null:'owner',account:guest?null:{authenticated:true,registered:true,user:{id:'owner',displayName:'rinrintan',role:'member',status:'active',avatarUrl:'/api/account/avatar?v=1'}},library:{scores:{}}};
  const props={item:{id:'mal-1',malId:1},snapshot};
  const render=()=>{let tree;for(let i=0;i<3;i++){hooks.begin();tree=Reviews(props);hooks.flush();}return tree;};
  const button=(label)=>{const node=find(render(),node=>node.type==='button'&&(text(node)===label||node.props['aria-label']===label));assert.ok(node,`button ${label} exists`);return node;};
  const unmount=()=>{if(!closed){hooks.unmount();closed=true;}};
  t.after(()=>{unmount();globalThis.fetch=previous.fetch;if(previous.window===undefined)delete globalThis.window;else globalThis.window=previous.window;});
  render();
  return {render,requests,props,button,unmount,async loaded(){render();await flush();render();await flush();return render();},type(value){find(render(),node=>node.type==='textarea').props.onChange({target:{value}});},spoiler(value){find(render(),node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:value}});},submit(){return find(render(),node=>node.type==='form').props.onSubmit({preventDefault(){}});}};
}

test('existing review enters explicit editing with its text, spoiler and original score',async t=>{
 const own=review({spoiler:true});const ui=setup(t,{fetcher:async()=>response(page([own]))});await ui.loaded();
 const field=find(ui.render(),node=>node.type==='textarea');assert.equal(field.props.value,own.body);
 assert.equal(find(ui.render(),node=>node.type==='input').props.checked,true);
 assert.equal(ui.button('Yorumu güncelle').props.disabled,true);
 assert.match(text(ui.render()),/Yorumunu düzenle/);assert.match(text(ui.render()),/2\.000/);
 assert.ok(find(ui.render(),node=>node.type==='img'&&node.props.src.startsWith('/api/account/avatar')));
});

test('a user draft is retained if the original comment arrives late or loading is retried',async t=>{
 let first;let count=0;const own=review();
 const ui=setup(t,{fetcher:async()=>{if(++count===1)return new Promise(resolve=>{first=resolve;});return response(page([own]));}});
 ui.type('Kaybolmaması gereken yeni taslak');first(response({error:{message:'Bağlantı kesildi'}},503));await ui.loaded();
 await ui.button('Tekrar dene').props.onClick();await ui.loaded();
 assert.equal(find(ui.render(),node=>node.type==='textarea').props.value,'Kaybolmaması gereken yeni taslak');
 assert.match(text(ui.render()),/Yorumu güncelle/);
});

test('saving an edit preserves score and spoiler, and a fast second submit makes one request',async t=>{
 const own=review({spoiler:true});let complete;const ui=setup(t,{fetcher:async request=>request.method==='POST'?new Promise(resolve=>{complete=resolve;}):response(page([own]))});await ui.loaded();
 ui.type('Güncellenmiş yorum');const form=find(ui.render(),node=>node.type==='form');
 const first=form.props.onSubmit({preventDefault(){}}),second=form.props.onSubmit({preventDefault(){}});
 assert.equal(ui.requests.filter(request=>request.method==='POST').length,1);
 const posted=ui.requests.find(request=>request.method==='POST');assert.deepEqual(posted.payload,{body:'Güncellenmiş yorum',spoiler:true,score:8});assert.equal(posted.credentials,'same-origin');
 complete(response({review:{...own,body:'Güncellenmiş yorum'}}));await Promise.all([first,second]);
 assert.match(text(ui.render()),/Yorumun kaydedildi/);
});

test('failed submissions retain the draft and spoiler selection for retry',async t=>{
 const ui=setup(t,{fetcher:async request=>request.method==='POST'?response({error:{message:'Kaydedilemedi'}},503):response(page([]))});await ui.loaded();
 ui.type('Taslak metni');ui.spoiler(true);await ui.submit();
 assert.equal(find(ui.render(),node=>node.type==='textarea').props.value,'Taslak metni');
 assert.equal(find(ui.render(),node=>node.type==='input').props.checked,true);
 assert.match(text(ui.render()),/Kaydedilemedi/);assert.equal(ui.button('Yorumu paylaş').props.disabled,false);
});

test('spoiler content is initially hidden, can be revealed, and can be hidden again',async t=>{
 const other=review({userId:'other',body:'Gizli olay örgüsü',spoiler:true});const ui=setup(t,{fetcher:async()=>response(page([other]))});await ui.loaded();
 assert.doesNotMatch(text(ui.render()),/Gizli olay örgüsü/);
 find(ui.render(),node=>node.props?.className==='at-spoiler-button').props.onClick();
 assert.match(text(ui.render()),/Gizli olay örgüsü/);
 ui.button('Spoileri yeniden gizle').props.onClick();
 assert.doesNotMatch(text(ui.render()),/Gizli olay örgüsü/);
 assert.equal(ui.requests.length,1);
});

test('review removal requires explicit confirmation and cancelling performs no mutation',async t=>{
 const own=review();const ui=setup(t,{fetcher:async request=>request.method==='PATCH'?response({hidden:true}):response(page([own]))});await ui.loaded();
 ui.button('Bu yorumu kaldır').props.onClick();assert.equal(ui.requests.length,1);
 assert.match(text(ui.render()),/İşlemi bu ekrandan geri alamazsın/);
 const confirm=find(ui.render(),node=>node.props?.className==='at-review-remove-confirm');
 find(confirm,node=>node.type==='button'&&text(node)==='Vazgeç').props.onClick();assert.equal(ui.requests.length,1);
 ui.button('Bu yorumu kaldır').props.onClick();await ui.button('Yorumu kaldır').props.onClick();await ui.loaded();
 assert.equal(ui.requests.filter(request=>request.method==='PATCH').length,1);
 assert.deepEqual(ui.requests.find(request=>request.method==='PATCH').payload,{hidden:true});
 assert.match(text(ui.render()),/Yorumun yayından kaldırıldı/);
 assert.equal(find(ui.render(),node=>node.type==='form'),null);
});

test('load more appends the next page without duplicate cards',async t=>{
 const initial=Array.from({length:20},(_,i)=>review({id:'r'+i,userId:'u'+i}));
 const ui=setup(t,{fetcher:async request=>response(request.url.includes('page=2')?{reviews:[initial[19],review({id:'r20',userId:'u20'})],total:21,average:8}:{reviews:initial,total:21,average:8})});await ui.loaded();
 await ui.button('Daha fazla yorum').props.onClick();await ui.loaded();
 assert.equal(all(ui.render(),node=>node.type==='article'&&node.props.className==='at-review').length,21);
 assert.equal(find(ui.render(),node=>node.type==='button'&&text(node)==='Daha fazla yorum'),null);
 assert.ok(ui.requests.some(request=>request.url.includes('page=2&limit=20')));
});

test('guests cannot compose, edit, or remove comments',async t=>{
 const ui=setup(t,{guest:true,fetcher:async()=>response(page([review()]))});await ui.loaded();
 assert.equal(find(ui.render(),node=>node.type==='form'),null);
 assert.equal(find(ui.render(),node=>node.props?.['aria-label']==='Bu yorumu kaldır'),null);
});

test('an old anime response cannot overwrite the new anime draft',async t=>{
 let old;const ui=setup(t,{fetcher:async request=>request.url.includes('/anime/1/')?new Promise(resolve=>{old=resolve;}):response(page([]))});
 ui.props.item={id:'mal-2',malId:2};ui.render();await ui.loaded();ui.type('İkinci anime taslağı');
 old(response(page([review({body:'Eski animenin yorumu'})])));await ui.loaded();
 assert.equal(find(ui.render(),node=>node.type==='textarea').props.value,'İkinci anime taslağı');
 assert.doesNotMatch(text(ui.render()),/Eski animenin yorumu/);
});

test('an unmounted composer ignores a pending save completion',async t=>{
 let done;const ui=setup(t,{fetcher:async request=>request.method==='POST'?new Promise(resolve=>{done=resolve;}):response(page([]))});await ui.loaded();
 ui.type('Yorum metni');const saving=ui.submit();ui.unmount();done(response({review:review({body:'Yorum metni'})}));await saving;
 assert.equal(hooks.lateUpdates(),0);
});
