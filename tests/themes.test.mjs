import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

const runtime=resolve('.sites-runtime');mkdirSync(runtime,{recursive:true});
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext};
const files=[];
function compile(name,source){const file=resolve(runtime,`themes-test-${name}-${process.pid}.mjs`);files.push(file);writeFileSync(file,ts.transpileModule(source,{compilerOptions:options}).outputText);return file;}
const modelFile=compile('model',readFileSync(new URL('../components/experience/themes.ts',import.meta.url),'utf8'));
const preferenceSource=readFileSync(new URL('../components/experience/theme-preference.tsx',import.meta.url),'utf8')
  .replace(/import \{useEffect\} from 'react';/,"const useEffect=(effect:()=>void|(()=>void))=>globalThis.__themeHarnessEffect(effect);")
  .replace("from './themes'",`from './themes-test-model-${process.pid}.mjs'`);
const preferenceFile=compile('preference',preferenceSource);
after(()=>{for(const file of files)try{unlinkSync(file);}catch{}});
const {THEMES,THEME_KEY,LEGACY_THEME_KEY,THEME_EVENT,applyTheme,getActiveTheme,readThemePreference}=await import(pathToFileURL(modelFile).href);
const {default:ThemePreference}=await import(pathToFileURL(preferenceFile).href);

function environment({stored={},dark=false,storageBlocked=false,mediaBlocked=false}={}){
  const originals=new Map(['window','document','CustomEvent','__themeHarnessEffect'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const data=new Map(Object.entries(stored)),writes=[],variables=new Map(),events=[];
  const root={dataset:{},style:{setProperty:(key,value)=>variables.set(key,value)}};
  const meta={content:null,setAttribute(key,value){if(key==='content')this.content=value;}};
  const window=new EventTarget();
  window.localStorage={
    getItem(key){if(storageBlocked)throw new Error('Storage blocked');return data.get(key)??null;},
    setItem(key,value){if(storageBlocked)throw new Error('Storage blocked');writes.push([key,value]);data.set(key,value);}
  };
  window.matchMedia=query=>{assert.equal(query,'(prefers-color-scheme: dark)');if(mediaBlocked)throw new Error('Media query unavailable');return {matches:dark};};
  window.addEventListener(THEME_EVENT,event=>events.push(event.detail));
  globalThis.window=window;
  globalThis.document={documentElement:root,querySelector:selector=>{assert.equal(selector,'meta[name="theme-color"]');return meta;}};
  globalThis.CustomEvent=class extends Event{constructor(type,options={}){super(type);this.detail=options.detail;}};
  return {
    root,meta,window,data,writes,variables,events,
    storage(key){const event=new Event('storage');Object.defineProperty(event,'key',{value:key});window.dispatchEvent(event);},
    restore(){for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
  };
}
function withEnvironment(options,callback){const state=environment(options);try{return callback(state);}finally{state.restore();}}
function luminance(color){const channels=Array.isArray(color)?color:color.slice(1).match(/../g).map(value=>parseInt(value,16));const values=channels.map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return values[0]*.2126+values[1]*.7152+values[2]*.0722;}
function contrast(a,b){const values=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (values[0]+.05)/(values[1]+.05);}

test('all eight themes keep normal text, muted labels and primary button labels readable',()=>{
  assert.deepEqual(THEMES.map(theme=>theme.name),['Porselen','Gece Yarısı','Nar','Buzul','Ada','Kumtaşı','Volt','Orkide']);
  assert.equal(new Set(THEMES.map(theme=>theme.id)).size,8);
  const navMix=readFileSync(new URL('../components/experience/themes.css',import.meta.url),'utf8').match(/--theme-nav-accent:\s*color-mix\(in srgb,\s*var\(--coral\)\s+([\d.]+)%,\s*white\)/);
  assert.ok(navMix,'the active navigation color must use the tested sRGB accent and white mix');
  const accentWeight=Number(navMix[1])/100;
  for(const {name,colors} of THEMES){
    for(const background of ['paper','surface'])for(const foreground of ['ink','muted','accent']){
      const ratio=contrast(colors[foreground],colors[background]);
      assert.ok(ratio>=4.5,`${name} ${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
    }
    for(const background of ['accent','accentHover']){
      const ratio=contrast(colors.onAccent,colors[background]);
      assert.ok(ratio>=4.5,`${name} primary text on ${background}: ${ratio.toFixed(2)}:1`);
    }
    const navAccent=colors.accent.slice(1).match(/../g).map(value=>parseInt(value,16)*accentWeight+255*(1-accentWeight));
    const navRatio=contrast(navAccent,colors.nav);
    assert.ok(navRatio>=4.5,`${name} active navigation text: ${navRatio.toFixed(2)}:1`);
  }
});

test('valid saved palette takes precedence over old binary preference and system color scheme',()=>{
  withEnvironment({stored:{[THEME_KEY]:'buzul',[LEGACY_THEME_KEY]:'dark'},dark:true},()=>assert.equal(readThemePreference(),'buzul'));
  withEnvironment({stored:{[THEME_KEY]:'nar',[LEGACY_THEME_KEY]:'light'}},()=>assert.equal(readThemePreference(),'nar'));
});

test('previous palette selections migrate to replacement palettes before the legacy mode fallback',()=>{
  const replacements={hikari:'porselen',yoru:'gece',yozakura:'nar',matcha:'buzul',shinkai:'ada',kitsune:'volt',kurogane:'gece',tanpopo:'kumtasi'};
  for(const [oldId,newId] of Object.entries(replacements)){
    withEnvironment({stored:{[THEME_KEY]:oldId,[LEGACY_THEME_KEY]:'light'},dark:true},state=>{
      assert.equal(readThemePreference(),newId,`${oldId} should restore ${newId}`);
      assert.deepEqual(state.writes,[],'reading an existing selection must not rewrite storage');
      applyTheme(readThemePreference(),false);
      assert.equal(getActiveTheme(),newId);
      assert.equal(state.root.dataset.palette,newId);
      assert.deepEqual(state.writes,[],'restoring a migrated selection must not rewrite storage');
    });
  }
});

test('old light and dark preferences migrate and invalid values fall back to system preference',()=>{
  withEnvironment({stored:{[LEGACY_THEME_KEY]:'dark'}},()=>assert.equal(readThemePreference(),'gece'));
  withEnvironment({stored:{[LEGACY_THEME_KEY]:'light'},dark:true},()=>assert.equal(readThemePreference(),'porselen'));
  withEnvironment({stored:{[THEME_KEY]:'unknown',[LEGACY_THEME_KEY]:'unknown'},dark:true},()=>assert.equal(readThemePreference(),'gece'));
  withEnvironment({},()=>assert.equal(readThemePreference(),'porselen'));
});

test('theme preference remains safe with unavailable storage, media APIs or browser globals',()=>{
  withEnvironment({storageBlocked:true,dark:true},()=>assert.equal(readThemePreference(),'gece'));
  withEnvironment({storageBlocked:true,mediaBlocked:true},()=>assert.equal(readThemePreference(),'porselen'));
  withEnvironment({},()=>{
    delete globalThis.window;delete globalThis.document;
    assert.equal(readThemePreference(),'porselen');assert.equal(getActiveTheme(),'porselen');
    assert.doesNotThrow(()=>applyTheme('gece'));
  });
});

test('selecting a theme updates visible palette, browser chrome and persistent preference together',()=>{
  withEnvironment({},state=>{
    const theme=THEMES.find(theme=>theme.id==='ada');
    applyTheme(theme.id);
    assert.deepEqual(state.root.dataset,{palette:'ada',theme:'dark'});
    assert.equal(state.root.style.colorScheme,'dark');
    assert.equal(state.meta.content,theme.colors.nav);
    assert.equal(state.variables.get('--paper'),theme.colors.paper);
    assert.equal(state.variables.get('--theme-surface'),theme.colors.surface);
    assert.equal(state.variables.get('--coral'),theme.colors.accent);
    assert.equal(state.variables.get('--theme-on-accent'),theme.colors.onAccent);
    assert.equal(state.variables.get('--ink'),theme.colors.ink);
    assert.equal(state.variables.get('--muted'),theme.colors.muted);
    assert.equal(state.variables.get('--theme-nav'),theme.colors.nav);
    assert.deepEqual(state.writes,[[THEME_KEY,'ada'],[LEGACY_THEME_KEY,'dark']]);
    assert.deepEqual(state.events,[{id:'ada'}]);
    assert.equal(getActiveTheme(),'ada');
  });
});

test('restoring a theme does not rewrite storage, while blocked storage still permits changing theme',()=>{
  withEnvironment({},state=>{applyTheme('kumtasi',false);assert.deepEqual(state.writes,[]);assert.equal(getActiveTheme(),'kumtasi');assert.deepEqual(state.events,[{id:'kumtasi'}]);});
  withEnvironment({stored:{[THEME_KEY]:'porselen'},storageBlocked:true},state=>{assert.doesNotThrow(()=>applyTheme('volt'));assert.equal(getActiveTheme(),'volt');assert.equal(state.root.dataset.theme,'dark');assert.deepEqual(state.events,[{id:'volt'}]);});
});

test('invalid theme IDs cannot change the active page or stored preference',()=>{
  withEnvironment({},state=>{
    applyTheme('buzul');
    const variables=[...state.variables],writes=[...state.writes];
    applyTheme('unknown');
    applyTheme('matcha');
    assert.equal(getActiveTheme(),'buzul');assert.deepEqual([...state.variables],variables);assert.deepEqual(state.writes,writes);assert.equal(state.events.length,1);
  });
});

test('theme preference restores once, synchronizes related storage changes and removes its listener',()=>{
  withEnvironment({stored:{[THEME_KEY]:'gece'}},state=>{
    let cleanup;globalThis.__themeHarnessEffect=effect=>{cleanup=effect();};
    assert.equal(ThemePreference(),null);
    assert.equal(getActiveTheme(),'gece');assert.deepEqual(state.writes,[]);
    state.data.set(THEME_KEY,'buzul');state.storage(THEME_KEY);
    assert.equal(getActiveTheme(),'buzul');
    state.data.set(THEME_KEY,'volt');state.storage('unrelated-key');
    assert.equal(getActiveTheme(),'buzul');
    state.storage(LEGACY_THEME_KEY);assert.equal(getActiveTheme(),'volt');
    state.data.clear();state.storage(null);assert.equal(getActiveTheme(),'porselen');
    assert.deepEqual(state.writes,[],'cross-tab restoration must not write storage back');
    cleanup();state.data.set(THEME_KEY,'nar');state.storage(THEME_KEY);
    assert.equal(getActiveTheme(),'porselen','unmounted preference listener must be removed');
  });
});
