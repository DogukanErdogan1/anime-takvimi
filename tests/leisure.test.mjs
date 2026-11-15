import test from 'node:test';
import assert from 'node:assert/strict';
import {annualRecap,eveningPicks,recapYears} from '../lib/leisure.mjs';
const anime=(id,patch={})=>({id:`mal-${id}`,malId:id,title:`Anime ${id}`,duration:24,episodes:12,genres:['Aksiyon'],format:'TV',rating:8,status:'Tamamlandı',airing:false,...patch});
const library=(patch={})=>({saved:[],savedAnime:{},tracking:{},progress:{},activity:[],...patch});
test('an evening plan respects time, next episode and remaining episode count',()=>{
 const items=[anime(1),anime(2,{format:'Movie',duration:95,episodes:1}),anime(3,{duration:null}),anime(4,{duration:0})],lib=library({saved:['mal-1'],tracking:{'mal-1':'watching'},progress:{'mal-1':11}});
 const result=eveningPicks(items,lib,{minutes:120});assert.equal(result.length,2);assert.equal(result[0].item.id,'mal-1');assert.equal(result[0].count,1);assert.equal(result[0].from,12);assert.equal(result[0].minutes,24);assert.equal(result[1].minutes,95);
 assert.equal(eveningPicks(items,lib,{minutes:30,format:'movie'}).length,0);assert.equal(eveningPicks(items,lib,{minutes:0}).length,0);
});
test('picker filters mood, genre, format and saved scope without proposing finished or unreleased entries',()=>{
 const items=[anime(1),anime(2,{genres:['Komedi']}),anime(3,{status:'Henüz başlamadı'}),anime(4),anime(5),anime(6)];const lib=library({saved:['mal-2'],tracking:{'mal-4':'completed','mal-5':'dropped'},progress:{'mal-6':12}});
 assert.deepEqual(eveningPicks(items,lib,{minutes:60,mood:'fun',source:'saved'}).map(e=>e.item.id),['mal-2']);
 assert.deepEqual(eveningPicks(items,lib,{minutes:60,genre:'Aksiyon'}).map(e=>e.item.id),['mal-1']);assert.equal(eveningPicks(items,lib,{minutes:60,genre:'Aksiyon',mood:'fun'}).length,0);
});
test('airing and unknown-total anime never manufacture availability of later episodes',()=>{
 for(const item of [anime(1,{airing:true}),anime(2,{episodes:null})])assert.equal(eveningPicks([item],library(),{minutes:180})[0].count,1);
 assert.equal(eveningPicks([anime(1),anime(1)],library(),{minutes:60}).length,1);
});
test('a known future premiere is excluded even when source status is stale',()=>{
 assert.equal(eveningPicks([anime(1,{airedFrom:new Date(Date.now()+86400000).toISOString(),status:'Yayında'})],library()).length,0);
});
const at=value=>Date.parse(value),event=(id,date,from,to,animeId='mal-1')=>({id,at:at(date),from,to,animeId,title:'Recorded title'});
test('annual recap uses Istanbul year boundaries, excludes future events and subtracts corrections',()=>{
 const lib=library({savedAnime:{'mal-1':anime(1,{episodes:12})},activity:[event('old','2025-12-31T20:59:59Z',0,5),event('new','2025-12-31T21:00:00Z',5,8),event('done','2026-05-01T12:00:00Z',8,12),event('fix','2026-06-01T12:00:00Z',12,10),event('future','2026-12-31T12:00:00Z',10,12)]});
 const recap=annualRecap(lib,2026,new Date('2026-11-15T12:00:00Z'));assert.equal(recap.episodes,5);assert.equal(recap.completed,0);assert.equal(recap.events,3);assert.equal(recap.series,1);
 assert.deepEqual(recapYears(lib.activity,new Date('2026-11-15T12:00:00Z')),[2026,2025]);
});
test('completion requires a dated crossing of a known final episode, not an existing completed status',()=>{
 const lib=library({saved:['mal-1','mal-2'],savedAnime:{'mal-1':anime(1),'mal-2':anime(2)},tracking:{'mal-2':'completed'},progress:{'mal-2':12},activity:[event('one','2026-05-01',8,12),event('two','2026-05-02',0,3,'mal-3')]});
 const recap=annualRecap(lib,2026,new Date('2026-11-15'));assert.equal(recap.completed,1);assert.equal(recap.episodes,7);assert.equal(recap.titles[1].item.title,'Recorded title');assert.equal(recap.titles[1].item.malId,3);
 assert.equal(annualRecap(library({tracking:{'mal-1':'completed'}}),2026).completed,0);
});
test('recap clamps net corrections, handles empty years and advertises truncation',()=>{
 const lib=library({activity:[event('one','2026-05-01',10,4)]});assert.equal(annualRecap(lib,2026).episodes,0);assert.equal(annualRecap(lib,2025).events,0);
 assert.equal(annualRecap(library({activity:Array.from({length:500},(_,i)=>event(String(i),'2026-05-01',0,1))}),2026).limited,true);
});
