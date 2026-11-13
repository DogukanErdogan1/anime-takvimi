import {validateLibrary} from './membership.mjs';
const empty = () => ({saved:[],reminders:[],progress:{},savedAnime:{},view:'grid',tracking:{},scores:{},favorites:[],collections:[]});
export function exportLibrary(library) {
  const clean=validateLibrary({library});
  return JSON.stringify({format:'anime-takvimi',version:1,exportedAt:new Date().toISOString(),library:{...clean,reminders:[]}},null,2);
}
export function parseLibraryJson(text) {
  if(typeof text!=='string'||new TextEncoder().encode(text).length>1048576)throw new Error('Dosya en fazla 1 MiB olabilir.');
  const value=JSON.parse(text);
  if(value?.format!=='anime-takvimi'||value.version!==1)throw new Error('Anime Takvimi JSON yedeği seç.');
  const library={...empty(),...validateLibrary({library:value.library})};
  for(const id of new Set([...library.saved,...Object.keys(library.savedAnime),...Object.keys(library.tracking),...library.favorites,...library.collections.flatMap(collection=>collection.animeIds)])){const old=library.savedAnime[id]||{id,title:'MyAnimeList #'+id.slice(4)};if(old.malId!==undefined&&old.malId!==Number(id.slice(4)))throw new Error('Anime numarası kayıtla eşleşmiyor.');const base=fromMalEntries([{id:Number(id.slice(4)),title:old.title,status:library.tracking[id]||'planned',progress:library.progress[id]||0,score:library.scores[id]||0}]).savedAnime[id];library.savedAnime[id]={...base,...old};}
  return library;
}
export function fromMalEntries(entries) {
  if(!Array.isArray(entries)||entries.length>500)throw new Error('En fazla 500 anime aktarılabilir.');
  const library=empty(),seen=new Set();
  const statuses={'1':'watching','2':'completed','3':'planned','4':'dropped','6':'planned','watching':'watching','completed':'completed','on-hold':'planned','dropped':'dropped','plan to watch':'planned'};
  for(const row of entries){
    const malId=Number(row.id),title=String(row.title||'').trim(),id='mal-'+malId;
    if(!Number.isSafeInteger(malId)||malId<1||malId>2147483647||!title||title.length>500)throw new Error('Dosyada geçersiz anime bilgisi var.');
    if(seen.has(id))continue;seen.add(id);
    const progress=Number(row.progress||0),episodes=Number(row.episodes||0),score=Number(row.score||0);
    if(!Number.isInteger(progress)||progress<0||progress>9999||!Number.isInteger(episodes)||episodes<0||episodes>9999||!Number.isInteger(score)||score<0||score>10)throw new Error('Bölüm veya puan bilgisi geçersiz.');
    library.saved.push(id);library.progress[id]=progress;library.tracking[id]=statuses[String(row.status).toLowerCase()]||'planned';
    if(score)library.scores[id]=score;
    library.savedAnime[id]={id,malId,title,image:null,original:title,synonyms:[],genres:[],episodes:episodes||null,rating:null,studio:'',summary:'',malUrl:'https://myanimelist.net/anime/'+malId,format:'TV',members:0,day:null,time:null,broadcastLocal:false,airing:false,status:''};
  }
  return {...empty(),...validateLibrary({library})};
}
export function mergeLibraries(current,incoming) {
  const before={...empty(),...validateLibrary({library:current})},added={...empty(),...validateLibrary({library:incoming})};
  const collections=[...before.collections];
  for(const item of added.collections)if(!collections.some(existing=>existing.id===item.id))collections.push(item);
  const merged={...before,saved:[...new Set([...before.saved,...added.saved])],savedAnime:{...added.savedAnime,...before.savedAnime},progress:{...added.progress,...before.progress},tracking:{...added.tracking,...before.tracking},scores:{...added.scores,...before.scores},favorites:[...new Set([...before.favorites,...added.favorites])],collections};
  return {...empty(),...validateLibrary({library:merged})};
}
export function libraryCsv(library) {
  const value={...empty(),...validateLibrary({library})};
  const cell=value=>'"'+String(typeof value==='string'&&/^[=+@-]/.test(value)?"'"+value:value??'').replaceAll('"','""')+'"';
  return '\ufeff'+[['MAL ID','Anime','Durum','İzlenen bölüm','Puan'],...value.saved.map(id=>[value.savedAnime[id]?.malId||'',value.savedAnime[id]?.title||id,value.tracking[id]||'planned',value.progress[id]||0,value.scores[id]||''])].map(row=>row.map(cell).join(',')).join('\r\n');
}
