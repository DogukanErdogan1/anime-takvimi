import {cleanLibrary,clone,createOfflineStore,editOffline,equal,hasPending,mergeOffline} from './offline-core.mjs';
export function createOfflineClient({store=createOfflineStore(),fetcher=globalThis.fetch,online=()=>globalThis.navigator?.onLine!==false,onChange=()=>{},onLibrary=()=>{}}={}){
 let syncing,syncingScope;
 const notify=()=>onChange();
 async function request(path,options={}){const response=await fetcher(path,{credentials:'same-origin',cache:'no-store',...options,headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});let data;try{data=await response.json();}catch{throw Error('Sunucunun yanıtı okunamadı. Değişikliklerin cihazda korunuyor.');}if(!response.ok){const e=Error(data.error?.message||'Eşitleme tamamlanamadı.');e.status=response.status;e.code=data.error?.code;throw e;}return {data,revision:response.headers.get('ETag')};}
 async function sync(scope,choice){
  if(syncing){if(syncingScope===scope)return syncing;await syncing;return sync(scope,choice);}
  syncingScope=scope;
  syncing=(async()=>{if(!online())return {kind:'offline'};
   for(let attempt=0;attempt<3;attempt++){
    const active=await store.active();if(!active||active.scope!==scope)return {kind:'disabled'};
    const {data:account}=await request('/api/account');if(!account.registered||account.user?.id!==scope||account.user.status!=='active'){await store.activate(null);notify();const e=Error('Bu değişiklikleri eşitlemek için aynı hesabına yeniden giriş yap.');e.code='account_changed';throw e;}
    const pack=await store.get(scope),{data:remote,revision}=await request('/api/library');if(!revision||!/^"[a-f0-9]{64}"$/.test(revision))throw Error('Sunucu eşitlemeye hazır değil. Cihazdaki değişikliklerin korunuyor.');
    const plan=mergeOffline(pack.base,pack.draft,remote.library,choice);
    if(plan.conflicts.length&&!choice){notify();return {kind:'conflict',conflicts:plan.conflicts,library:plan.library};}
    let saved=remote.library;
    if(!equal(plan.library,remote.library)){
     try{const {data}=await request('/api/library',{method:'PUT',headers:{'If-Match':revision,'X-Library-Account':scope},body:JSON.stringify({library:plan.library})});saved=data.library;}
     catch(e){if(e.code==='library_conflict')continue;throw e;}
    }
    const current=await store.update(scope,latest=>{if(!latest)return null;return {...latest,base:cleanLibrary(saved),draft:latest.revision===pack.revision?cleanLibrary(saved):mergeOffline(pack.draft,latest.draft,saved,'local').library,revision:latest.revision+1,verifiedAt:Date.now(),expiresAt:Date.now()+30*86400000};});
    const currentActive=await store.active();if(current&&currentActive?.scope===scope){onLibrary(current.draft,scope);notify();}
    if(current&&hasPending(current))continue;return {kind:'synced',library:current?.draft||saved};
   }
   return {kind:'retry'};
  })().catch(async e=>{if(e.code==='account_changed'||e.status===401||e.status===403){await store.activate(null);notify();}throw e;}).finally(()=>{syncing=null;notify();});return syncing;
 }
 return {
  async status(scope){const pack=scope?await store.get(scope):await store.active();return {enabled:!!pack,pending:hasPending(pack),scope:pack?.scope||null,verifiedAt:pack?.verifiedAt||null,syncing:!!syncing};},
  async enable(scope,alias,library,palette={}){if(typeof scope!=='string'||!scope||scope.length>256)throw Error('Önce hesabına giriş yap.');const clean=cleanLibrary(library);if(hasPending(await store.get(scope)))throw Error('Önce bekleyen cihaz değişikliklerini eşitle veya yedekle.');await store.update(scope,()=>({version:1,scope,palette,alias:String(alias||'Hesabım').slice(0,80),base:clean,draft:clone(clean),revision:1,verifiedAt:Date.now(),expiresAt:Date.now()+30*86400000}));await store.activate(scope);notify();},
  async disable(scope){await store.remove(scope);const pack=await store.active();if(pack?.scope===scope)await store.activate(null);notify();},
  async activate(scope){await store.activate(scope);notify();},
  async lock(){await store.activate(null);notify();},
  async resume(){const pack=await store.active();if(!pack||pack.expiresAt<Date.now())return null;return {scope:pack.scope,alias:pack.alias,library:cleanLibrary(pack.draft)};},
  async capture(scope,library){const active=await store.active();if(active?.scope!==scope)return false;const clean=cleanLibrary(library);await store.update(scope,p=>p?{...p,draft:clean,revision:p.revision+1}:null);notify();return true;},
  async edit(id,patch){const active=await store.active();if(!active||active.expiresAt<Date.now())throw Error('Çevrimdışı erişimini yenilemek için siteye giriş yap.');const pack=await store.update(active.scope,p=>editOffline(p,id,patch));notify();return pack;},
  async load(scope,serverLibrary){const pack=await store.get(scope);if(!pack)return {library:serverLibrary};if(hasPending(pack)){const outcome=await sync(scope);if(outcome.library)return outcome;return {library:pack.draft,...outcome};}await store.update(scope,p=>p?{...p,base:cleanLibrary(serverLibrary),draft:cleanLibrary(serverLibrary),revision:p.revision+1,verifiedAt:Date.now(),expiresAt:Date.now()+30*86400000}:null);return {library:serverLibrary};},
  sync,
 };
}
export function installOfflineClient(){
 const client=createOfflineClient({onChange:()=>window.dispatchEvent(new CustomEvent('anime:offlinechange')),onLibrary:(library,scope)=>window.dispatchEvent(new CustomEvent('anime:offlinesynced',{detail:{scope,library}}))});
 window.addEventListener('online',()=>{const scope=window.AnimeMembership?.getStatus?.().scopeUserId;if(scope)client.sync(scope).catch(()=>{});});
 return client;
}
