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
const compilerOptions = {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX};
writeFileSync(modelCompiled, ts.transpileModule(readFileSync(new URL('../components/experience/model.ts',import.meta.url),'utf8'), {compilerOptions}).outputText);
writeFileSync(compiled, ts.transpileModule(source.replace("from './model'", `from './detail-profile-model-test-${process.pid}.mjs'`), {compilerOptions}).outputText);
after(() => { for(const file of [compiled,modelCompiled]) try { unlinkSync(file); } catch {} });
const { AnimeDetail, ProfileView } = await import(pathToFileURL(compiled).href);
const item = {id:'mal-123',malId:123,title:'Test anime',original:'Test anime',image:'https://cdn.myanimelist.net/images/anime/1/123.jpg',genres:['Aksiyon'],episodes:12,rating:8.5,studio:'Studio',summary:'Hikâye özeti.',malUrl:'https://myanimelist.net/anime/123',format:'TV',members:1,day:null,time:null,broadcastLocal:false,airing:false,status:'Tamamlandı',year:2026};
const library = () => ({saved:[],reminders:[],progress:{},view:'grid',savedAnime:{},tracking:{},scores:{},favorites:[],collections:[]});
const snapshot = (patch={}) => ({ready:true,page:'discover',catalog:[item],schedule:[],library:library(),account:null,accountScope:null,loading:false,error:null,libraryLoading:false,blocked:false,...patch});
const account = {authenticated:true,registered:true,user:{id:'user-1',displayName:'Kullanıcı',role:'member',status:'active'}};
const renderDetail = (state, anime=item) => renderToStaticMarkup(React.createElement(AnimeDetail,{item:anime,snapshot:state,onClose(){},onChange(){}}));

test('guest detail supports local tracking while comments require sign-in', () => {
  const html = renderDetail(snapshot());
  assert.match(html, /href="\/giris"/);
  assert.match(html, /href="\/uye-ol"/);
  assert.doesNotMatch(html, /<select disabled=""/);
  assert.match(html, /Listen bu tarayıcıda saklanır/);
  assert.doesNotMatch(html, /at-review-form/);
  assert.match(html, /Fragman ve bağlantılı seriler yükleniyor/);
});

test('active member detail reflects stored status, score, favorite and real progress', () => {
  const data = library();
  Object.assign(data,{saved:[item.id],savedAnime:{[item.id]:item},tracking:{[item.id]:'watching'},scores:{[item.id]:9},favorites:[item.id],reminders:[item.id],progress:{[item.id]:4}});
  const html = renderDetail(snapshot({account,library:data}));
  assert.match(html, /value="watching" selected=""/);
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
