import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const directory=path.resolve('.sites-runtime');mkdirSync(directory,{recursive:true});
const files=[];
function write(name,source){const file=path.join(directory,`poster-${name}-${process.pid}.mjs`);files.push(file);writeFileSync(file,source);return file;}
const hooksFile=write('hooks',`let values=[],cursor=0,effects=new Map(),queue=[],active=true,late=0;
export function reset(){values=[];cursor=0;effects=new Map();queue=[];active=true;late=0;}
export function begin(){cursor=0;}
export function useState(initial){const index=cursor++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return [values[index],next=>{if(!active)late++;values[index]=typeof next==='function'?next(values[index]):next;}];}
export function useRef(initial){const index=cursor++;if(!(index in values))values[index]={current:initial};return values[index];}
export function useEffect(callback,deps){const index=cursor++,previous=effects.get(index);if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))queue.push({index,callback,deps});}
export function flush(){for(const entry of queue.splice(0)){effects.get(entry.index)?.cleanup?.();effects.set(entry.index,{deps:entry.deps,cleanup:entry.callback()});}}
export function unmount(){for(const entry of effects.values())entry.cleanup?.();effects.clear();active=false;}
export function lateUpdates(){return late;}`);
const source=readFileSync(new URL('../components/experience/detail-profile.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('detail-profile.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const functions=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&['AnimePoster','imageUrl'].includes(node.name?.text)).map(node=>node.getText(ast));
assert.equal(functions.length,2);
const component=write('component',ts.transpileModule(`import {useState,useEffect} from './${path.basename(hooksFile)}';import {Bookmark} from 'lucide-react';${functions.join('\n')}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText);
const hooks=await import(pathToFileURL(hooksFile).href),{AnimePoster}=await import(pathToFileURL(component).href);
after(()=>{for(const file of files)try{unlinkSync(file);}catch{}});
const COVER='https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21-example.jpg';
const item={id:'mal-21',malId:21,title:'Anime 21',image:'https://cdn.myanimelist.net/images/anime/1/21.jpg'};
const render=(anime=item)=>{hooks.begin();return AnimePoster({item:anime});};
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function environment(t,resolvePoster){hooks.reset();const previous=globalThis.window;globalThis.window={AnimeBanners:{resolvePoster,safePoster:value=>value===COVER?value:null}};t.after(()=>{hooks.unmount();if(previous===undefined)delete globalThis.window;else globalThis.window=previous;});}

test('real poster switches from the failed MAL image to its matched alternative and stops on a second failure',async t=>{
  const calls=[];environment(t,async id=>{calls.push(id);return COVER;});
  let tree=render();hooks.flush();assert.equal(tree.props.children.props.src,item.image);assert.deepEqual(calls,[]);
  tree.props.children.props.onError();tree=render();hooks.flush();await settle();tree=render();hooks.flush();
  assert.equal(tree.props.children.props.src,COVER);assert.deepEqual(calls,[21]);
  tree.props.children.props.onError();tree=render();hooks.flush();await settle();
  assert.equal(tree.props.children.props.className,'at-poster-missing');assert.deepEqual(calls,[21]);
});

test('late poster results never replace another anime or update an unmounted card',async t=>{
  let finish;environment(t,()=>new Promise(resolve=>{finish=resolve;}));
  let tree=render();hooks.flush();tree.props.children.props.onError();render();hooks.flush();
  const next={...item,id:'mal-22',malId:22,image:item.image.replace('21.jpg','22.jpg')};
  tree=render(next);hooks.flush();finish(COVER);await settle();tree=render(next);hooks.flush();
  assert.equal(tree.props.children.props.src,next.image);
  tree.props.children.props.onError();render(next);hooks.flush();hooks.unmount();finish(COVER);await settle();
  assert.equal(hooks.lateUpdates(),0);
});

test('unsafe poster inputs and untrusted fallback responses never become image sources',async t=>{
  environment(t,async()=> 'https://evil.example/poster.jpg');
  let tree=render({...item,image:'https://evil.example/primary.jpg'});hooks.flush();await settle();
  tree=render({...item,image:'https://evil.example/primary.jpg'});hooks.flush();assert.equal(tree.props.children.props.className,'at-poster-missing');
});
