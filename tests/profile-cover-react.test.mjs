import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

const runtime=resolve('.sites-runtime');mkdirSync(runtime,{recursive:true});const files=[];
function write(name,source){const file=resolve(runtime,`profile-cover-react-${name}-${process.pid}.mjs`);files.push(file);writeFileSync(file,source);return file;}
// Seed an already loaded profile, while retaining state/refs, dependency-aware
// effects and their cleanup. The handlers below are the production component's.
const hookSource=`let values=[],cursor=0,loaded=null,library=null,effects=new Map(),queue=[],active=true,late=0;export function reset(profile,data){values=[];cursor=0;loaded=profile;library=data;effects=new Map();queue=[];active=true;late=0;}export function begin(){cursor=0;}export function useState(initial){const index=cursor++;if(!(index in values))values[index]=index===0?loaded:index===1?library:typeof initial==='function'?initial():initial;return[values[index],next=>{if(!active)late++;values[index]=typeof next==='function'?next(values[index]):next;}];}export function useRef(initial){const index=cursor++;if(!(index in values))values[index]={current:initial};return values[index];}export function useMemo(callback){cursor++;return callback();}export function useEffect(callback,deps){const index=cursor++;const previous=effects.get(index);if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i]))){queue.push({index,callback,deps});}}export function flush(){for(const entry of queue.splice(0)){const previous=effects.get(entry.index);previous?.cleanup?.();const cleanup=entry.callback.toString().includes('setProfile(null)')?null:entry.callback();effects.set(entry.index,{deps:entry.deps,cleanup});}}export function setLoaded(profile){values[0]=profile;}export function unmount(){for(const value of effects.values())value.cleanup?.();effects.clear();active=false;}export function lateUpdates(){return late;}`;
const hooksFile=write('hooks',hookSource),options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX};
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
const hooks=await import(pathToFileURL(hooksFile).href),{ProfileView}=await import(pathToFileURL(componentFile).href);
const revision='12345678-1234-4123-8123-123456789abc',ownCover=`/api/profile/cover?v=${revision}`;
const anime={id:'mal-1',malId:1,title:'API anime',image:'https://cdn.myanimelist.net/images/anime/1/1.jpg',genres:['Aksiyon'],episodes:12};
const library=()=>({saved:['mal-1'],reminders:[],progress:{},view:'grid',savedAnime:{'mal-1':anime},tracking:{},scores:{},favorites:['mal-1'],collections:[]});
function find(tree,predicate){if(!tree||typeof tree!=='object')return null;if(Array.isArray(tree)){for(const child of tree){const match=find(child,predicate);if(match)return match;}return null;}if(predicate(tree))return tree;return find(tree.props?.children,predicate);}
function text(tree){if(tree==null||typeof tree==='boolean')return'';if(typeof tree==='string'||typeof tree==='number')return String(tree);return Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function setup(t,{coverUrl=null,avatarFrame='none',publicUserId,fetcher=async()=>response({coverUrl:ownCover})}={}){
  const previous={window:globalThis.window,fetch:globalThis.fetch,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
  const requests=[],revoked=[],events=[];let number=0;
  globalThis.window={location:{origin:'http://localhost:5174'},addEventListener(){},removeEventListener(){},dispatchEvent(event){events.push(event);}};
  globalThis.fetch=(path,options)=>{requests.push({path,options});return fetcher(path,options);};
  URL.createObjectURL=()=>`blob:http://localhost:5174/preview-${++number}`;URL.revokeObjectURL=value=>revoked.push(value);
  const snapshot={ready:true,page:'profile',catalog:[],schedule:[],library:library(),account:{authenticated:true,registered:true,user:{id:'owner',displayName:'Owner',role:'member',status:'active'}},accountScope:'owner',loading:false,error:null,libraryLoading:false,blocked:false};
  const profile={id:publicUserId||'owner',displayName:publicUserId?'Public member':'Owner',bio:'',isPublic:Boolean(publicUserId),coverUrl,avatarFrame};
  hooks.reset(profile,library());let unmounted=false;
  const render=()=>{let tree;for(let i=0;i<3;i++){hooks.begin();tree=ProfileView({snapshot,publicUserId,onClose(){},onOpenDetail(){},onChange(){}});hooks.flush();}return tree;};
  const unmount=()=>{if(!unmounted){hooks.unmount();unmounted=true;}};
  t.after(()=>{unmount();if(previous.window===undefined)delete globalThis.window;else globalThis.window=previous.window;globalThis.fetch=previous.fetch;URL.createObjectURL=previous.create;URL.revokeObjectURL=previous.revoke;});
  return {render,requests,revoked,events,snapshot,unmount,select(file){const input=find(render(),node=>node.props?.id==='at-profile-cover-file');assert.ok(input);const currentTarget={files:[file],value:'chosen'};input.props.onChange({currentTarget});assert.equal(currentTarget.value,'');return render();},button(tree,label){const button=find(tree,node=>node.type==='button'&&text(node)===label);assert.ok(button,`actual button ${label} must be rendered`);return button;}};
}
const file=(type='image/png',size=20)=>new File([new Uint8Array(size)],'my-cover.png',{type});
const picture=tree=>find(find(tree,node=>node.props?.className?.startsWith('at-profile-cover-strip')),node=>node.type==='img');

test('library view preference survives remount and stays isolated per viewer account',t=>{
  const ui=setup(t),storage=new Map([['anime-takvimi-profile-library-view-v1:owner','classic']]);
  window.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  let tree=ui.render();
  assert.equal(find(tree,node=>node.props?.title==='Eski afiş tasarımı').props['aria-pressed'],true);
  find(tree,node=>node.props?.title==='Yeni sinematik tasarım').props.onClick();tree=ui.render();
  assert.equal(storage.get('anime-takvimi-profile-library-view-v1:owner'),'cinema');
  find(tree,node=>node.props?.title==='Eski afiş tasarımı').props.onClick();
  hooks.reset({id:'owner',displayName:'Owner',bio:'',isPublic:false},library());tree=ui.render();
  assert.equal(find(tree,node=>node.props?.title==='Eski afiş tasarımı').props['aria-pressed'],true);
  ui.snapshot.account.user.id='another';ui.snapshot.accountScope='another';tree=ui.render();
  assert.equal(find(tree,node=>node.props?.title==='Yeni sinematik tasarım').props['aria-pressed'],true);
  assert.equal(storage.get('anime-takvimi-profile-library-view-v1:owner'),'classic');
});

test('blocked browser storage leaves both library view choices usable',t=>{
  const ui=setup(t);
  window.localStorage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  let tree=ui.render();
  find(tree,node=>node.props?.title==='Eski afiş tasarımı').props.onClick();tree=ui.render();
  assert.equal(find(tree,node=>node.props?.title==='Eski afiş tasarımı').props['aria-pressed'],true);
  find(tree,node=>node.props?.title==='Yeni sinematik tasarım').props.onClick();tree=ui.render();
  assert.equal(find(tree,node=>node.props?.title==='Yeni sinematik tasarım').props['aria-pressed'],true);
});

test('selected image previews locally and cancel restores the API cover without upload',t=>{
  const ui=setup(t);const tree=ui.select(file());assert.match(picture(tree).props.src,/^blob:/);assert.match(text(tree),/Kapak önizlemesi/);assert.equal(ui.requests.length,0);
  ui.button(tree,'Vazgeç').props.onClick();const after=ui.render();assert.equal(picture(after).props.src,anime.image);assert.ok(ui.revoked.includes('blob:http://localhost:5174/preview-1'));assert.equal(ui.requests.length,0);
});

test('invalid type, empty or oversized files never upload or retain an old draft',t=>{
  const ui=setup(t);
  for(const invalid of [file('image/svg+xml'),file('image/png',0),file('image/png',2*1024*1024+1)]){ui.select(file());const tree=ui.select(invalid);assert.equal(picture(tree).props.src,anime.image);assert.ok(find(tree,node=>node.props?.role==='alert'));assert.doesNotMatch(text(tree),/Kapak önizlemesi/);}
  assert.equal(ui.requests.length,0);assert.equal(ui.revoked.length,3);
});

test('upload sends raw file with its MIME type and shows success only after accepted safe URL',async t=>{
  let complete;const ui=setup(t,{fetcher:()=>new Promise(resolve=>{complete=resolve;})});const chosen=file('image/webp');const tree=ui.select(chosen);
  const save=ui.button(tree,'Kapağı kaydet');save.props.onClick();save.props.onClick();assert.equal(ui.requests.length,1);assert.equal(ui.requests[0].options.body,chosen);assert.equal(ui.requests[0].options.headers['Content-Type'],'image/webp');assert.equal(ui.requests[0].options.credentials,'same-origin');assert.equal(ui.requests[0].options.cache,'no-store');
  assert.match(text(ui.render()),/Yükleniyor/);assert.doesNotMatch(text(ui.render()),/Kapak görselin kaydedildi/);
  complete(response({coverUrl:ownCover}));await flush();const after=ui.render();assert.equal(picture(after).props.src,ownCover);assert.match(text(after),/Kapak görselin kaydedildi/);assert.doesNotMatch(text(after),/Kapak önizlemesi/);assert.equal(ui.revoked.length,1);
});

test('server failure keeps the preview available for retry and never claims success',async t=>{
  const ui=setup(t,{fetcher:async()=>response({error:{message:'Görsel hizmeti hazır değil.'}},503)});let tree=ui.select(file());ui.button(tree,'Kapağı kaydet').props.onClick();await flush();tree=ui.render();assert.match(text(tree),/Görsel hizmeti hazır değil/);assert.match(text(tree),/Kapak önizlemesi/);assert.match(picture(tree).props.src,/^blob:/);assert.doesNotMatch(text(tree),/Kapak görselin kaydedildi/);assert.equal(ui.button(tree,'Kapağı kaydet').props.disabled,false);
});

test('stored cover takes priority and removing it restores automatic API artwork',async t=>{
  const ui=setup(t,{coverUrl:ownCover,fetcher:async()=>response({coverUrl:null})});let tree=ui.render();assert.equal(picture(tree).props.src,ownCover);ui.button(tree,'Kaldır').props.onClick();await flush();tree=ui.render();assert.equal(ui.requests[0].options.method,'DELETE');assert.equal(ui.requests[0].options.body,undefined);assert.equal(picture(tree).props.src,anime.image);assert.match(text(tree),/Yüklediğin kapak kaldırıldı/);assert.doesNotMatch(text(tree),/Kaldır/);
});

test('unsafe response URLs are rejected and stored image errors fall back safely',async t=>{
  const ui=setup(t,{coverUrl:ownCover,fetcher:async()=>response({coverUrl:'https://evil.example/image.png'})});let tree=ui.render();picture(tree).props.onError();tree=ui.render();assert.equal(picture(tree).props.src,anime.image);
  tree=ui.select(file());ui.button(tree,'Kapağı kaydet').props.onClick();await flush();tree=ui.render();assert.match(text(tree),/geçerli bir sunucu yanıtı alınamadı/);assert.doesNotMatch(text(tree),/Kapak görselin kaydedildi/);assert.match(picture(tree).props.src,/^blob:/);
});

test('public profile only accepts its own revision URL and exposes no upload controls',t=>{
  const publicUserId='public-member';const publicCover=`/api/profiles/${publicUserId}/cover?v=${revision}`;const ui=setup(t,{coverUrl:publicCover,publicUserId});const tree=ui.render();assert.equal(picture(tree).props.src,publicCover);assert.equal(find(tree,node=>node.props?.id==='at-profile-cover-file'),null);assert.equal(framePicker(tree),null);assert.doesNotMatch(text(tree),/Kapağı değiştir|Kapak görseli yükle|Kaldır/);
});

test('public cover paths cannot point at private, other-profile or malformed revisions',t=>{
  const publicUserId='public-member',ui=setup(t,{publicUserId});
  for(const coverUrl of [ownCover,`/api/profiles/someone-else/cover?v=${revision}`,`/api/profiles/${publicUserId}/cover?v=invalid`,`/api/profiles/${publicUserId}/cover?v=${revision}&extra=yes`,'https://evil.example/image.png']){
    hooks.setLoaded({id:publicUserId,displayName:'Public member',bio:'',isPublic:true,coverUrl});assert.equal(picture(ui.render()).props.src,anime.image);
  }
});

test('stale bio-save response cannot replace a cover uploaded while the profile save was pending',async t=>{
  let completeBio,completeCover;const ui=setup(t,{fetcher:(path)=>new Promise(resolve=>{if(path==='/api/profile')completeBio=resolve;else completeCover=resolve;})});
  ui.button(ui.render(),'Profili düzenle').props.onClick();let tree=ui.render();find(tree,node=>node.props?.id==='at-profile-bio').props.onChange({target:{value:'Updated biography'}});tree=ui.render();const form=find(tree,node=>node.type==='form'&&node.props.className==='at-profile-edit');const saveBio=form.props.onSubmit({preventDefault(){}});
  tree=ui.select(file());ui.button(tree,'Kapağı kaydet').props.onClick();completeCover(response({coverUrl:ownCover}));await flush();assert.equal(picture(ui.render()).props.src,ownCover);
  completeBio(response({profile:{id:'owner',displayName:'Owner',bio:'Updated biography',isPublic:false,coverUrl:null}}));await saveBio;tree=ui.render();assert.equal(picture(tree).props.src,ownCover);assert.match(text(tree),/Updated biography/);
});

test('account switch aborts the old upload and ignores a late successful response',async t=>{
  let complete;const ui=setup(t,{fetcher:()=>new Promise(resolve=>{complete=resolve;})});const tree=ui.select(file());ui.button(tree,'Kapağı kaydet').props.onClick();const signal=ui.requests[0].options.signal;
  ui.snapshot.account.user.id='other';ui.snapshot.accountScope='other';hooks.setLoaded({id:'other',displayName:'Other account',bio:'',isPublic:false,coverUrl:null});ui.render();assert.equal(signal.aborted,true);complete(response({coverUrl:ownCover}));await flush();const after=ui.render();assert.match(text(after),/Other account/);assert.doesNotMatch(text(after),/Kapak görselin kaydedildi/);assert.equal(picture(after).props.src,anime.image);assert.equal(ui.revoked.length,1);
});

test('unmount aborts pending upload, revokes preview and blocks late state updates',async t=>{
  let complete;const ui=setup(t,{fetcher:()=>new Promise(resolve=>{complete=resolve;})});const tree=ui.select(file());ui.button(tree,'Kapağı kaydet').props.onClick();const signal=ui.requests[0].options.signal;ui.unmount();assert.equal(signal.aborted,true);assert.equal(ui.revoked.length,1);complete(response({coverUrl:ownCover}));await flush();assert.equal(hooks.lateUpdates(),0);
});

const framePicker=tree=>find(tree,node=>node.props?.userId&&typeof node.props?.onSave==='function');

test('frame selection commits only an accepted allowlisted API value and announces the same account',async t=>{
  let complete;const ui=setup(t,{fetcher:()=>new Promise(resolve=>{complete=resolve;})});const signal=new AbortController().signal;
  const pending=framePicker(ui.render()).props.onSave('koi',signal);assert.equal(framePicker(ui.render()).props.frameId,'none');assert.equal(ui.events.length,0);
  assert.equal(ui.requests[0].path,'/api/profile/frame');assert.equal(ui.requests[0].options.method,'PUT');assert.deepEqual(JSON.parse(ui.requests[0].options.body),{frameId:'koi'});assert.equal(ui.requests[0].options.signal,signal);assert.equal(ui.requests[0].options.credentials,'same-origin');assert.equal(ui.requests[0].options.cache,'no-store');
  complete(response({avatarFrame:'koi'}));assert.equal(await pending,'koi');assert.equal(framePicker(ui.render()).props.frameId,'koi');assert.match(text(ui.render()),/Profil çerçeven kaydedildi/);assert.equal(ui.events.length,1);assert.equal(ui.events[0].type,'anime:avatarframechange');assert.deepEqual(ui.events[0].detail,{userId:'owner',frameId:'koi'});
});

test('unknown requests, mismatched responses and server errors never change the stored frame',async t=>{
  let result=response({avatarFrame:'platin'});const ui=setup(t,{avatarFrame:'platin',fetcher:async()=>result});const signal=new AbortController().signal;
  await assert.rejects(framePicker(ui.render()).props.onSave('../evil',signal),/hesabına giriş/);assert.equal(ui.requests.length,0);
  for(const invalid of [response({avatarFrame:'not-a-frame'}),response({avatarFrame:'platin'}),response({error:{message:'Kaydedilemiyor.'}},503)]){
    result=invalid;await assert.rejects(framePicker(ui.render()).props.onSave('koi',signal));assert.equal(framePicker(ui.render()).props.frameId,'platin');assert.doesNotMatch(text(ui.render()),/Profil çerçeven kaydedildi/);assert.equal(ui.events.length,0);
  }
});

test('removing a frame persists the explicit none value',async t=>{
  const ui=setup(t,{avatarFrame:'platin',fetcher:async()=>response({avatarFrame:'none'})});assert.equal(await framePicker(ui.render()).props.onSave('none',new AbortController().signal),'none');assert.deepEqual(JSON.parse(ui.requests[0].options.body),{frameId:'none'});assert.equal(framePicker(ui.render()).props.frameId,'none');assert.match(text(ui.render()),/Profil çerçeven kaldırıldı/);
});

test('a late frame response after abort or account replacement cannot announce or replace the next account frame',async t=>{
  let complete;const ui=setup(t,{fetcher:()=>new Promise(resolve=>{complete=resolve;})});const controller=new AbortController();const pending=framePicker(ui.render()).props.onSave('koi',controller.signal);
  controller.abort();ui.snapshot.account.user.id='other';ui.snapshot.accountScope='other';hooks.setLoaded({id:'other',displayName:'Other account',bio:'',isPublic:false,avatarFrame:'platin'});ui.render();complete(response({avatarFrame:'koi'}));await assert.rejects(pending,{name:'AbortError'});assert.equal(framePicker(ui.render()).props.frameId,'platin');assert.equal(ui.events.length,0);assert.doesNotMatch(text(ui.render()),/Profil çerçeven kaydedildi/);
});

test('a stale biography save retains a frame accepted while the biography request was pending',async t=>{
  let completeBio,completeFrame;const ui=setup(t,{fetcher:path=>new Promise(resolve=>{if(path==='/api/profile')completeBio=resolve;else completeFrame=resolve;})});
  ui.button(ui.render(),'Profili düzenle').props.onClick();let tree=ui.render();find(tree,node=>node.props?.id==='at-profile-bio').props.onChange({target:{value:'My biography'}});tree=ui.render();const form=find(tree,node=>node.type==='form'&&node.props.className==='at-profile-edit');const saveBio=form.props.onSubmit({preventDefault(){}});
  const pending=framePicker(ui.render()).props.onSave('koi',new AbortController().signal);completeFrame(response({avatarFrame:'koi'}));await pending;assert.equal(framePicker(ui.render()).props.frameId,'koi');
  completeBio(response({profile:{id:'owner',displayName:'Owner',bio:'My biography',isPublic:false,avatarFrame:'none'}}));await saveBio;assert.equal(framePicker(ui.render()).props.frameId,'koi');assert.match(text(ui.render()),/My biography/);
});
