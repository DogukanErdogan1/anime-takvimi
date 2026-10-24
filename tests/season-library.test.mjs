import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/site/app.js',import.meta.url),'utf8');
const staticHtml=readFileSync(new URL('../public/site/index.html',import.meta.url),'utf8');
const fixedTime=Date.parse('2026-10-16T09:00:00Z');
const anime=(id,format='TV')=>({id:`mal-${id}`,malId:id,title:`Anime ${id}`,format,image:`https://cdn.myanimelist.net/images/anime/1/${id}.jpg`,genres:['Aksiyon'],synonyms:[],studio:'Test Studio',airing:false,broadcastLocal:false});
const response=items=>({anime:items,fetchedAt:fixedTime,stale:false});
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const countCards=html=>(html.match(/class="anime-card(?: |")/g)||[]).length;

function setup({hash='',now=fixedTime,loadSeason=async()=>response([]),getSeasonPreview=async()=>response([])}={}){
  const nodes=new Map(),listeners=new Map(),windowListeners=new Map(),requests=[],previewRequests=[],mapCalls=[],mapSnapshots=[],scheduleRequests=[],intervals=[],layoutListeners=[];
  const clock={now};
  class ClockDate extends Date { constructor(...args){super(...(args.length?args:[clock.now]));} static now(){return clock.now;} }
  const document={readyState:'complete',hidden:false,activeElement:null,body:{dataset:{}}};
  class Element {
    constructor(id='',tagName='DIV'){
      this.id=id;this.tagName=tagName;this.dataset={};this.attributes=new Map();this.listeners=new Map();
      this.innerHTML='';this.textContent='';this.value='';this.hidden=false;this.disabled=false;this.open=false;
      const classes=new Set();
      this.classList={add:(...values)=>values.forEach(value=>classes.add(value)),remove:(...values)=>values.forEach(value=>classes.delete(value)),toggle:(name,force)=>{const enabled=force??!classes.has(name);if(enabled)classes.add(name);else classes.delete(name);return enabled;},contains:name=>classes.has(name)};
      this.style={setProperty(){}};
    }
    setAttribute(name,value){this.attributes.set(name,String(value));}
    removeAttribute(name){this.attributes.delete(name);}
    getAttribute(name){return this.attributes.get(name)??null;}
    hasAttribute(name){return this.attributes.has(name);}
    addEventListener(type,handler){const group=this.listeners.get(type)||[];group.push(handler);this.listeners.set(type,group);}
    closest(selector){if(selector==='button')return this.tagName==='BUTTON'?this:null;return this.matches(selector)?this:null;}
    matches(selector){if(selector.startsWith('#'))return selector.slice(1)===this.id;const data=selector.match(/^\[data-([a-z-]+)\]$/);return data?data[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()) in this.dataset:false;}
    querySelector(){return null;}
    querySelectorAll(){return [];}
    contains(){return false;}
    focus(){document.activeElement=this;}
    scrollIntoView(){}
    prepend(){}
  }
  for(const match of staticHtml.matchAll(/\bid="([^"]+)"/g))nodes.set(match[1],new Element(match[1]));
  // Hero artwork is unrelated to this navigation harness; every other node is
  // drawn from the actual static page rather than invented by the test.
  nodes.delete('hero');
  document.querySelector=selector=>selector.startsWith('#')?nodes.get(selector.slice(1))||null:null;
  document.querySelectorAll=()=>[];
  document.createElement=tag=>new Element('',tag.toUpperCase());
  document.addEventListener=(type,handler)=>{const group=listeners.get(type)||[];group.push(handler);listeners.set(type,group);};
  const location={hash};
  const window={
    addEventListener(type,handler){const group=windowListeners.get(type)||[];group.push(handler);windowListeners.set(type,group);},
    dispatchEvent(event){for(const handler of windowListeners.get(event.type)||[])handler(event);},
    scrollTo(){},
    matchMedia(){return {addEventListener(type,handler){if(type==='change')layoutListeners.push(handler);}};},
    AnimeData:{
      loadSeason(year,season,options){requests.push({year,season,options});return loadSeason(year,season,options);},
      getSeasonPreview(year,season,options){previewRequests.push({year,season,options});return getSeasonPreview(year,season,options);},
      getSchedule:async()=>{scheduleRequests.push(clock.now);return response([]);},
    },
    AnimeScheduleView:{mount(target,{state,focusNow}){if(target){mapCalls.push(target.id);mapSnapshots.push({week:state.week.map(date=>date.toISOString().slice(0,10)),day:state.day,weekOffset:state.weekOffset,mapPastOpen:state.mapPastOpen,focusNow});}return 0;}},
  };
  const storage=new Map();
  const context={window,document,location,Date:ClockDate,Intl,URL,AbortController,DOMException,console,
    CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}},
    history:{replaceState(_state,_title,value){location.hash=value;}},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    setInterval(handler){intervals.push(handler);return intervals.length;},setTimeout(){return 1;},clearTimeout(){},
  };
  runInNewContext(source,context,{filename:'app.js'});
  function dispatch(type,target){const event={type,target,preventDefault(){},key:''};for(const handler of target.listeners.get(type)||[])handler(event);for(const handler of listeners.get(type)||[])handler(event);}
  const click=(dataset={},attributes=[])=>{const button=new Element('','BUTTON');button.dataset={...dataset};for(const attribute of attributes)button.setAttribute(attribute,'');dispatch('click',button);};
  const change=(id,value)=>{const node=nodes.get(id);assert.ok(node,`actual markup must include #${id}`);node.value=String(value);dispatch('change',node);};
  return {window,document,nodes,requests,previewRequests,mapCalls,mapSnapshots,scheduleRequests,click,change,state:()=>window.animeTakvimi.getState(),
    advanceTo(value,{tick=true}={}){clock.now=Date.parse(value);if(tick)for(const handler of intervals)handler();},
    setHidden(hidden){document.hidden=hidden;for(const handler of listeners.get('visibilitychange')||[])handler({type:'visibilitychange'});},
    focus(){window.dispatchEvent({type:'focus'});},
    resizeLayout(){for(const handler of layoutListeners)handler({type:'change'});},
  };
}

test('seasons navigation opens the four-quarter library instead of the catalog or weekly map',async()=>{
  const ui=setup();await flush();
  ui.click({page:'seasons'});
  assert.equal(ui.state().page,'seasons');assert.equal(ui.state().seasonsOpen,false);
  assert.equal(ui.nodes.get('season-library').hidden,false);
  assert.equal(ui.nodes.get('catalog-section').hidden,true);
  const shelves=ui.nodes.get('season-shelves').innerHTML;
  assert.equal((shelves.match(/data-season-quarter="[0-3]"/g)||[]).length,4);
  for(const season of ['Kış','İlkbahar','Yaz','Sonbahar'])assert.ok(shelves.includes(season));
  assert.deepEqual(ui.mapCalls,[]);
  assert.doesNotMatch(staticHtml,/id="home-schedule-map"/);
  assert.doesNotMatch(readFileSync(new URL('../app/anime-markup.ts',import.meta.url),'utf8'),/home-schedule-map/);
});

test('direct seasons hash opens the library and year controls update all four season targets',async()=>{
  const ui=setup({hash:'#seasons'});await flush();
  assert.equal(ui.state().page,'seasons');assert.equal(ui.state().seasonsOpen,false);
  assert.equal(ui.nodes.get('season-library').hidden,false);
  const year=ui.nodes.get('library-year');
  assert.match(year.innerHTML,/value="1917"/);assert.match(year.innerHTML,/value="2027"/);
  ui.change('library-year',2025);
  assert.equal(ui.state().libraryYear,2025);
  assert.equal((ui.nodes.get('season-shelves').innerHTML.match(/data-season-year="2025"/g)||[]).length,4);
  ui.click({libraryYear:'1'});assert.equal(ui.state().libraryYear,2026);
  ui.click({libraryYear:'-1'});assert.equal(ui.state().libraryYear,2025);
  assert.deepEqual(ui.mapCalls,[]);
});

test('choosing winter requests the chosen season and renders every format beyond five cards',async()=>{
  const items=['TV','Film','OVA','ONA','Özel','TV','Film','OVA'].map((format,index)=>anime(index+1,format));
  const ui=setup({loadSeason:async()=>response(items)});await flush();
  ui.click({page:'seasons'});ui.click({seasonYear:'2026',seasonQuarter:'0'});await flush();
  assert.equal(ui.requests.at(-1).year,2026);assert.equal(ui.requests.at(-1).season,'winter');
  assert.equal(ui.state().seasonsOpen,true);assert.equal(ui.state().format,'all');
  assert.equal(ui.nodes.get('season-library').hidden,true);assert.equal(ui.nodes.get('catalog-section').hidden,false);
  assert.equal(countCards(ui.nodes.get('card-grid').innerHTML),items.length);
  assert.equal((ui.nodes.get('card-grid').innerHTML.match(/loading="lazy"/g)||[]).length,items.length);
  for(const item of items)assert.ok(ui.nodes.get('card-grid').innerHTML.includes(`data-id="${item.id}"`));
  assert.equal(ui.nodes.get('load-more').hidden,true);
  assert.deepEqual(ui.mapCalls,[]);
});

test('returning from a season restores the library without displaying stale catalog cards',async()=>{
  const ui=setup({loadSeason:async()=>response([anime(10),anime(11,'Film')])});await flush();
  ui.click({page:'seasons'});ui.click({seasonYear:'2025',seasonQuarter:'2'});await flush();
  assert.equal(ui.state().seasonsOpen,true);
  ui.click({},['data-library-back']);
  assert.equal(ui.state().seasonsOpen,false);assert.equal(ui.state().page,'seasons');
  assert.equal(ui.nodes.get('season-library').hidden,false);assert.equal(ui.nodes.get('catalog-section').hidden,true);
  assert.equal(ui.state().libraryYear,2025);
});

test('a slower previous season response cannot replace the newest selected season',async()=>{
  const pending=[];
  const ui=setup({loadSeason:(year,season,options)=>new Promise(resolve=>pending.push({year,season,options,resolve}))});
  pending[0].resolve(response([]));await flush();
  ui.click({page:'seasons'});ui.click({seasonYear:'2026',seasonQuarter:'0'});
  const winter=pending.at(-1);
  ui.click({},['data-library-back']);ui.click({seasonYear:'2026',seasonQuarter:'1'});
  const spring=pending.at(-1);
  assert.equal(winter.options.signal.aborted,true);
  spring.resolve(response([anime(200,'Film'),anime(201,'ONA')]));await flush();
  winter.resolve(response([anime(100)]));await flush();
  assert.equal(ui.state().season,'2026-spring');
  assert.equal(ui.state().catalogCount,2);
  assert.ok(ui.nodes.get('card-grid').innerHTML.includes('data-id="mal-200"'));
  assert.ok(!ui.nodes.get('card-grid').innerHTML.includes('data-id="mal-100"'));
});

test('season previews request the selected year independently and use at most three safe API posters',async()=>{
  const quarters=['winter','spring','summer','fall'];
  const provided=new Map(quarters.map((season,quarter)=>[season,Array.from({length:4},(_,index)=>anime(300+quarter*10+index))]));
  const ui=setup({loadSeason:async()=>response([anime(50)]),getSeasonPreview:async(year,season)=>response(provided.get(season))});
  await flush();
  assert.equal(ui.previewRequests.length,0,'discovery does not load library artwork');
  const catalogBefore=ui.nodes.get('card-grid').innerHTML;
  ui.click({page:'seasons'});await flush();
  assert.equal(ui.previewRequests.length,4);
  assert.deepEqual(ui.previewRequests.map(request=>[request.year,request.season]),quarters.map(season=>[2026,season]));
  const shelves=ui.nodes.get('season-shelves').innerHTML;
  for(const season of quarters){
    for(const item of provided.get(season).slice(0,3))assert.ok(shelves.includes(item.image));
    assert.ok(!shelves.includes(provided.get(season)[3].image),'one season does not render a fourth poster');
  }
  const sources=Array.from(shelves.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g),match=>match[1]);
  assert.equal((shelves.match(/class="season-preview-poster /g)||[]).length,12);
  assert.equal(new Set(sources).size,12,'each quarter uses three distinct covers; decorative backdrop may repeat one');
  assert.ok(sources.every(src=>/^https:\/\/cdn\.myanimelist\.net\/images\/anime\//.test(src)));
  assert.doesNotMatch(shelves,/generated_images|imagegen|data:image|blob:|\bsrc="\//i);
  const headerArt=ui.nodes.get('season-library-art');
  assert.ok(headerArt,'actual library page has API-powered header art');
  assert.ok(headerArt.innerHTML.includes(provided.get('winter')[0].image));
  assert.doesNotMatch(headerArt.innerHTML,/generated_images|imagegen|data:image|blob:|\bsrc="\//i);
  assert.equal(ui.state().catalogCount,1);assert.equal(ui.requests.length,1);
  assert.equal(ui.nodes.get('card-grid').innerHTML,catalogBefore,'preview metadata does not replace the selected catalog');
});

test('year preview changes abort the prior batch and ignore late results from that year',async()=>{
  const pending=[];
  const ui=setup({hash:'#seasons',getSeasonPreview:(year,season,options)=>new Promise(resolve=>pending.push({year,season,options,resolve}))});
  await flush();
  assert.equal(pending.length,4);
  assert.equal(ui.requests.length,0,'opening the season index does not load the full catalog');
  const old=pending.slice();
  ui.change('library-year',2025);
  await flush();
  const current=pending.filter(request=>request.year===2025);
  assert.equal(current.length,4);assert.ok(old.every(request=>request.options.signal.aborted));
  assert.ok(current.every(request=>!request.options.signal.aborted));
  for(const [index,request] of current.entries())request.resolve(response([anime(500+index)]));
  await flush();
  const currentHtml=ui.nodes.get('season-shelves').innerHTML;
  for(let index=0;index<4;index++)assert.ok(currentHtml.includes(anime(500+index).image));
  for(const [index,request] of old.entries())request.resolve(response([anime(600+index)]));
  await flush();
  assert.equal(ui.state().libraryYear,2025);
  assert.equal(ui.nodes.get('season-shelves').innerHTML,currentHtml);
  for(let index=0;index<4;index++)assert.ok(!ui.nodes.get('season-shelves').innerHTML.includes(anime(600+index).image));
  assert.equal(ui.state().catalogCount,0);assert.equal(ui.requests.length,0);
});

test('library artwork rejects unsafe API image addresses and leaves missing covers as placeholders',async()=>{
  const unsafe=[
    {...anime(700),image:'https://attacker.example/anime.jpg'},
    {...anime(701),image:'http://cdn.myanimelist.net/images/anime/1/701.jpg'},
    {...anime(702),image:'https://name:password@cdn.myanimelist.net/images/anime/1/702.jpg'},
    {...anime(703),image:null},
  ];
  const ui=setup({hash:'#seasons',getSeasonPreview:async()=>response(unsafe)});await flush();
  const shelves=ui.nodes.get('season-shelves').innerHTML;
  assert.doesNotMatch(shelves,/<img\b/);
  assert.doesNotMatch(shelves,/attacker\.example|name:password|http:\/\/cdn/);
  assert.equal((shelves.match(/data-season-quarter="[0-3]"/g)||[]).length,4,'unavailable art does not remove season navigation');
});

test('preview timeout and empty responses keep independent placeholders and retry only the failed quarter',async()=>{
  const attempts=new Map();
  const ui=setup({hash:'#seasons',getSeasonPreview:async(year,season)=>{
    attempts.set(season,(attempts.get(season)||0)+1);
    if(season==='winter' && attempts.get(season)===1)throw new Error('Veri servisi zamanında yanıt vermedi.');
    if(season==='spring')return response([]);
    return {...response([anime(season==='winter'?800:season==='summer'?801:802)]),stale:season==='fall'};
  }});
  assert.match(ui.nodes.get('season-shelves').innerHTML,/Afişler yükleniyor/);
  await flush();
  const shelves=ui.nodes.get('season-shelves').innerHTML;
  assert.match(shelves,/Afişler yüklenemedi/);
  assert.match(shelves,/Bu sezon için afiş bulunamadı/);
  assert.ok(shelves.includes(anime(801).image));assert.ok(shelves.includes(anime(802).image),'stale cached preview remains usable');
  assert.match(shelves,/data-preview-retry="0"/);
  const seasonButtons=Array.from(shelves.matchAll(/<button\b[^>]*data-season-year="\d+"[^>]*>[\s\S]*?<\/button>/g),match=>match[0]);
  assert.equal(seasonButtons.length,4);
  assert.ok(seasonButtons.every(html=>!html.includes('data-preview-retry')),'retry controls must not nest inside season buttons');
  ui.click({previewRetry:'0',previewYear:'2026'});await flush();
  assert.equal(ui.previewRequests.length,5);assert.equal(ui.previewRequests.at(-1).season,'winter');
  assert.equal(ui.previewRequests.at(-1).options.force,true);
  assert.ok(ui.nodes.get('season-shelves').innerHTML.includes(anime(800).image));
  assert.doesNotMatch(ui.nodes.get('season-shelves').innerHTML,/Afişler yüklenemedi/);
  assert.equal(ui.requests.length,0,'retrying artwork never starts a full catalog load');
});

test('the nearby-year rail stays in supported bounds and selects a year through the common path',async()=>{
  const ui=setup({hash:'#seasons'});await flush();
  const yearsIn=html=>Array.from(html.matchAll(/data-library-select-year="(\d+)"/g),match=>Number(match[1]));
  const rail=ui.nodes.get('season-year-rail');
  assert.ok(rail,'actual page includes the nearby-year rail');
  const current=yearsIn(rail.innerHTML);
  assert.equal(current.length,5);assert.ok(current.includes(2026));assert.ok(current.every(year=>year>=1917 && year<=2027));
  ui.click({librarySelectYear:'2024'});await flush();
  assert.equal(ui.state().libraryYear,2024);assert.equal(ui.nodes.get('library-year').value,'2024');
  assert.equal(ui.previewRequests.filter(request=>request.year===2024).length,4);
  ui.change('library-year',1917);await flush();
  assert.ok(yearsIn(rail.innerHTML).every(year=>year>=1917 && year<=2027));
  assert.ok(yearsIn(rail.innerHTML).includes(1917));
});

test('leaving the season index aborts artwork without letting late previews replace the catalog',async()=>{
  const pending=[];
  const ui=setup({hash:'#seasons',loadSeason:async()=>response([anime(900)]),getSeasonPreview:(year,season,options)=>new Promise(resolve=>pending.push({year,season,options,resolve}))});
  await flush();assert.equal(pending.length,4);
  ui.click({seasonYear:'2026',seasonQuarter:'0'});await flush();
  assert.ok(pending.every(request=>request.options.signal.aborted));
  assert.equal(ui.state().seasonsOpen,true);assert.equal(ui.state().catalogCount,1);
  for(const [index,request] of pending.entries())request.resolve(response([anime(950+index)]));
  await flush();
  assert.equal(ui.state().catalogCount,1);assert.equal(countCards(ui.nodes.get('card-grid').innerHTML),1);
  assert.ok(ui.nodes.get('card-grid').innerHTML.includes('data-id="mal-900"'));
  assert.doesNotMatch(ui.nodes.get('card-grid').innerHTML,/data-id="mal-95[0-3]"/);
});

test('old cached preview timestamps do not cause an automatic fetch-and-render loop',async()=>{
  let attempts=0;
  const ui=setup({hash:'#seasons',getSeasonPreview:async()=>{
    // Bound a regression's requests so a failed test cannot create an endless
    // promise/microtask loop in the VM.
    if(++attempts>8)throw new Error('Preview request budget exceeded');
    return {...response([anime(990)]),fetchedAt:fixedTime-7*24*60*60*1000,stale:true};
  }});
  await flush();
  for(let index=0;index<3;index++)ui.window.animeTakvimi.refreshView();
  await flush();
  assert.equal(ui.previewRequests.length,4,'one fetch per quarter is enough even when the API serves old cached images');
  assert.match(ui.nodes.get('season-shelves').innerHTML,/Son alınan afişler/);
  assert.ok(ui.nodes.get('season-shelves').innerHTML.includes(anime(990).image));
});


test('schedule clock refreshes at the next minute without rerendering every second',async()=>{
  const ui=setup({hash:'#schedule',now:Date.parse('2026-10-16T14:15:59Z')});await flush();
  const before=ui.mapSnapshots.length;
  ui.advanceTo('2026-10-16T14:16:00Z');
  assert.equal(ui.mapSnapshots.length,before+1);
  ui.advanceTo('2026-10-16T14:16:20Z');
  assert.equal(ui.mapSnapshots.length,before+1);
  assert.equal(ui.scheduleRequests.length,1,'minute ticks do not refetch the weekly feed');
});

test('returning to a hidden calendar resyncs the Istanbul date and week after midnight',async()=>{
  const ui=setup({hash:'#schedule',now:Date.parse('2026-10-18T20:59:00Z')});await flush();
  assert.equal(ui.mapSnapshots.at(-1).week[0],'2026-10-12');
  const before=ui.mapSnapshots.length;
  ui.setHidden(true);ui.advanceTo('2026-10-18T21:05:00Z');
  assert.equal(ui.mapSnapshots.length,before);
  ui.setHidden(false);await flush();
  assert.equal(ui.mapSnapshots.at(-1).week[0],'2026-10-19');
  assert.equal(ui.mapSnapshots.at(-1).day,0);
  assert.equal(ui.scheduleRequests.length,2);
});

test('the now button and reopening the calendar request the actual current week and time',async()=>{
  const ui=setup({hash:'#schedule'});await flush();
  ui.click({mapWeek:'1'});
  assert.equal(ui.mapSnapshots.at(-1).weekOffset,1);
  ui.click({},['data-map-today']);
  assert.equal(ui.mapSnapshots.at(-1).weekOffset,0);
  assert.equal(ui.mapSnapshots.at(-1).focusNow,true);
  ui.click({page:'discover'});await flush();
  ui.advanceTo('2026-10-19T07:00:00Z',{tick:false});
  ui.click({page:'schedule'});
  assert.equal(ui.mapSnapshots.at(-1).week[0],'2026-10-19');
  assert.equal(ui.mapSnapshots.at(-1).day,0);
  assert.equal(ui.mapSnapshots.at(-1).focusNow,true);
});

test('window focus catches up after the device clock advances while timers are paused',async()=>{
  const ui=setup({hash:'#schedule'});await flush();
  const before=ui.mapSnapshots.length;
  ui.advanceTo('2026-10-16T15:45:00Z',{tick:false});
  ui.focus();
  assert.equal(ui.mapSnapshots.length,before+1);
});


test('agenda day selection and the elapsed toggle stay interactive through a minute refresh',async()=>{
  const ui=setup({hash:'#schedule'});await flush();
  ui.click({mapDay:'2'});
  assert.equal(ui.mapSnapshots.at(-1).day,2);
  ui.click({},['data-map-past']);
  assert.equal(ui.mapSnapshots.at(-1).mapPastOpen,true);
  ui.advanceTo('2026-10-16T09:01:00Z');
  assert.equal(ui.mapSnapshots.at(-1).day,2);
  assert.equal(ui.mapSnapshots.at(-1).mapPastOpen,true);
  ui.click({mapDay:'5'});
  assert.equal(ui.mapSnapshots.at(-1).day,5);
  assert.equal(ui.mapSnapshots.at(-1).mapPastOpen,false);
  ui.click({mapDay:'99'});
  assert.equal(ui.mapSnapshots.at(-1).day,5);
});

test('switching between touch and desktop layout repositions the map without requesting data again',async()=>{
  const ui=setup({hash:'#schedule'});await flush();
  const requests=ui.scheduleRequests.length;
  ui.resizeLayout();
  assert.equal(ui.mapSnapshots.at(-1).focusNow,true);
  assert.equal(ui.scheduleRequests.length,requests);
});
