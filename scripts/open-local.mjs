import {readFileSync, existsSync, writeFileSync, renameSync, unlinkSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';

const loopback = new Set(['localhost','127.0.0.1','[::1]']);
export function parsePreviewLock(text, root) {
  try {
    const lock = JSON.parse(text);
    if (!Number.isSafeInteger(lock.pid) || lock.pid < 1 || !Number.isInteger(lock.port) || lock.port < 1 || lock.port > 65535 || typeof lock.cwd !== 'string') return null;
    const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    if (normalize(lock.cwd) !== normalize(root)) return null;
    const url = new URL(lock.appUrl);
    if (url.protocol !== 'http:' || !loopback.has(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || Number(url.port || 80) !== lock.port) return null;
    return {...lock, url:url.href};
  } catch { return null; }
}

export async function previewReady(url, fetchImpl=fetch, {timeoutMs=2500}={}) {
  const controller=new AbortController();
  let response,reader,timer,stopped=false;
  // Stream cancellation can itself remain pending; never wait for cleanup.
  const discard=body=>{try {body?.cancel()?.catch(()=>{});} catch {}};
  const check=(async()=>{
    try {
      response=await fetchImpl(url,{redirect:'manual',signal:controller.signal,headers:{Accept:'text/html'}});
      if(stopped) {discard(response.body);return false;}
      if(response.status !== 200 || !response.headers.get('content-type')?.includes('text/html'))return false;
      reader=response.body?.getReader(); if(!reader)return false;
      let size=0,html=''; const decoder=new TextDecoder();
      while(!stopped) {
        const chunk=await reader.read();
        if(stopped)return false;
        if(chunk.done)html+=decoder.decode();
        else {
          size+=chunk.value.byteLength; if(size>512*1024)return false;
          html+=decoder.decode(chunk.value,{stream:true});
        }
        // SSR can keep streaming after the app has already rendered.
        if(/id=["']anime-site["']/.test(html) && html.includes('/site/bootstrap.js'))return true;
        if(chunk.done)return false;
      }
      return false;
    } catch {return false;}
  })();
  try {
    return await Promise.race([check,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);})]);
  } finally {
    stopped=true;clearTimeout(timer);controller.abort();
    discard(reader || response?.body);
  }
}

export async function availablePort(preferred=5173) {
  const reserve=port=>new Promise((resolve,reject)=>{
    const server=createServer();server.once('error',reject);
    server.listen({host:'127.0.0.1',port},()=>{
      const selected=server.address().port;
      server.close(error=>error ? reject(error) : resolve(selected));
    });
  });
  // Prefer a stable address across restarts (guest lists use this origin).
  for(let port=preferred;port<Math.min(preferred+10,65536);port++) {
    try {return await reserve(port);}
    catch(error) {if(!['EADDRINUSE','EACCES'].includes(error.code))throw error;}
  }
  return reserve(0);
}

export async function ensurePreview({readLocks,probe,start,wait,onStatus=()=>{},now=Date.now,timeoutMs=90000,existingWaitMs=7000,startupGraceMs=45000}) {
  const startedAt=now(),deadline=startedAt+timeoutMs;
  let child=null;
  while(now()<deadline) {
    const failed=child && (child.startError || child.exitCode !== null || child.signalCode);
    if(child && !failed) {
      onStatus({phase:'starting',url:child.previewLock.url});
      if(await probe(child.previewLock.url))return {url:child.previewLock.url,reused:false,child};
    } else {
      const locks=readLocks();
      for(const lock of locks) {
        onStatus({phase:'checking',url:lock.url});
        if(await probe(lock.url))return {url:lock.url,reused:true,child:null};
      }
      if(failed)throw new Error('Sunucu baslatilamadi. Yukaridaki sunucu mesajini kontrol edin.');
      // Give a second click time to join a newly compiling launcher server.
      // Invalid/future timestamps cannot extend this bounded grace period.
      const compiling=locks.some(lock=>lock.launcherOwned && Number.isFinite(lock.startedAt) && lock.startedAt<=now() && now()-lock.startedAt<startupGraceMs);
      if(!locks.length || (!compiling && now()-startedAt>=existingWaitMs)) {
        onStatus({phase:'launching',recovering:locks.length>0});
        child=await start();
      }
    }
    await wait();
  }
  throw new Error('Sunucu beklenen surede hazir olmadi. Yukaridaki sunucu mesajlarini kontrol edin.');
}

export function openBrowser(url) {
  return new Promise((resolve,reject)=>{
    const command=process.platform==='win32' ? 'cmd.exe' : process.platform==='darwin' ? 'open' : 'xdg-open';
    // URL is a validated or launcher-created loopback URL without shell syntax.
    const args=process.platform==='win32' ? ['/d','/c','start','',url] : [url];
    const opener=spawn(command,args,{stdio:'ignore',windowsHide:true});
    opener.once('error',reject);opener.once('exit',code=>code===0 ? resolve() : reject(new Error('browser_open_failed')));
  });
}

async function main() {
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22 || (major===22 && minor<13))throw new Error('Node.js 22.13 veya daha yeni bir surum gerekiyor.');
  const {projectRoot}=await import('./sites-env.mjs');
  const registryPath=path.join(projectRoot,'.sites-runtime','preview-server.json');
  const readLocks=()=>{
    const locks=[];
    for(const location of [registryPath,path.join(projectRoot,'.vinext','dev','lock.json')]) {
      try {
        const lock=parsePreviewLock(readFileSync(location,'utf8'),projectRoot);
        if(lock && !locks.some(other=>other.url===lock.url))locks.push({...lock,launcherOwned:location===registryPath});
      } catch {}
    }
    return locks;
  };
  console.log('Anime Takvimi kontrol ediliyor...');
  let launchedChild=null,lastMessage='';const startedAt=Date.now();
  const progress=setInterval(()=>console.log('Yanit bekleniyor... '+Math.round((Date.now()-startedAt)/1000)+' sn'),5000);
  let result;
  try {
    result=await ensurePreview({
      readLocks,probe:previewReady,
      onStatus({phase,url,recovering}) {
        const message=phase==='checking' ? 'Baglanti kontrol ediliyor: '+url : phase==='starting' ? 'Site hazirlaniyor: '+url : recovering ? 'Eski sunucu yanit vermedi. Bos bir portta yeni oturum aciliyor.' : '';
        if(message && message!==lastMessage) {console.log(message);lastMessage=message;}
      },
      async start() {
        const port=await availablePort();
        if(port!==5173)console.log('5173 portu kullanimda. Bu oturum '+port+' portunda acilacak.');
        console.log('Sunucu baslatiliyor. Site hazir olunca tarayiciniz acilacak.');
        console.log('Bu sunucu penceresini site acikken acik tutun. Durdurmak icin Ctrl+C kullanin.\n');
        const args=['--import',new URL('./sites-env.mjs',import.meta.url).href];
        const compat=path.join(projectRoot,'.sites-runtime','windows-realpath-compat.mjs');
        if(existsSync(compat))args.push('--import',pathToFileURL(compat).href);
        args.push(fileURLToPath(new URL('./run-framework.mjs',import.meta.url)),'dev','--port',String(port),'--hostname','127.0.0.1');
        // Leave unresponsive/unknown Vinext processes and their lock untouched.
        const child=spawn(process.execPath,args,{cwd:projectRoot,stdio:'inherit',windowsHide:true,
          env:{...process.env,VINEXT_NO_DEV_LOCK:'1',ANIME_LOCAL_LAUNCHER:'1'}});
        launchedChild=child;
        child.on('error',error=>{child.startError=error;});
        child.previewLock={pid:child.pid,port,hostname:'127.0.0.1',appUrl:'http://127.0.0.1:'+port+'/',url:'http://127.0.0.1:'+port+'/',cwd:projectRoot,startedAt:Date.now()};
        if(child.pid) {
          const temporary=registryPath+'.'+process.pid+'.tmp';
          writeFileSync(temporary,JSON.stringify(child.previewLock));renameSync(temporary,registryPath);
          child.once('exit',()=>{
            try {
              const saved=JSON.parse(readFileSync(registryPath,'utf8'));
              if(saved.pid===child.pid && saved.startedAt===child.previewLock.startedAt)unlinkSync(registryPath);
            } catch {}
          });
        }
        return child;
      },
      wait:()=>new Promise(resolve=>setTimeout(resolve,500)),
    });
  } catch(error) {launchedChild?.unref();throw error;}
  finally {clearInterval(progress);}
  console.log(result.reused ? '\nSite zaten acik. Mevcut sunucu kullaniliyor.' : '\nSite hazir.');
  console.log(result.url);
  if(!process.argv.includes('--no-open')) {
    try {await openBrowser(result.url);}
    catch {console.log('Tarayici otomatik acilamadi. Yukaridaki adresi tarayiciniza yazin. Sunucu calisiyor.');}
  }
  if(result.child)result.child.once('exit',code=>{process.exitCode=code ?? 0;});
}

if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  main().catch(error=>{console.error('\n'+error.message);process.exitCode=1;});
}

