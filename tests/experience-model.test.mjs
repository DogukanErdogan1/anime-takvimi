import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceEpisode,recommendations,watchStatus} from '../components/experience/model.ts';
const item=(id,genres=[],members=1,episodes=12)=>({id:`mal-${id}`,malId:id,title:`Anime${id}`,image:null,genres,members,episodes,rating:8});
const library=overrides=>({saved:[],reminders:[],progress:{},savedAnime:{},tracking:{},scores:{},favorites:[],collections:[],view:'grid',...overrides});
test('legacy progress derives watching/completed while explicit dropped takes precedence',()=>{
 const anime=item(1);
 assert.equal(watchStatus(anime,library({progress:{'mal-1':3}})),'watching');
 assert.equal(watchStatus(anime,library({progress:{'mal-1':12}})),'completed');
 assert.equal(watchStatus(anime,library({progress:{'mal-1':12},tracking:{'mal-1':'dropped'}})),'dropped');
 assert.equal(watchStatus(anime,library()),'planned');
});
test('episode increments preserve other anime and clamp completion to known total',()=>{
 const anime=item(1),prior=library({saved:['mal-2'],progress:{'mal-1':11,'mal-2':7},tracking:{'mal-2':'dropped'}});
 const patch=advanceEpisode(anime,prior);
 assert.equal(patch.progress['mal-1'],12);assert.equal(patch.progress['mal-2'],7);
 assert.equal(patch.tracking['mal-1'],'completed');assert.equal(patch.tracking['mal-2'],'dropped');
 assert.deepEqual(patch.saved,['mal-2','mal-1']);assert.equal(prior.progress['mal-1'],11);
 assert.equal(advanceEpisode(anime,{...prior,...patch}).progress['mal-1'],12);
});
test('unknown episode total permits progress without inventing a total',()=>{
 const patch=advanceEpisode(item(1,[],1,null),library({progress:{'mal-1':9998}}));
 assert.equal(patch.progress['mal-1'],9999);assert.equal(patch.tracking['mal-1'],'watching');
});
test('recommendations rank real genre affinity above popularity and omit saved/dropped duplicates',()=>{
 const favorite=item(1,['Fantastik']),data=library({saved:['mal-1'],favorites:['mal-1'],savedAnime:{'mal-1':favorite},tracking:{'mal-4':'dropped'}});
 const picks=recommendations([favorite,item(2,['Dram'],10000),item(3,['Fantastik'],2),item(3,['Fantastik'],2),item(4,['Fantastik'],9000)],data);
 assert.deepEqual(picks.map(pick=>pick.item.id),['mal-3','mal-2']);assert.equal(picks[0].reason,'Fantastik');assert.equal(picks[1].reason,null);
});
test('new visitors receive popular real titles without a fabricated preference rationale',()=>{
 const picks=recommendations([item(1,[],5),item(2,[],50)],library(),1);
 assert.equal(picks[0].item.id,'mal-2');assert.equal(picks[0].reason,null);
});
