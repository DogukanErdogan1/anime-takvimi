import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Render the real exported home/list components. Their unused portal-only
// dependencies are replaced, so this harness needs no browser or CSS loader.
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX};
const runtime=resolve('.sites-runtime');mkdirSync(runtime,{recursive:true});
const files=[];
function compile(name,source){const file=resolve(runtime,`experience-render-${name}-${process.pid}.mjs`);files.push(file);writeFileSync(file,ts.transpileModule(source,{compilerOptions:options}).outputText);return file;}
for(const dependency of ['model','reminder-logic'])compile(dependency,readFileSync(new URL(`../components/experience/${dependency}.ts`,import.meta.url),'utf8'));
const experienceSource=readFileSync(new URL('../components/experience/experience.tsx',import.meta.url),'utf8');
const source=experienceSource
  .replace(/import \{AnimeDetail,ProfileView\} from '\.\/detail-profile';/,'const AnimeDetail=()=>null,ProfileView=()=>null;')
  .replace(/import \{ExperienceControls\} from '\.\/notifications';/,'const ExperienceControls=()=>null;')
  .replace(/^import '\.\/[^']+\.css';\r?\n/gm,'')
  .replace("from './model'",`from './experience-render-model-${process.pid}.mjs'`)
  .replace("from './reminder-logic'",`from './experience-render-reminder-logic-${process.pid}.mjs'`);
const moduleFile=compile('component',source);
after(()=>{for(const file of files)try{unlinkSync(file);}catch{}});
const {PersonalHome,Watchlist}=await import(pathToFileURL(moduleFile).href);
const fixedTime=Date.parse('2026-10-17T09:00:00Z');
const item=(id,patch={})=>({id:`mal-${id}`,malId:id,title:`API anime ${id}`,original:`API anime ${id}`,image:`https://cdn.myanimelist.net/images/anime/1/${id}.jpg`,genres:['Aksiyon'],episodes:12,rating:8.5,studio:'API stüdyosu',summary:'API özeti',malUrl:`https://myanimelist.net/anime/${id}`,format:'TV',members:100,day:5,time:'18:30',broadcastLocal:true,airing:true,status:'Yayında',...patch});
const library=patch=>({saved:[],reminders:[],progress:{},view:'grid',savedAnime:{},tracking:{},scores:{},favorites:[],collections:[],...patch});
const snapshot=patch=>({ready:true,page:'discover',catalog:[],schedule:[],library:library(),account:null,accountScope:null,loading:false,error:null,libraryLoading:false,blocked:false,...patch});
function render(Component,state){
  const RealDate=globalThis.Date;
  globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[fixedTime]));}static now(){return fixedTime;}};
  try{return renderToStaticMarkup(React.createElement(Component,{snapshot:state,onChange(){},onDetail(){}}));}
  finally{globalThis.Date=RealDate;}
}

test('empty guest home shows honest empty guidance without invented user or broadcasts',()=>{
  const html=render(PersonalHome,snapshot());
  assert.match(html,/Yeni hikâyeler seni bekliyor/);
  assert.match(html,/href="#seasons"/);
  assert.match(html,/Bu sezon için henüz öneri bulunamadı/);
  assert.doesNotMatch(html,/Hoş geldin,|Deniz|Bugünkü yayınların|exp-continue-card|<img/);
  assert.match(html,/İzliyorum<span>0<\/span>/);
  assert.match(html,/Tamamladım<span>0<\/span>/);
});

test('guest catalogue home renders API media and permits local save without inventing personal activity',()=>{
  const anime=item(101);
  const html=render(PersonalHome,snapshot({catalog:[anime]}));
  assert.match(html,/API anime 101/);
  assert.match(html,/cdn\.myanimelist\.net\/images\/anime\/1\/101\.jpg/);
  assert.match(html,/SEZONDAN BİR HİKÂYE/);
  assert.match(html,/Listeme ekle/);
  assert.match(html,/SEZONDAN SEÇTİKLERİMİZ/);
  assert.doesNotMatch(html,/KALDIĞIN YERDEN DEVAM ET|Bugünkü yayınların|disabled=""/);
});

test('legacy progress drives continue hero and truthful status counts',()=>{
  const watching=item(201),done=item(202),planned=item(203);
  const data=library({saved:[watching.id,done.id,planned.id],savedAnime:{[watching.id]:watching,[done.id]:done,[planned.id]:planned},progress:{[watching.id]:4,[done.id]:12}});
  const html=render(PersonalHome,snapshot({library:data,account:{authenticated:true,registered:true,user:{id:'user-1',displayName:'Ada',role:'member',status:'active'}}}));
  assert.match(html,/Hoş geldin, Ada/);
  assert.match(html,/KALDIĞIN YERDEN DEVAM ET/);
  assert.match(html,/4 \/ 12 bölüm/);
  assert.match(html,/İzliyorum<span>1<\/span>/);
  assert.match(html,/İzleyeceğim<span>1<\/span>/);
  assert.match(html,/Tamamladım<span>1<\/span>/);
  assert.match(html,/aria-valuenow="4" aria-valuemin="0" aria-valuemax="12"/);
});

test('today card includes only followed valid local broadcasts sorted by time, without episode claims',()=>{
  const late=item(301,{time:'22:00'}),early=item(302,{time:'09:15'}),otherDay=item(303,{day:4}),unfollowed=item(304),unconfirmed=item(305,{broadcastLocal:false});
  const data=library({saved:[late.id,otherDay.id,unconfirmed.id],reminders:[early.id]});
  const html=render(PersonalHome,snapshot({schedule:[late,early,otherDay,unfollowed,unconfirmed],library:data}));
  const aside=html.match(/<aside class="exp-today">([\s\S]*?)<\/aside>/)?.[1];
  assert.ok(aside);
  assert.match(aside,/API anime 302/);assert.match(aside,/API anime 301/);
  assert.ok(aside.indexOf('API anime 302')<aside.indexOf('API anime 301'));
  assert.doesNotMatch(aside,/API anime 303|API anime 304|API anime 305|S1|Bölüm \d|kesin yayın/);
  assert.equal((aside.match(/class="exp-today-link"/g)||[]).length,2);
  assert.equal((aside.match(/aria-label="Yayın hatırlatmasını seç"/g)||[]).length,1);
  assert.equal((aside.match(/aria-label="Yayın hatırlatmasını kaldır"/g)||[]).length,1);
  assert.match(aside,/Haftalık plana göre · 09:15/);
});

test('watchlist renders persisted status, favorite and bounded completion action',()=>{
  const anime=item(401);
  const html=render(Watchlist,snapshot({page:'watchlist',library:library({saved:[anime.id],savedAnime:{[anime.id]:anime},progress:{[anime.id]:12},favorites:[anime.id]})}));
  assert.match(html,/exp-favorite-badge/);
  assert.match(html,/value="completed" selected=""/);
  assert.match(html,/12 \/ 12 bölüm/);
  assert.match(html,/class="exp-text-button" disabled=""/);
  assert.match(html,/href="#profile"/);
  assert.doesNotMatch(html,/Burada yeni hikâyelere yer var/);
});

test('watchlist distinguishes empty guest, account loading and blocked mutation states',()=>{
  assert.match(render(Watchlist,snapshot()),/Burada yeni hikâyelere yer var/);
  const loading=render(Watchlist,snapshot({libraryLoading:true}));
  assert.match(loading,/Hesap listen yükleniyor/);
  assert.doesNotMatch(loading,/Burada yeni hikâyelere yer var/);
  const anime=item(402);
  const blocked=render(Watchlist,snapshot({blocked:true,library:library({saved:[anime.id],savedAnime:{[anime.id]:anime}})}));
  assert.match(blocked,/<select disabled=""/);
  assert.match(blocked,/class="exp-text-button" disabled=""/);
});

test('React portals have exactly one matching slot in both static and server page markup',()=>{
  const html=readFileSync(new URL('../public/site/index.html',import.meta.url),'utf8');
  const serialized=readFileSync(new URL('../app/anime-markup.ts',import.meta.url),'utf8');
  const serverBody=JSON.parse(serialized.replace(/^export const animeMarkup = /,'').trim().replace(/;$/,''));
  const staticBody=html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].trim();
  assert.equal(serverBody,staticBody);
  for(const name of ['home','page','nav'])assert.equal((staticBody.match(new RegExp(`id="experience-${name}-slot"`,'g'))||[]).length,1);
});
