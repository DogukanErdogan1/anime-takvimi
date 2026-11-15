import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const runtime=resolve('.sites-runtime');mkdirSync(runtime,{recursive:true});const path=resolve(runtime,`leisure-render-${process.pid}.mjs`);
const source=readFileSync(new URL('../components/experience/leisure-tools.tsx',import.meta.url),'utf8')
 .replace("from '../../lib/leisure.mjs'",`from '${new URL('../lib/leisure.mjs',import.meta.url).href}'`)
 .replace("import {AnimePoster} from './detail-profile';",'const AnimePoster=({item})=><span>{item.title} afişi</span>;')
 .replace("import WatchClubs from './watch-clubs';",'const WatchClubs=()=>null;')
 .replace("import './leisure-tools.css';",'');
writeFileSync(path,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText);after(()=>unlinkSync(path));
const {EveningPicker,AnnualRecap}=await import(pathToFileURL(path).href),now=new Date();
const item=(id,patch={})=>({id:`mal-${id}`,malId:id,title:'Anime '+id,duration:24,episodes:12,genres:['Aksiyon'],format:'TV',rating:8,status:'Tamamlandı',airing:false,...patch});
const snapshot=patch=>({library:{saved:[],savedAnime:{},progress:{},tracking:{},activity:[],...patch},catalog:[],libraryLoading:false});
test('real evening UI displays the next unwatched range, format/mood controls and no duration guesses',()=>{
 const state=snapshot({saved:['mal-1'],savedAnime:{'mal-1':item(1)},progress:{'mal-1':10}});state.catalog=[item(2,{duration:null}),item(3,{status:'Henüz başlamadı'})];const html=renderToStaticMarkup(React.createElement(EveningPicker,{snapshot:state,onDetail(){}}));assert.match(html,/11–12. bölümler/);assert.match(html,/48 dk/);assert.match(html,/Ruh halin/);assert.match(html,/Film veya seri/);assert.doesNotMatch(html,/Anime 2 afişi|Anime 3 afişi/);
});
test('real recap offers a disabled download and accurate empty state for undated old progress',()=>{
 const state=snapshot({progress:{'mal-1':12},tracking:{'mal-1':'completed'},savedAnime:{'mal-1':item(1)}});const html=renderToStaticMarkup(React.createElement(AnnualRecap,{snapshot:state}));assert.match(html,/<button[^>]*disabled=""/);assert.match(html,/tarihli bir bölüm değişikliği yok/);assert.match(html,/seri bitişi/);assert.doesNotMatch(html,/Anime 1 afişi/);
});
test('recap preview includes real API poster identities, records and privacy explanation',()=>{
 const state=snapshot({savedAnime:{'mal-1':item(1)},activity:[{id:'x',animeId:'mal-1',title:'Anime 1',at:now.getTime()-1000,from:10,to:12}]});const html=renderToStaticMarkup(React.createElement(AnnualRecap,{snapshot:state}));assert.match(html,/Anime 1 afişi/);assert.match(html,/<strong>2<\/strong>/);assert.match(html,/<strong>1<\/strong>/);assert.match(html,/e-posta, özel notlar/);assert.doesNotMatch(html,/<button[^>]*disabled=""/);
});
