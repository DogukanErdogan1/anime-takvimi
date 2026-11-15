// Both features deliberately use recorded data, without guessing missing durations or dates.
export function eveningPicks(items, library, {minutes=60,genre='',mood='',format='all',source='all'}={}) {
 const moods={calm:['Slice of Life','Iyashikei','Romance','Yaşamdan Kesit','Yaşamdan Kesitler','Romantik','Romantizm'],fun:['Comedy','Komedi'],intense:['Action','Thriller','Suspense','Aksiyon','Gerilim'],wonder:['Fantasy','Adventure','Sci-Fi','Fantastik','Macera','Bilim Kurgu']};
 const budget=Number(minutes);if(!Number.isFinite(budget)||budget<1)return [];
 const saved=new Set(library.saved||[]),seen=new Set();
 return items.flatMap(item=>{
  if(!item||seen.has(item.id))return [];seen.add(item.id);
  const status=library.tracking?.[item.id],progress=library.progress?.[item.id]||0;
  if(status==='completed'||status==='dropped'||(item.episodes&&progress>=item.episodes)||source==='saved'&&!saved.has(item.id))return [];
  if(/upcoming|henüz|yakında|not yet/i.test(item.status||'')||(item.airedFrom&&Date.parse(item.airedFrom)>Date.now()))return [];
  const movie=/^movie$|^film$/i.test(item.format),duration=Number(item.duration);
  if(!Number.isFinite(duration)||duration<=0||duration>budget||format==='movie'&&!movie||format==='series'&&movie)return [];
  const genres=item.genres||[];
  if(genre&&!genres.includes(genre)||mood&&!(moods[mood]||[]).some(g=>genres.some(v=>v.toLowerCase()===g.toLowerCase())))return [];
  // An airing title's eventual total does not prove that later episodes are available.
  const count=movie||item.airing||!item.episodes?1:Math.min(Math.floor(budget/duration),Math.max(0,item.episodes-progress));
  if(!count)return [];
  return [{item,count,minutes:count*duration,from:progress+1,reason:status==='watching'?'Kaldığın yerden':saved.has(item.id)?'Listenden bir hikâye':'Yeni bir keşif',rank:(status==='watching'?30:saved.has(item.id)?15:0)+(item.rating||0)}];
 }).sort((a,b)=>b.rank-a.rank||a.item.title.localeCompare(b.item.title,'tr')).slice(0,6);
}

export function recapYears(activity=[],now=new Date()) {
 const current=Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Istanbul',year:'numeric'}).format(now));
 return [...new Set([current,...activity.filter(e=>Number.isSafeInteger(e.at)&&e.at>=0&&e.at<=now.getTime()).map(e=>Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Istanbul',year:'numeric'}).format(new Date(e.at))))])].sort((a,b)=>b-a);
}
export function annualRecap(library,year,now=new Date()) {
 const formatter=new Intl.DateTimeFormat('en',{timeZone:'Europe/Istanbul',year:'numeric'});
 const entries=(library.activity||[]).filter(e=>Number.isSafeInteger(e.at)&&e.at>=0&&e.at<=now.getTime()&&Number(formatter.format(new Date(e.at)))===year).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
 const totals=new Map(),last=new Map();
 for(const e of entries){totals.set(e.animeId,(totals.get(e.animeId)||0)+e.to-e.from);last.set(e.animeId,e);}
 const titles=[...totals].map(([id,total])=>({id,episodes:Math.max(0,total),item:library.savedAnime?.[id]||{id,malId:Number(id.slice(4)),title:last.get(id).title,image:null,genres:[]}})).filter(v=>v.episodes>0).sort((a,b)=>b.episodes-a.episodes||a.id.localeCompare(b.id));
 const completed=titles.filter(({id,item})=>Number.isInteger(item.episodes)&&item.episodes>0&&last.get(id).to>=item.episodes&&entries.some(e=>e.animeId===id&&e.from<item.episodes&&e.to>=item.episodes)).length;
 return {year,episodes:titles.reduce((s,e)=>s+e.episodes,0),series:titles.length,completed,titles,events:entries.length,limited:(library.activity||[]).length>=500};
}
