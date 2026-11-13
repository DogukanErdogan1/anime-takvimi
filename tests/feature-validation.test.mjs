import test from 'node:test';
import assert from 'node:assert/strict';
import {exportLibrary,parseLibraryJson,fromMalEntries,mergeLibraries,libraryCsv} from '../lib/library-transfer.mjs';
import {normalizeAnimePage} from '../lib/anime-page.mjs';
const list=(id=1)=>fromMalEntries([{id,title:'Anime '+id,progress:3,status:'Watching',score:7}]);
test('backup excludes device reminders and merge preserves existing progress and scores',()=>{
 const before=list(),incoming=list(2);before.reminders=['mal-1'];incoming.saved.push('mal-1');incoming.savedAnime['mal-1']=list().savedAnime['mal-1'];incoming.progress['mal-1']=9;
 assert.deepEqual(parseLibraryJson(exportLibrary(before)).reminders,[]);
 const merged=mergeLibraries(before,incoming);assert.deepEqual(merged.saved,['mal-1','mal-2']);assert.equal(merged.progress['mal-1'],3);assert.equal(merged.scores['mal-1'],7);assert.deepEqual(merged.reminders,['mal-1']);
});
test('imports validate limits, deduplicate IDs and restore missing display fields',()=>{
 assert.equal(fromMalEntries([{id:1,title:'A'},{id:1,title:'A'}]).saved.length,1);
 assert.throws(()=>fromMalEntries([{id:1,title:'A',score:11}]));assert.throws(()=>parseLibraryJson('{"version":99}'));
 const legacy={format:'anime-takvimi',version:1,library:{saved:['mal-3'],reminders:[],progress:{},view:'grid',savedAnime:{'mal-3':{id:'mal-3',title:'Legacy'}}}};
 assert.deepEqual(parseLibraryJson(JSON.stringify(legacy)).savedAnime['mal-3'].genres,[]);
 const unsafe=list();unsafe.savedAnime['mal-1'].image='https://evil.example/x.png';assert.throws(()=>parseLibraryJson(JSON.stringify({format:'anime-takvimi',version:1,library:unsafe})));
});
test('CSV escapes formulas and quote characters',()=>{
 const library=list();library.savedAnime['mal-1'].title='=SUM(1,2)';assert.ok(libraryCsv(library).includes("'=SUM(1,2)"));
 library.savedAnime['mal-1'].title='A "quoted" title';assert.ok(libraryCsv(library).includes('A ""quoted"" title'));
});
test('anime page validates the exact identity and poster origin',()=>{
 assert.throws(()=>normalizeAnimePage({mal_id:2,title:'Wrong'},1));
 const anime=normalizeAnimePage({mal_id:1,title:'Safe',images:{jpg:{large_image_url:'https://user:secret@cdn.myanimelist.net/a.jpg'}}},1);
 assert.equal(anime.image,null);assert.equal(anime.malUrl,'https://myanimelist.net/anime/1');assert.deepEqual(anime.genres,[]);
});

test('JSON import rejects mismatched anime identifiers',()=>{const library=list();library.savedAnime['mal-1'].malId=2;assert.throws(()=>parseLibraryJson(JSON.stringify({format:'anime-takvimi',version:1,library})));});
