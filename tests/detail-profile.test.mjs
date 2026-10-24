import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = readFileSync(new URL('../components/experience/detail-profile.tsx', import.meta.url), 'utf8');
const runtime = resolve('.sites-runtime');
mkdirSync(runtime, {recursive: true});
const compiled = resolve(runtime, `detail-profile-test-${process.pid}.mjs`);
const modelCompiled = resolve(runtime, `detail-profile-model-test-${process.pid}.mjs`);
const watchStatusCompiled = resolve(runtime, `detail-profile-watch-status-test-${process.pid}.mjs`);
const compilerOptions = {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX};
writeFileSync(modelCompiled, ts.transpileModule(readFileSync(new URL('../components/experience/model.ts',import.meta.url),'utf8'), {compilerOptions}).outputText);
writeFileSync(watchStatusCompiled, ts.transpileModule(readFileSync(new URL('../components/experience/watch-status-select.tsx',import.meta.url),'utf8'), {compilerOptions}).outputText);
const profileSource=source
  .replace(/import \{AvatarFrame\} from '\.\/avatar-frame';/, 'const AvatarFrame=()=>null;')
  .replace(/import AvatarFramePicker from '\.\/avatar-frame-picker';/, 'const AvatarFramePicker=()=>null;')
  .replace("from '../../lib/avatar-frames.mjs'", `from '${new URL('../lib/avatar-frames.mjs',import.meta.url).href}'`)
  .replace("from './model'", `from './detail-profile-model-test-${process.pid}.mjs'`)
  .replace("from './watch-status-select'", `from './detail-profile-watch-status-test-${process.pid}.mjs'`);
writeFileSync(compiled, ts.transpileModule(profileSource, {compilerOptions}).outputText);
after(() => { for(const file of [compiled,modelCompiled,watchStatusCompiled]) try { unlinkSync(file); } catch {} });
const { AnimeDetail, ProfileView, ProfileInsights, ProfileAnimeCard, ProfileLibraryEditor, ProfileClassicAnimeCard } = await import(pathToFileURL(compiled).href);
const item = {id:'mal-123',malId:123,title:'Test anime',original:'Test anime',image:'https://cdn.myanimelist.net/images/anime/1/123.jpg',genres:['Aksiyon'],episodes:12,rating:8.5,studio:'Studio',summary:'Hikâye özeti.',malUrl:'https://myanimelist.net/anime/123',format:'TV',members:1,day:null,time:null,broadcastLocal:false,airing:false,status:'Tamamlandı',year:2026};
const library = () => ({saved:[],reminders:[],progress:{},view:'grid',savedAnime:{},tracking:{},scores:{},favorites:[],collections:[]});
const snapshot = (patch={}) => ({ready:true,page:'discover',catalog:[item],schedule:[],library:library(),account:null,accountScope:null,loading:false,error:null,libraryLoading:false,blocked:false,...patch});
const account = {authenticated:true,registered:true,user:{id:'user-1',displayName:'Kullanıcı',role:'member',status:'active'}};
const renderDetail = (state, anime=item) => renderToStaticMarkup(React.createElement(AnimeDetail,{item:anime,snapshot:state,onClose(){},onChange(){}}));
function statusTrigger(html){const trigger=html.match(/<button\b[^>]*\brole="combobox"[^>]*>/)?.[0];assert.ok(trigger,'the visible watch status combobox must be rendered');return trigger;}

test('guest detail supports local tracking while comments require sign-in', () => {
  const html = renderDetail(snapshot());
  assert.match(html, /href="\/giris"/);
  assert.match(html, /href="\/uye-ol"/);
  assert.doesNotMatch(html, /<select disabled=""/);
  assert.doesNotMatch(statusTrigger(html), /disabled=""/);
  assert.match(html, /Listen bu tarayıcıda saklanır/);
  assert.doesNotMatch(html, /at-review-form/);
  assert.match(html, /Fragman ve bağlantılı seriler yükleniyor/);
});

test('active member detail reflects stored status, score, favorite and real progress', () => {
  const data = library();
  Object.assign(data,{saved:[item.id],savedAnime:{[item.id]:item},tracking:{[item.id]:'watching'},scores:{[item.id]:9},favorites:[item.id],reminders:[item.id],progress:{[item.id]:4}});
  const html = renderDetail(snapshot({account,library:data}));
  assert.match(statusTrigger(html), /data-watch-status="watching"/);
  assert.match(html, /value="9" selected=""/);
  assert.match(html, /aria-label="Favorilerden çıkar" aria-pressed="true"/);
  assert.match(html, /aria-label="Yayın hatırlatmasını kapat" aria-pressed="true"/);
  assert.match(html, /aria-valuenow="4" aria-valuemin="0" aria-valuemax="12"/);
  assert.match(html, /id="at-detail-progress"[^>]*max="12"[^>]*value="4"/);
  assert.match(html, /at-review-form/);
});

test('blocked or loading libraries cannot edit tracking or post reviews', () => {
  for (const restriction of [{blocked:true},{libraryLoading:true},{account:{...account,user:{...account.user,status:'suspended'}}}]) {
    const html = renderDetail(snapshot({account,...restriction}));
    assert.match(html, /<select disabled=""/);
    assert.match(statusTrigger(html), /disabled=""/);
    assert.doesNotMatch(html, /at-review-form/);
  }
});

test('unsafe API image and external MAL URLs are excluded from rendered detail', () => {
  const html = renderDetail(snapshot(), {...item,image:'https://attacker.example/poster.jpg',malUrl:'https://myanimelist.net.attacker.example/anime/123',summary:'<script>alert(1)</script>'});
  assert.doesNotMatch(html, /attacker\.example/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Afiş bulunamadı/);
});

test('unknown episode totals stay unknown and completed series cannot increment', () => {
  const data = {...library(),progress:{[item.id]:12}};
  const complete = renderDetail(snapshot({account,library:data}));
  assert.match(complete, /disabled="" aria-label="Bir bölüm izledim"/);
  const unknown = renderDetail(snapshot({account}),{...item,episodes:null});
  assert.match(unknown, /Bölüm sayısı belirsiz/);
  assert.match(unknown, /max="9999"/);
  assert.doesNotMatch(unknown, /role="progressbar"/);
});

test('own profile for guest offers account actions without rendering personal data', () => {
  const html = renderToStaticMarkup(React.createElement(ProfileView,{snapshot:snapshot(),onClose(){},onChange(){},onOpenDetail(){}}));
  assert.match(html, /Anime yolculuğun burada başlasın/);
  assert.match(html, /href="\/giris"/);
  assert.match(html, /href="\/uye-ol"/);
  assert.doesNotMatch(html, /Profilimi ve anime listelerimi herkese aç/);
  assert.doesNotMatch(html, /at-stat-grid/);
});

test('profile insights show a truthful status distribution and jump to the selected library category',()=>{
  const items=[{...item,id:'mal-1'},{...item,id:'mal-2'},{...item,id:'mal-3'},{...item,id:'mal-4'}];
  const data={...library(),tracking:{'mal-1':'watching','mal-2':'planned','mal-3':'completed','mal-4':'completed'},progress:{'mal-1':3,'mal-3':12,'mal-4':12}};
  const chosen=[];
  const tree=ProfileInsights({items,library:data,isOwner:true,onStatusSelect:value=>chosen.push(value)});
  const html=renderToStaticMarkup(tree);
  assert.match(html,/İzliyorum: 1 anime, İzleyeceğim: 1 anime, Tamamladım: 2 anime, Bıraktım: 0 anime/);
  assert.equal((html.match(/data-status="(?:watching|planned|completed|dropped)"/g)||[]).length,4);
  assert.match(html,/aria-label="Tamamladım: 2 anime\. Listede göster"/);
  assert.match(html,/<strong>%50<\/strong> tamamlandı/);
  assert.match(html,/<strong>27<\/strong> bölüm izlendi/);
  function find(node){if(!node||typeof node!=='object')return null;if(Array.isArray(node)){for(const child of node){const match=find(child);if(match)return match;}return null;}if(node.type==='button'&&node.props['data-status']==='planned')return node;return find(node.props?.children);}
  find(tree).props.onClick();
  assert.deepEqual(chosen,['planned']);
});

test('genre titles use watched series as the denominator and never count planned-only series',()=>{
  const items=[{...item,id:'mal-1',genres:['Aksiyon','Aksiyon','Fantastik']},{...item,id:'mal-2',genres:['Aksiyon']},{...item,id:'mal-3',genres:['Macera']}];
  const data={...library(),tracking:{'mal-1':'watching','mal-2':'completed','mal-3':'planned'},progress:{'mal-1':2}};
  const html=renderToStaticMarkup(React.createElement(ProfileInsights,{items,library:data,isOwner:true,onStatusSelect(){}}));
  const genreSection=html.slice(html.indexOf('at-insight-genres'));
  assert.match(genreSection,/Aksiyon/);assert.match(genreSection,/Fantastik/);assert.doesNotMatch(genreSection,/Macera/);
  assert.match(genreSection,/<b>2<\/b> seri/);assert.match(genreSection,/%100/);assert.match(genreSection,/%50/);
  assert.match(genreSection,/2 izlenen seri üzerinden/);
});

test('empty profile insights retain usable zero-count filters and explain how genre titles become available',()=>{
  const html=renderToStaticMarkup(React.createElement(ProfileInsights,{items:[],library:library(),isOwner:true,onStatusSelect(){}}));
  assert.match(html,/Listede henüz anime yok/);
  assert.match(html,/Hikâyelerin zevkini anlatsın/);
  assert.doesNotMatch(html,/NaN|Infinity|at-donut-segment/);
  assert.equal((html.match(/: 0 anime\. Listede göster/g)||[]).length,4);
});

test('opening sequence artwork comes from the correct library category and watched genre, with safe empty fallbacks',()=>{
  const watching={...item,id:'mal-1',image:'https://cdn.myanimelist.net/images/watching.jpg',genres:['Aksiyon']};
  const planned={...item,id:'mal-2',image:'https://cdn.myanimelist.net/images/planned.jpg',genres:['Macera']};
  const unsafe={...item,id:'mal-3',image:'https://cdn.myanimelist.net.attacker.example/image.jpg',genres:['Fantastik']};
  const data={...library(),tracking:{'mal-1':'watching','mal-2':'planned','mal-3':'completed'},progress:{'mal-1':2,'mal-3':12}};
  const html=renderToStaticMarkup(React.createElement(ProfileInsights,{items:[watching,planned,unsafe],library:data,isOwner:false,onStatusSelect(){}}));
  const statusButton=status=>html.match(new RegExp(`<button[^>]*data-status="${status}"[\\s\\S]*?<\\/button>`))?.[0]||'';
  assert.match(statusButton('watching'),/images\/watching\.jpg/);
  assert.doesNotMatch(statusButton('watching'),/images\/planned\.jpg/);
  assert.match(statusButton('planned'),/images\/planned\.jpg/);
  assert.doesNotMatch(statusButton('completed'),/background-image/);
  assert.doesNotMatch(statusButton('dropped'),/background-image/);
  const genreSection=html.slice(html.indexOf('at-insight-genres'));
  assert.match(genreSection,/images\/watching\.jpg/);
  assert.doesNotMatch(genreSection,/images\/planned\.jpg|Macera/);
  assert.doesNotMatch(html,/attacker\.example|undefined|NaN/);
  assert.match(html,/İzleme durumları/);
  assert.match(html,/Tür dağılımı/);
});

function findElement(node,predicate){
  if(!node||typeof node!=='object')return null;
  if(Array.isArray(node)){for(const child of node){const found=findElement(child,predicate);if(found)return found;}return null;}
  if(predicate(node))return node;
  return findElement(node.props?.children,predicate);
}

test('cinematic library card displays actual progress, score and favorite, and opens the correct anime',()=>{
  const data={...library(),tracking:{[item.id]:'watching'},progress:{[item.id]:3},scores:{[item.id]:9},favorites:[item.id]};
  const opened=[];
  const tree=ProfileAnimeCard({item,library:data,canEdit:true,onChange(){},onOpenDetail:value=>opened.push(value.id)});
  const html=renderToStaticMarkup(tree);
  assert.match(html,/İzliyorum/);assert.match(html,/3 \/ 12 bölüm/);
  assert.match(html,/aria-valuenow="3" aria-valuemin="0" aria-valuemax="12"/);
  assert.match(html,/width:25%/);assert.match(html,/aria-label="Favori"/);
  assert.match(html,/at-library-score/);
  findElement(tree,node=>node.props?.className==='at-library-poster').props.onClick();
  assert.deepEqual(opened,[item.id]);
});

test('episode button preserves unrelated data and uses current progress for repeated clicks at the last episode',()=>{
  let data={...library(),saved:['mal-other'],progress:{[item.id]:11,'mal-other':5},collections:[{id:'keep',title:'Keep',animeIds:['mal-other']}]};
  const tree=ProfileAnimeCard({item,library:data,canEdit:true,onOpenDetail(){},onChange:patch=>{data={...data,...(typeof patch==='function'?patch(data):patch)};}});
  const button=findElement(tree,node=>node.props?.className==='at-library-advance');
  button.props.onClick();button.props.onClick();
  assert.equal(data.progress[item.id],12);assert.equal(data.tracking[item.id],'completed');
  assert.equal(data.progress['mal-other'],5);assert.ok(data.saved.includes('mal-other'));
  assert.deepEqual(data.collections,[{id:'keep',title:'Keep',animeIds:['mal-other']}]);
  assert.equal(data.savedAnime[item.id].id,item.id);
  const finished=ProfileAnimeCard({item,library:data,canEdit:true,onChange(){throw Error('Completed card cannot mutate');},onOpenDetail(){}});
  const done=findElement(finished,node=>node.props?.className==='at-library-advance');
  assert.equal(done.props.disabled,true);done.props.onClick();
});

test('unknown totals never invent a percentage or completion, and the supported episode limit is respected',()=>{
  const unknown={...item,episodes:null};
  let data={...library(),progress:{[item.id]:9998}};
  const props={item:unknown,library:data,canEdit:true,onOpenDetail(){},onChange:patch=>{data={...data,...(typeof patch==='function'?patch(data):patch)};}};
  const tree=ProfileAnimeCard(props),html=renderToStaticMarkup(tree);
  assert.match(html,/9998 \/ \? bölüm/);assert.doesNotMatch(html,/role="progressbar"|NaN|Infinity/);
  findElement(tree,node=>node.props?.className==='at-library-advance').props.onClick();
  assert.equal(data.progress[item.id],9999);assert.equal(data.tracking[item.id],'watching');
  const limited=ProfileAnimeCard({...props,library:data});
  const button=findElement(limited,node=>node.props?.className==='at-library-advance');
  assert.equal(button.props.disabled,true);assert.match(button.props['aria-label'],/bölüm sınırına ulaşıldı/);
});

test('read-only library cards have no progress mutation controls and unsafe images remain excluded',()=>{
  const tree=ProfileAnimeCard({item:{...item,image:'https://attacker.example/image.jpg'},library:library(),canEdit:false,onChange(){throw Error('Read-only card cannot mutate');},onOpenDetail(){}});
  assert.equal(findElement(tree,node=>node.props?.className==='at-library-advance'),null);
  const html=renderToStaticMarkup(tree);
  assert.doesNotMatch(html,/attacker\.example/);assert.match(html,/Afiş bulunamadı/);
});


test('profile favorite toggle uses the latest library and preserves other lists',()=>{
  let data={...library(),favorites:['other'],collections:[{id:'keep',title:'Keep',animeIds:['other']}]};
  const tree=ProfileLibraryEditor({item,library:data,canEdit:true,onChange:patch=>{data={...data,...patch(data)};}});
  const toggle=findElement(tree,node=>node.props?.className==='at-library-favorite-toggle');
  toggle.props.onClick();
  assert.deepEqual(data.favorites,['other',item.id]);
  data={...data,favorites:[...data.favorites,'added-later']};
  toggle.props.onClick();
  assert.deepEqual(data.favorites,['other','added-later']);
  assert.deepEqual(data.collections,[{id:'keep',title:'Keep',animeIds:['other']}]);
  assert.equal(data.savedAnime[item.id].id,item.id);
  assert.ok(data.saved.includes(item.id));
});

test('profile status editing fills completed episodes and preserves progress for other statuses',()=>{
  let data={...library(),progress:{[item.id]:3,other:8}};
  const tree=ProfileLibraryEditor({item,library:data,canEdit:true,onChange:patch=>{data={...data,...patch(data)};}});
  const selector=findElement(tree,node=>node.type?.name==='WatchStatusSelect');
  selector.props.onChange('completed');
  assert.equal(data.tracking[item.id],'completed');assert.equal(data.progress[item.id],12);
  for(const status of ['planned','watching','dropped']){
    selector.props.onChange(status);
    assert.equal(data.tracking[item.id],status);assert.equal(data.progress[item.id],12);
  }
  selector.props.onChange('invalid');assert.equal(data.tracking[item.id],'dropped');
  assert.equal(data.progress.other,8);
});

test('profile progress editing handles stale clicks, completion, corrections and unknown episode limits',()=>{
  let data={...library(),progress:{[item.id]:10,other:7}};
  const onChange=patch=>{data={...data,...patch(data)};};
  const tree=ProfileLibraryEditor({item,library:data,canEdit:true,onChange});
  const plus=findElement(tree,node=>node.props?.['aria-label']===item.title+': bölüm sayısını artır');
  const minus=findElement(tree,node=>node.props?.['aria-label']===item.title+': bölüm sayısını azalt');
  const input=findElement(tree,node=>node.type==='input');
  plus.props.onClick();plus.props.onClick();plus.props.onClick();
  assert.equal(data.progress[item.id],12);assert.equal(data.tracking[item.id],'completed');
  minus.props.onClick();assert.equal(data.progress[item.id],11);assert.equal(data.tracking[item.id],'watching');
  input.props.onChange({target:{value:'-100'}});
  assert.equal(data.progress[item.id],0);assert.equal(data.tracking[item.id],'planned');
  input.props.onChange({target:{value:'6.7'}});assert.equal(data.progress[item.id],6);
  input.props.onChange({target:{value:'NaN'}});assert.equal(data.progress[item.id],6);
  assert.equal(data.progress.other,7);
  const unknown=ProfileLibraryEditor({item:{...item,episodes:null},library:data,canEdit:true,onChange});
  findElement(unknown,node=>node.type==='input').props.onChange({target:{value:'99999'}});
  assert.equal(data.progress[item.id],9999);assert.equal(data.tracking[item.id],'watching');
});

test('both profile list designs expose direct editing only for editable libraries',()=>{
  for(const component of [ProfileAnimeCard,ProfileClassicAnimeCard]){
    for(const canEdit of [true,false]){
      const tree=component({item,library:library(),canEdit,onChange(){},onOpenDetail(){}});
      const html=renderToStaticMarkup(tree);
      assert.equal(html.includes('izleme bilgilerini düzenle'),canEdit);
      assert.equal(html.includes('favorilere ekle'),canEdit);
      assert.equal(html.includes('izlediğin bölüm sayısı'),canEdit);
      const detailButton=findElement(tree,node=>node.props?.className==='at-profile-anime');
      if(detailButton)assert.equal(findElement(detailButton.props.children,node=>node.type==='button'),null);
    }
  }
  assert.equal(ProfileLibraryEditor({item,library:library(),canEdit:false,onChange(){throw Error('read only');}}),null);
});
