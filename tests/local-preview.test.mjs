import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createServer} from 'node:net';
import {parsePreviewLock,previewReady,ensurePreview,availablePort} from '../scripts/open-local.mjs';

const root=path.resolve('example-project');
const record={pid:123,port:5174,hostname:'127.0.0.1',appUrl:'http://127.0.0.1:5174',cwd:root};
const lock={...record,url:record.appUrl+'/'};
const ownLock={...lock,pid:124,port:5175,appUrl:'http://127.0.0.1:5175',url:'http://127.0.0.1:5175/'};
const appHtml='<div id="anime-site"></div><script src="/site/bootstrap.js"></script>';
const pending=()=>new Promise(()=>{});
const encoder=new TextEncoder();

// An independent timer makes a regression fail instead of hanging the suite.
async function within(promise,timeoutMs=1000) {
  let timer;
  try {
    return await Promise.race([promise,new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('operation did not settle within test deadline')),timeoutMs);
    })]);
  } finally {clearTimeout(timer);}
}

function fixture(overrides={}) {
  let time=0,starts=0;
  const events=[];
  const child={pid:124,exitCode:null,signalCode:null,previewLock:ownLock};
  const deps={readLocks:()=>[lock],probe:async()=>true,
    start:async()=>{starts++;return child;},wait:async()=>{time+=100;},
    onStatus:event=>events.push(event),now:()=>time,timeoutMs:2000,existingWaitMs:300,...overrides};
  return {deps,child,events,stats:()=>({time,starts})};
}

test('only same-project HTTP loopback URLs and valid PIDs/ports are reusable',()=>{
  assert.equal(parsePreviewLock(JSON.stringify(record),root).url,lock.url);
  for(const patch of [{cwd:path.resolve('another-project')},{pid:-1},{pid:1.1},{port:0},
    {appUrl:'https://example.com/'},{appUrl:'http://127.0.0.1:5174/?x=1&whoami'},
    {appUrl:'http://user:pass@localhost:5174/'},{appUrl:'http://localhost:5175/'},
    {appUrl:'http://127.0.0.1:5174/giris'},{appUrl:'file:///C:/test'}]) {
    assert.equal(parsePreviewLock(JSON.stringify({...record,...patch}),root),null);
  }
  assert.equal(parsePreviewLock('broken',root),null);
});

test('healthy existing server is reused at its actual port without starting',async()=>{
  const f=fixture();const result=await within(ensurePreview(f.deps));
  assert.equal(result.reused,true);assert.equal(result.url,lock.url);assert.equal(result.child,null);
  assert.equal(f.stats().starts,0);
});

test('all existing candidates are checked before starting another server',async()=>{
  const checked=[];
  const f=fixture({readLocks:()=>[lock,ownLock],probe:async url=>{checked.push(url);return url===ownLock.url;}});
  const result=await within(ensurePreview(f.deps));
  assert.equal(result.reused,true);assert.equal(result.url,ownLock.url);
  assert.deepEqual(checked,[lock.url,ownLock.url]);assert.equal(f.stats().starts,0);
});

test('a server still compiling is reused when ready within the existing grace',async()=>{
  let probes=0;
  const f=fixture({probe:async()=>++probes===3});
  assert.equal((await within(ensurePreview(f.deps))).reused,true);
  assert.equal(probes,3);assert.equal(f.stats().starts,0);assert.ok(f.stats().time<300);
});

test('a second click gives a newly registered launcher time to compile',async()=>{
  let probes=0;
  const f=fixture({readLocks:()=>[{...lock,launcherOwned:true,startedAt:0}],
    startupGraceMs:800,probe:async()=>++probes===6});
  assert.equal((await within(ensurePreview(f.deps))).reused,true);
  assert.equal(f.stats().starts,0);assert.equal(f.stats().time,500);
});

test('a recent launcher registration eventually recovers when it never becomes ready',async()=>{
  const f=fixture({readLocks:()=>[{...lock,launcherOwned:true,startedAt:0}],
    startupGraceMs:800,probe:async url=>url===ownLock.url});
  assert.equal((await within(ensurePreview(f.deps))).reused,false);
  assert.equal(f.stats().starts,1);assert.equal(f.stats().time,900);
});

test('invalid or future startup timestamps cannot extend the normal recovery grace',async()=>{
  for(const startedAt of [undefined,'now',NaN,100000]) {
    const f=fixture({readLocks:()=>[{...lock,launcherOwned:true,startedAt}],
      startupGraceMs:800,probe:async url=>url===ownLock.url});
    assert.equal((await within(ensurePreview(f.deps))).reused,false);
    assert.equal(f.stats().time,400);assert.equal(f.stats().starts,1);
  }
});

test('missing server starts once and monitors its own chosen address',async()=>{
  const checked=[];
  const f=fixture({readLocks:()=>[],probe:async url=>{checked.push(url);return true;}});
  const result=await within(ensurePreview(f.deps));
  assert.equal(result.reused,false);assert.equal(result.child,f.child);assert.equal(result.url,ownLock.url);
  assert.deepEqual(checked,[ownLock.url]);assert.equal(f.stats().starts,1);
});

test('unreachable old registration recovers after grace without changing it',async()=>{
  const old=Object.freeze({...lock});const before=JSON.stringify(old);
  let startedAt;
  const f=fixture({readLocks:()=>[old],probe:async url=>url===ownLock.url});
  const originalStart=f.deps.start;
  f.deps.start=async()=>{startedAt=f.deps.now();return originalStart();};
  const result=await within(ensurePreview(f.deps));
  assert.equal(result.reused,false);assert.equal(result.url,ownLock.url);assert.equal(f.stats().starts,1);
  assert.ok(startedAt>=f.deps.existingWaitMs);assert.equal(JSON.stringify(old),before);
  assert.ok(f.events.some(event=>event.phase==='launching' && event.recovering));
});

test('own child continues compiling while an unreachable global lock persists',async()=>{
  let ownProbes=0,reads=0;
  const f=fixture({readLocks:()=>{reads++;return [lock];},
    probe:async url=>url===ownLock.url && ++ownProbes===5});
  const result=await within(ensurePreview(f.deps));
  assert.equal(result.url,ownLock.url);assert.equal(result.child,f.child);assert.equal(result.reused,false);
  assert.equal(ownProbes,5);assert.equal(f.stats().starts,1);
  assert.equal(reads,4,'global registrations should stop influencing an owned startup');
});

test('a concurrently ready server is reused even when this child has failed',async()=>{
  let reads=0;
  const f=fixture({readLocks:()=>++reads===1 ? [] : [lock]});
  f.child.exitCode=1;
  const result=await within(ensurePreview(f.deps));
  assert.equal(result.reused,true);assert.equal(result.url,lock.url);assert.equal(result.child,null);
  assert.equal(f.stats().starts,1);
});

test('failed startup without another healthy server returns a startup error promptly',async()=>{
  const f=fixture({readLocks:()=>[]});f.child.exitCode=1;
  await assert.rejects(within(ensurePreview(f.deps)),/Sunucu baslatilamadi/);
  assert.equal(f.stats().starts,1);assert.ok(f.stats().time<f.deps.timeoutMs);
});

test('spawn errors fail promptly instead of waiting for readiness',async()=>{
  const f=fixture({readLocks:()=>[]});f.child.startError=new Error('spawn denied');
  await assert.rejects(within(ensurePreview(f.deps)),/Sunucu baslatilamadi/);
  assert.equal(f.stats().starts,1);assert.ok(f.stats().time<f.deps.timeoutMs);
});

test('startup stopped by a signal fails without waiting for the whole timeout',async()=>{
  const f=fixture({readLocks:()=>[]});f.child.signalCode='SIGTERM';
  await assert.rejects(within(ensurePreview(f.deps)),/Sunucu baslatilamadi/);
  assert.equal(f.stats().starts,1);assert.ok(f.stats().time<f.deps.timeoutMs);
});

test('an owned server that never becomes ready stops at the overall deadline',async()=>{
  const f=fixture({readLocks:()=>[],probe:async()=>false});
  await assert.rejects(within(ensurePreview(f.deps)),/beklenen surede hazir olmadi/);
  assert.equal(f.stats().starts,1);assert.equal(f.stats().time,f.deps.timeoutMs);
});

test('progress callback announces the address before an existing connection is probed',async()=>{
  const order=[];
  const f=fixture({onStatus:event=>order.push(['status',event.phase,event.url]),
    probe:async url=>{order.push(['probe',url]);return true;}});
  await within(ensurePreview(f.deps));
  assert.deepEqual(order,[['status','checking',lock.url],['probe',lock.url]]);
});

test('progress announces startup and its chosen address before probing the child',async()=>{
  const order=[];
  const f=fixture({readLocks:()=>[],onStatus:event=>order.push(['status',event.phase,event.url]),
    probe:async url=>{order.push(['probe',url]);return true;}});
  const originalStart=f.deps.start;
  f.deps.start=async()=>{order.push(['start']);return originalStart();};
  await within(ensurePreview(f.deps));
  assert.deepEqual(order,[['status','launching',undefined],['start'],['status','starting',ownLock.url],['probe',ownLock.url]]);
});

test('another application occupying the preferred port is preserved while selecting a free port',{timeout:3000},async()=>{
  const other=createServer();
  await new Promise((resolve,reject)=>{other.once('error',reject);other.listen(0,'127.0.0.1',resolve);});
  try {
    const busy=other.address().port;
    const selected=await within(availablePort(busy));
    assert.notEqual(selected,busy);assert.ok(selected>0&&selected<=65535);assert.equal(other.listening,true);
  } finally {await new Promise(resolve=>other.close(resolve));}
});

test('readiness accepts the anime app and rejects another app, redirects, and oversized bodies',async()=>{
  const good=async()=>new Response(appHtml,{headers:{'Content-Type':'text/html; charset=utf-8'}});
  assert.equal(await within(previewReady(lock.url,good)),true);
  assert.equal(await within(previewReady(lock.url,async()=>new Response('another site',{headers:{'Content-Type':'text/html'}}))),false);
  assert.equal(await within(previewReady(lock.url,async(url,options)=>{
    assert.equal(options.redirect,'manual');
    return new Response(null,{status:302,headers:{Location:'https://example.com/'}});
  })),false);
  assert.equal(await within(previewReady(lock.url,async()=>new Response('x'.repeat(512*1024+1),{headers:{'Content-Type':'text/html'}}))),false);
});

test('readiness bounds a fetch that never settles and aborts its signal',{timeout:2000},async()=>{
  let signal;
  const result=await within(previewReady(lock.url,(_url,options)=>{signal=options.signal;return pending();},{timeoutMs:20}));
  assert.equal(result,false);assert.equal(signal.aborted,true);
});

test('readiness bounds a response stream that never produces data',{timeout:2000},async()=>{
  let cancelled=0;
  const stream=new ReadableStream({cancel(){cancelled++;return pending();}});
  const result=await within(previewReady(lock.url,async()=>new Response(stream,{headers:{'Content-Type':'text/html'}}),{timeoutMs:20}));
  assert.equal(result,false);assert.equal(cancelled,1);
});

test('rejecting a non-HTML response does not wait for cancellation to settle',{timeout:2000},async()=>{
  let cancelled=0;
  const stream=new ReadableStream({cancel(){cancelled++;return pending();}});
  const result=await within(previewReady(lock.url,async()=>new Response(stream,{headers:{'Content-Type':'application/json'}}),{timeoutMs:20}));
  assert.equal(result,false);assert.equal(cancelled,1);
});

test('app markers allow early success without waiting for stream closure or cancellation',{timeout:2000},async()=>{
  let cancelled=0;
  const stream=new ReadableStream({
    start(controller){controller.enqueue(encoder.encode(appHtml));},
    cancel(){cancelled++;return pending();},
  });
  const result=await within(previewReady(lock.url,async()=>new Response(stream,{headers:{'Content-Type':'text/html'}}),{timeoutMs:100}));
  assert.equal(result,true);assert.equal(cancelled,1);
});

test('app markers are recognized when split across streamed chunks',async()=>{
  const stream=new ReadableStream({start(controller){
    controller.enqueue(encoder.encode('<div id="anime-'));
    controller.enqueue(encoder.encode('site"></div><script src="/site/boot'));
    controller.enqueue(encoder.encode('strap.js"></script>'));
  }});
  assert.equal(await within(previewReady(lock.url,async()=>new Response(stream,{headers:{'Content-Type':'text/html'}}),{timeoutMs:100})),true);
});

test('network errors return an unsuccessful health check',async()=>{
  assert.equal(await within(previewReady(lock.url,async()=>{throw new Error('connection refused');})),false);
});
