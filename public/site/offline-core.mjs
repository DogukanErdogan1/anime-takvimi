export const emptyLibrary=()=>({saved:[],reminders:[],savedAnime:{},progress:{},tracking:{},scores:{},favorites:[],collections:[],view:'grid'});
export const clone=value=>JSON.parse(JSON.stringify(value));
const own=(value,key)=>value&&Object.hasOwn(value,key)?value[key]:undefined;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':object(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
export const equal=(a,b)=>canonical(a)===canonical(b);
export function cleanLibrary(value){
 if(!object(value)||new TextEncoder().encode(JSON.stringify(value)).length>1048576)throw Error('Çevrimdışı liste okunamadı veya boyut sınırını aşıyor.');
 const clean={...emptyLibrary(),...clone(value)},valid=id=>typeof id==='string'&&/^mal-[1-9]\d{0,9}$/.test(id);
 for(const field of ['saved','reminders','favorites'])if(!Array.isArray(clean[field])||clean[field].length>500||!clean[field].every(valid))throw Error('Çevrimdışı listede geçersiz anime var.');
 if(!object(clean.savedAnime)||Object.keys(clean.savedAnime).length>500)throw Error('Çevrimdışı liste geçersiz.');
 for(const [id,item] of Object.entries(clean.savedAnime))if(!valid(id)||!object(item)||item.id!==id||typeof item.title!=='string'||item.title.length>500)throw Error('Çevrimdışı anime bilgisi geçersiz.');
 for(const [field,max] of [['progress',9999],['scores',10]])if(!object(clean[field])||Object.entries(clean[field]).some(([id,n])=>!valid(id)||!Number.isInteger(n)||n<0||n>max))throw Error('Bölüm veya puan bilgisi geçersiz.');
 if(!object(clean.tracking)||Object.entries(clean.tracking).some(([id,s])=>!valid(id)||!['watching','planned','completed','dropped'].includes(s)))throw Error('İzleme durumu geçersiz.');
 if(!Array.isArray(clean.collections)||clean.collections.length>100||!['grid','list'].includes(clean.view))throw Error('Liste tercihleri geçersiz.');
 return clean;
}
const setMap=values=>Object.fromEntries((values||[]).map(id=>[id,true]));
function tree(lib){const value=clone(lib);for(const key of ['saved','reminders','favorites'])value[key]=setMap(value[key]);value.collections=Object.fromEntries((value.collections||[]).map(c=>[c.id,{...c,animeIds:setMap(c.animeIds)}]));value.activity=Object.fromEntries((value.activity||[]).map(e=>[e.id,e]));return value;}
function fromTree(value){for(const key of ['saved','reminders','favorites'])value[key]=Object.keys(value[key]||{}).filter(id=>value[key][id]);value.collections=Object.values(value.collections||{}).map(c=>({...c,animeIds:Object.keys(c.animeIds||{}).filter(id=>c.animeIds[id])}));value.activity=Object.values(value.activity||{}).sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id)).slice(0,500);return value;}
export function mergeOffline(baseValue,localValue,remoteValue,choice){
 const base=cleanLibrary(baseValue),local=cleanLibrary(localValue),remote=cleanLibrary(remoteValue),conflicts=[];
 const labels={progress:'Bölüm ilerlemesi',tracking:'İzleme durumu',scores:'Puan',favorites:'Favori',episodeNotes:'Özel bölüm notu',collections:'Koleksiyon',homeLayout:'Ana sayfa düzeni',view:'Liste görünümü',reminders:'Hatırlatma',saved:'Listedeki kayıt'};
 const conflict=path=>{const id=path.find(p=>/^mal-\d+$/.test(p)),title=(local.savedAnime[id]||remote.savedAnime[id]||base.savedAnime[id])?.title;return {path:path.join('/'),label:(title?title+' · ':'')+(labels[path[0]]||'Liste ayarı')};};
 function merge(b,l,r,path=[]){
  if(equal(l,b))return r;if(equal(r,b)||equal(l,r))return l;
  if(path[0]==='savedAnime')return r===undefined?l:r;
  if(object(l)&&object(r)&&(b===undefined||object(b))){const pairs=[];for(const key of new Set([...Object.keys(b||{}),...Object.keys(l),...Object.keys(r)])){const v=merge(own(b,key),own(l,key),own(r,key),[...path,key]);if(v!==undefined)pairs.push([key,v]);}return Object.fromEntries(pairs);}
  conflicts.push(conflict(path));return choice==='remote'?r:l;
 }
 const merged=fromTree(merge(tree(base),tree(local),tree(remote)));
 const entryChanged=(a,b,id)=>['progress','tracking','scores','episodeNotes'].some(f=>!equal(own(a[f],id),own(b[f],id)))||a.favorites.includes(id)!==b.favorites.includes(id);
 for(const id of base.saved){const deletedLocal=!local.saved.includes(id)&&remote.saved.includes(id)&&entryChanged(base,remote,id),deletedRemote=!remote.saved.includes(id)&&local.saved.includes(id)&&entryChanged(base,local,id);if(!deletedLocal&&!deletedRemote)continue;
  conflicts.push({path:'entry/'+id,label:(local.savedAnime[id]||remote.savedAnime[id]||base.savedAnime[id])?.title+' · Diğer cihazda listeden kaldırılmış'});
  const source=choice==='remote'?remote:local;merged.saved=merged.saved.filter(v=>v!==id);if(source.saved.includes(id))merged.saved.push(id);
  for(const field of ['savedAnime','progress','tracking','scores','episodeNotes']){if(!merged[field])merged[field]={};if(Object.hasOwn(source[field]||{},id))Object.defineProperty(merged[field],id,{value:clone(source[field][id]),enumerable:true,writable:true,configurable:true});else delete merged[field][id];}
  merged.favorites=merged.favorites.filter(v=>v!==id);if(source.favorites.includes(id))merged.favorites.push(id);
 }
 return {library:cleanLibrary(merged),conflicts};
}
export const hasPending=pack=>!!pack&&!equal(pack.base,pack.draft);
export function editOffline(pack,id,patch,now=Date.now()){
 if(!pack.draft.saved.includes(id))throw Error('Bu anime çevrimdışı listende yok.');const draft=clone(pack.draft),before=draft.progress[id]||0;
 if('progress' in patch){const value=Number(patch.progress),total=draft.savedAnime[id]?.episodes;if(!Number.isInteger(value)||value<0||value>9999||Number.isInteger(total)&&total>0&&value>total)throw Error('Bölüm sayısını kontrol et.');draft.progress[id]=value;if(value!==before){draft.activity=[{id:crypto.randomUUID(),animeId:id,title:draft.savedAnime[id].title,at:now,from:before,to:value},...(draft.activity||[])].slice(0,500);}}
 if('tracking' in patch)draft.tracking[id]=patch.tracking;
 if('score' in patch){if(!Number.isInteger(patch.score)||patch.score<0||patch.score>10)throw Error('Puan 0 ile 10 arasında olmalı.');if(patch.score)draft.scores[id]=patch.score;else delete draft.scores[id];}
 if('favorite' in patch)draft.favorites=patch.favorite?[...new Set([...draft.favorites,id])]:draft.favorites.filter(v=>v!==id);
 return {...pack,draft:cleanLibrary(draft),revision:pack.revision+1};
}

export function createOfflineStore(idb=globalThis.indexedDB){
 let opened;
 const db=()=>opened||=(new Promise((resolve,reject)=>{if(!idb){reject(Error('Tarayıcın çevrimdışı depolamayı desteklemiyor.'));return;}const req=idb.open('anime-takvimi-offline',1);req.onupgradeneeded=()=>{req.result.createObjectStore('packs',{keyPath:'scope'});req.result.createObjectStore('settings',{keyPath:'key'});};req.onerror=()=>reject(Error('Çevrimdışı depolama açılamadı.'));req.onblocked=()=>reject(Error('Diğer site sekmelerini kapatıp tekrar dene.'));req.onsuccess=()=>{req.result.onversionchange=()=>req.result.close();resolve(req.result);};}));
 async function access(store,key,update){const connection=await db();return new Promise((resolve,reject)=>{const tx=connection.transaction(store,update?'readwrite':'readonly'),table=tx.objectStore(store),req=table.get(key);let value;req.onsuccess=()=>{value=req.result||null;if(update){try{value=update(value);if(value===null)table.delete(key);else table.put(value);}catch(e){tx.abort();reject(e);}}};tx.oncomplete=()=>resolve(value?clone(value):null);tx.onerror=()=>reject(Error('Çevrimdışı kopya kaydedilemedi. Cihazın boş alanını kontrol et.'));tx.onabort=()=>reject(Error('Çevrimdışı kopya kaydedilemedi.'));});}
 return {get:scope=>access('packs',scope),update:(scope,fn)=>access('packs',scope,fn),active:async()=>{const meta=await access('settings','active');return meta?.scope?access('packs',meta.scope):null;},activate:async scope=>{const result=await access('settings','active',()=>({key:'active',scope}));if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('anime-takvimi-offline');channel.postMessage({type:'scope-change'});channel.close();}return result;},remove:scope=>access('packs',scope,()=>null)};
}
