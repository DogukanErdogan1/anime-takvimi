import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,unlinkSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {validateLibrary} from '../lib/membership.mjs';
import {exportLibrary,mergeLibraries} from '../lib/library-transfer.mjs';

mkdirSync('.sites-runtime',{recursive:true});
const file=resolve(`.sites-runtime/library-tools-model-${process.pid}.mjs`);
writeFileSync(file,ts.transpileModule(readFileSync(new URL('../components/experience/model.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
after(()=>unlinkSync(file));
const {bulkLibraryPatch}=await import(pathToFileURL(file).href);
const library=()=>({saved:['mal-1','mal-2','mal-3'],savedAnime:{'mal-1':{id:'mal-1',title:'Known',episodes:12},'mal-2':{id:'mal-2',title:'Unknown',episodes:null},'mal-3':{id:'mal-3',title:'Untouched',episodes:24}},reminders:[],progress:{'mal-1':2,'mal-2':4,'mal-3':8},view:'grid',tracking:{'mal-3':'watching'},favorites:['mal-3'],scores:{'mal-3':9},collections:[{id:'first',title:'First',animeIds:['mal-1']},{id:'second',title:'Second',animeIds:['mal-3']}],episodeNotes:{'mal-3':{'8':'Private note'}}});

test('bulk completion updates only selected current library entries and keeps unknown totals unchanged',()=>{
 const before=library(),patch=bulkLibraryPatch(before,['mal-1','mal-2','mal-1','mal-999'],{status:'completed'});
 assert.deepEqual(patch.progress,{'mal-1':12,'mal-2':4,'mal-3':8});assert.deepEqual(patch.tracking,{'mal-1':'completed','mal-2':'completed','mal-3':'watching'});
 assert.equal(patch.episodeNotes,undefined);assert.equal(patch.collections,undefined);assert.equal(before.progress['mal-1'],2);
 const planned=bulkLibraryPatch({...before,...patch},['mal-1'],{status:'planned'});assert.equal(planned.progress['mal-1'],12);
});

test('bulk favorites and collection membership preserve unrelated entries and cannot target a deleted collection',()=>{
 const before=library();assert.deepEqual(bulkLibraryPatch(before,['mal-1','mal-2'],{favorite:true}).favorites,['mal-3','mal-1','mal-2']);
 assert.deepEqual(bulkLibraryPatch(before,['mal-1'],{favorite:false}).favorites,['mal-3']);
 const patch=bulkLibraryPatch(before,['mal-1','mal-2'],{collectionId:'first'});assert.deepEqual(patch.collections[0].animeIds,['mal-1','mal-2']);assert.deepEqual(patch.collections[1],before.collections[1]);
 assert.deepEqual(bulkLibraryPatch(before,['mal-1'],{collectionId:'deleted'}),{});assert.deepEqual(bulkLibraryPatch(before,['mal-999'],{status:'dropped'}),{});
});

test('private note validation preserves old library shape and rejects malformed, excessive or unsafe records',()=>{
 const before=library();delete before.episodeNotes;assert.equal('episodeNotes' in validateLibrary({library:before}),false);
 assert.deepEqual(validateLibrary({library:library()}).episodeNotes,{'mal-3':{'8':'Private note'}});
 for(const episodeNotes of [[],null,{'mal-1':[]},{'bad-id':{'1':'x'}},{'mal-1':{'0':'x'}},{'mal-1':{'01':'x'}},{'mal-1':{'10000':'x'}},{'mal-1':{'1':''}},{'mal-1':{'1':'x'.repeat(2001)}},{'mal-1':{'1':'bad\u0000note'}},{'mal-1':Object.fromEntries(Array.from({length:251},(_,i)=>[String(i+1),'note']))}])assert.throws(()=>validateLibrary({library:{...before,episodeNotes}}));
 const normalized=validateLibrary({library:{...before,episodeNotes:{'mal-1':{'1':'  My thought\nNext line  '},'mal-2':{}}}});assert.deepEqual(normalized.episodeNotes,{'mal-1':{'1':'My thought\nNext line'}});
});

test('note-only anime IDs count toward the library limit and ordinary exports omit private note text',()=>{
 const many={...library(),saved:Array.from({length:500},(_,i)=>`mal-${i+1}`),episodeNotes:{'mal-501':{'1':'Extra'}}};assert.throws(()=>validateLibrary({library:many}));
 const exported=JSON.parse(exportLibrary(library()));assert.equal(exported.library.episodeNotes,undefined);assert.doesNotMatch(JSON.stringify(exported),/Private note/);
 const added={...library(),episodeNotes:undefined};delete added.episodeNotes;
 assert.deepEqual(mergeLibraries(library(),added).library?.episodeNotes??mergeLibraries(library(),added).episodeNotes,library().episodeNotes);
});
