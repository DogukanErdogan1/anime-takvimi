import test from 'node:test';
import assert from 'node:assert/strict';
import {createPosterService, posterId, safePosterSource, PosterError} from '../lib/posters.mjs';
const PNG=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4UxQBAAQEAbeNTRuQAAAAAElFTkSuQmCC','base64'));
const source='https://cdn.myanimelist.net/images/anime/1693/158641l.png';
const metadata=(id=62717,images={jpg:{large_image_url:source}})=>Response.json({data:{mal_id:id,images}});
const image=()=>new Response(PNG,{headers:{'content-type':'image/png'}});
const status=expected=>error=>error instanceof PosterError&&error.status===expected;
const service=options=>createPosterService({spacingMs:0,...options});

test('poster proxy only accepts canonical IDs and provider image paths',async()=>{
  for(const value of ['',0,-1,'01','1.0','2e3','21/../2','21?url=x',2147483648,{}])assert.throws(()=>posterId(value),status(400));
  assert.equal(posterId('62717'),62717);
  for(const url of ['http://cdn.myanimelist.net/images/anime/1/21.jpg','https://cdn.myanimelist.net.evil.test/images/anime/1/21.jpg','https://user@cdn.myanimelist.net/images/anime/1/21.jpg','https://cdn.myanimelist.net:8080/images/anime/1/21.jpg','https://cdn.myanimelist.net/images/anime/1/21.svg',source+'?url=x','https://127.0.0.1/image.jpg'])assert.equal(safePosterSource(url),null);
  assert.equal(safePosterSource(source),source);
  let calls=0;const posters=service({fetcher:async()=>{calls++;return metadata();}});
  await assert.rejects(()=>posters.get('../21'),status(400));assert.equal(calls,0);
});

test('poster proxy verifies metadata, validates raster bytes and shares cached in-flight work',async()=>{
  const calls=[];const posters=service({fetcher:async(url,options)=>{calls.push({url,options});await Promise.resolve();return url.includes('api.tenrai.org')?metadata():image();}});
  const [a,b]=await Promise.all([posters.get(62717),posters.get('62717')]);
  assert.equal(a,b);assert.deepEqual(a.bytes,PNG);assert.equal(a.contentType,'image/png');assert.match(a.etag,/^"poster-62717-[a-f0-9]{64}"$/);
  assert.equal(await posters.get(62717),a);assert.equal(calls.length,2);
  for(const {options} of calls){assert.equal(options.credentials,'omit');assert.equal(options.redirect,'manual');assert.equal(options.headers.Cookie,undefined);}
});

test('a broken high-resolution WebP falls back to the provider JPEG/PNG alternative',async()=>{
  const calls=[];const webp=source.replace('.png','.webp');
  const posters=service({fetcher:async url=>{calls.push(url);if(url.includes('api.tenrai.org'))return metadata(64448,{webp:{large_image_url:webp},jpg:{large_image_url:source}});return url===webp?new Response(null,{status:404}):image();}});
  assert.deepEqual((await posters.get(64448)).bytes,PNG);assert.deepEqual(calls.slice(1),[webp,source]);
});

test('missing, malformed, mismatched and unsafe provider records never fetch arbitrary URLs',async()=>{
  for(const response of [new Response(null,{status:404}),new Response('not json'),metadata(21),metadata(62717,{jpg:{large_image_url:'http://127.0.0.1/private'}})]){
    let calls=0;const posters=service({fetcher:async()=>{calls++;return response;}});
    await assert.rejects(()=>posters.get(62717),error=>[404,503].includes(error.status));assert.equal(calls,1);
  }
});

test('temporary provider failures are not cached permanently',async()=>{
  let now=1000,healthy=false,calls=0;
  const posters=service({now:()=>now,fetcher:async url=>{calls++;return !healthy?new Response(null,{status:429}):url.includes('api.tenrai.org')?metadata():image();}});
  await assert.rejects(()=>posters.get(62717),status(503));await assert.rejects(()=>posters.get(62717),status(503));assert.equal(calls,1);
  now+=2001;healthy=true;assert.deepEqual((await posters.get(62717)).bytes,PNG);assert.equal(calls,3);
});

test('cached posters survive a temporary outage, and old bytes expire',async()=>{
  let now=1000,healthy=true;
  const posters=service({ttl:100,now:()=>now,fetcher:async url=>!healthy?new Response(null,{status:503}):url.includes('api.tenrai.org')?metadata():image()});
  const first=await posters.get(62717);now+=101;healthy=false;
  const stale=await posters.get(62717);assert.equal(stale.stale,true);assert.equal(stale.etag,first.etag);assert.deepEqual(stale.bytes,PNG);
  now+=8*86400000;await assert.rejects(()=>posters.get(62717),status(503));
});

test('poster proxy rejects HTML disguised as an image and oversized bodies',async()=>{
  for(const bad of [()=>new Response('<script>bad</script>',{headers:{'content-type':'image/png'}}),()=>new Response(PNG,{headers:{'content-type':'text/html'}}),()=>new Response(PNG,{headers:{'content-type':'image/png','content-length':'99999999'}}),()=>new Response(new Uint8Array(2*1024*1024+1),{headers:{'content-type':'image/png'}})]){
    const posters=service({fetcher:async url=>url.includes('api.tenrai.org')?metadata():bad()});
    await assert.rejects(()=>posters.get(62717),status(503));
  }
});

test('fallback downloads are limited to two concurrent jobs and a bounded queue',async()=>{
  const releases=[];let running=0,peak=0,blocked=true;
  const posters=service({fetcher:async url=>{
    if(url.includes('api.tenrai.org')){const id=Number(url.split('/').at(-1));running++;peak=Math.max(peak,running);if(blocked)await new Promise(resolve=>releases.push(resolve));running--;return metadata(id);}
    return image();
  }});
  const requests=Array.from({length:26},(_,i)=>posters.get(i+1));
  await assert.rejects(()=>posters.get(27),status(503));assert.equal(peak,2);
  blocked=false;for(const release of releases.splice(0))release();
  await Promise.all(requests);assert.equal(peak,2);
});

test('poster cache evicts bytes within its memory budget',async()=>{
  const calls=[];const posters=service({maxCacheBytes:PNG.byteLength,fetcher:async url=>{calls.push(url);return url.includes('api.tenrai.org')?metadata(Number(url.split('/').at(-1))):image();}});
  await posters.get(21);await posters.get(22);await posters.get(21);assert.equal(calls.filter(url=>url.endsWith('/21')).length,2);
});

test('redirects are rejected without requesting their destination',async()=>{
  for(const atMetadata of [true,false]){
    const calls=[];const posters=service({fetcher:async url=>{calls.push(url);return atMetadata||!url.includes('api.tenrai.org')?new Response(null,{status:302,headers:{Location:'http://127.0.0.1/private'}}):metadata();}});
    await assert.rejects(()=>posters.get(62717),status(503));assert.equal(calls.length,atMetadata?1:2);assert.ok(calls.every(url=>url.startsWith('https://')));
  }
});

test('slow provider response bodies are aborted within the overall deadline',async()=>{
  const posters=service({timeoutMs:20,fetcher:async(_url,{signal})=>new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(new DOMException('Timed out','AbortError')),{once:true});}}))});
  await assert.rejects(()=>posters.get(62717),status(503));
});
