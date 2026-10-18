import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AVATAR_FRAMES} from '../lib/avatar-frames.mjs';

// Exercise the production picker and its real selection/save handlers. Hook
// state retains dependency-aware effects and cleanup without a browser host.
const runtime=resolve('.sites-runtime');mkdirSync(runtime,{recursive:true});const files=[];
function write(name,source){const file=resolve(runtime,`avatar-frame-picker-${name}-${process.pid}.mjs`);files.push(file);writeFileSync(file,source);return file;}
const hookFile=write('hooks',`let values=[],cursor=0,effects=new Map(),queue=[],active=true,late=0;export function reset(){values=[];cursor=0;effects=new Map();queue=[];active=true;late=0;}export function begin(){cursor=0;}export function useState(initial){const index=cursor++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return[values[index],next=>{if(!active)late++;values[index]=typeof next==='function'?next(values[index]):next;}];}export function useRef(initial){const index=cursor++;if(!(index in values))values[index]={current:initial};return values[index];}export function useId(){return'test-id-'+cursor++;}export function useEffect(callback,deps){const index=cursor++;const old=effects.get(index);if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))queue.push({index,callback,deps});}export function flush(){for(const entry of queue.splice(0)){effects.get(entry.index)?.cleanup?.();effects.set(entry.index,{deps:entry.deps,cleanup:entry.callback()});}}export function unmount(){for(const effect of effects.values())effect.cleanup?.();effects.clear();active=false;}export function lateUpdates(){return late;}`);
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX};
const compile=(name,source)=>write(name,ts.transpileModule(source,{compilerOptions:options}).outputText);
const metadata=new URL('../lib/avatar-frames.mjs',import.meta.url).href;
const frameFile=compile('renderer',readFileSync(new URL('../components/experience/avatar-frame.tsx',import.meta.url),'utf8')
  .replace("from '../../lib/avatar-frames.mjs'",`from '${metadata}'`)
  .replace("from '../../lib/avatar-frame-geometry.mjs'",`from '${new URL('../lib/avatar-frame-geometry.mjs',import.meta.url).href}'`));
const pickerFile=compile('component',readFileSync(new URL('../components/experience/avatar-frame-picker.tsx',import.meta.url),'utf8')
  .replace("from 'react'",`from './${hookFile.split(/[/\\]/).at(-1)}'`)
  .replace("from '../../lib/avatar-frames.mjs'",`from '${metadata}'`)
  .replace("from './avatar-frame'",`from './${frameFile.split(/[/\\]/).at(-1)}'`)
  .replace(/^import '\.\/[^']+\.css';\r?\n/gm,''));
after(()=>{for(const file of files)try{unlinkSync(file);}catch{}});
const hooks=await import(pathToFileURL(hookFile).href);
const {default:AvatarFramePicker}=await import(pathToFileURL(pickerFile).href);
const {AvatarFrame}=await import(pathToFileURL(frameFile).href);
function find(tree,predicate){if(!tree||typeof tree!=='object')return null;if(Array.isArray(tree)){for(const child of tree){const match=find(child,predicate);if(match)return match;}return null;}if(predicate(tree))return tree;return find(tree.props?.children,predicate);}
function text(tree){if(tree==null||typeof tree==='boolean')return'';if(typeof tree==='string'||typeof tree==='number')return String(tree);return Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function setup(t,patch={}){
  hooks.reset();const calls=[];let unmounted=false;
  const props={frameId:'none',userId:'owner',accountScope:'owner',displayName:'Anime Takvimi',avatar:null,onSave:async(id)=>id,...patch};
  const save=props.onSave;props.onSave=(id,signal)=>{calls.push({id,signal});return save(id,signal);};
  const render=()=>{hooks.begin();const tree=AvatarFramePicker(props);hooks.flush();return tree;};
  const unmount=()=>{if(!unmounted){hooks.unmount();unmounted=true;}};t.after(unmount);
  const choice=(label)=>{const node=find(render(),node=>node.props?.role==='radio'&&text(node)===label);assert.ok(node,`actual frame choice ${label} must exist`);return node;};
  const saveButton=()=>{const node=find(render(),node=>node.props?.className==='at-frame-save');assert.ok(node);return node;};
  return {props,calls,render,unmount,choice,saveButton,open(){render().props.onOpenChange(true);return render();},close(){render().props.onOpenChange(false);return render();},choose(label){choice(label).props.onClick();return render();},save(){saveButton().props.onClick();return render();}};
}

test('preview selection is local, cancel restores the saved frame on next open',t=>{
  const ui=setup(t,{frameId:'platin'});assert.equal(ui.open().props.open,true);
  ui.choose('Koi');assert.equal(ui.choice('Koi').props['aria-checked'],true);assert.equal(ui.choice('Platin').props['aria-checked'],false);assert.equal(ui.calls.length,0);
  assert.equal(ui.close().props.open,false);assert.equal(ui.calls.length,0);
  ui.open();assert.equal(ui.choice('Platin').props['aria-checked'],true);assert.equal(ui.saveButton().props.disabled,true);
});

test('successful saves wait for the accepted selection and synchronously lock duplicate clicks',async t=>{
  let complete;const ui=setup(t,{onSave:()=>new Promise(resolve=>{complete=resolve;})});ui.open();ui.choose('Kristal');
  const save=ui.saveButton();save.props.onClick();save.props.onClick();assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].id,'kristal');assert.equal(ui.calls[0].signal.aborted,false);
  assert.equal(ui.render().props.open,true);assert.equal(ui.saveButton().props.disabled,true);assert.match(text(ui.render()),/Kaydediliyor/);assert.equal(ui.close().props.open,true);
  complete('kristal');await flush();assert.equal(ui.render().props.open,false);
});

test('a rejected or mismatched response keeps the draft and permits a safe retry',async t=>{
  let count=0;const ui=setup(t,{onSave:async(id)=>{count++;if(count===1)throw new Error('Hizmet şu anda kullanılamıyor.');if(count===2)return 'not-a-real-frame';return id;}});
  ui.open();ui.choose('Koi');ui.save();await flush();assert.equal(ui.render().props.open,true);assert.match(text(ui.render()),/Hizmet şu anda kullanılamıyor/);assert.equal(ui.choice('Koi').props['aria-checked'],true);assert.equal(ui.saveButton().props.disabled,false);
  ui.save();await flush();assert.equal(ui.render().props.open,true);assert.ok(find(ui.render(),node=>node.props?.role==='alert'));assert.equal(ui.saveButton().props.disabled,false);
  ui.save();await flush();assert.equal(ui.calls.length,3);assert.equal(ui.render().props.open,false);
});

test('choosing no frame sends the explicit none value instead of leaving the old frame stored',async t=>{
  const ui=setup(t,{frameId:'platin'});ui.open();ui.choose('Çerçevesiz');ui.save();await flush();assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].id,'none');assert.equal(ui.render().props.open,false);
});

test('unmount aborts the request and ignores a late successful response',async t=>{
  let complete;const ui=setup(t,{onSave:()=>new Promise(resolve=>{complete=resolve;})});ui.open();ui.choose('Koi');ui.save();ui.unmount();assert.equal(ui.calls[0].signal.aborted,true);complete('koi');await flush();assert.equal(hooks.lateUpdates(),0);
});

test('account scope replacement aborts the old request before any late completion can close the new picker',async t=>{
  let complete;const ui=setup(t,{onSave:()=>new Promise(resolve=>{complete=resolve;})});ui.open();ui.choose('Koi');ui.save();
  ui.props.userId='other';ui.props.accountScope='other';ui.props.frameId='platin';ui.render();assert.equal(ui.calls[0].signal.aborted,true);
  complete('koi');await flush();assert.equal(ui.render().props.open,true);assert.equal(ui.calls.length,1);assert.equal(hooks.lateUpdates(),0);
});

test('keyboard choices wrap, support row navigation and retain a single selected tab stop',t=>{
  const ui=setup(t);ui.open();let prevented=false;
  ui.choice('Çerçevesiz').props.onKeyDown({key:'ArrowRight',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(ui.choice('Platin').props.tabIndex,0);
  ui.choice('Platin').props.onKeyDown({key:'ArrowDown',preventDefault(){}});assert.equal(ui.choice('Mürekkep').props['aria-checked'],true);
  ui.choice('Mürekkep').props.onKeyDown({key:'End',preventDefault(){}});assert.equal(ui.choice('Yıldız Mührü').props.tabIndex,0);
  ui.choice('Yıldız Mührü').props.onKeyDown({key:'ArrowRight',preventDefault(){}});assert.equal(ui.choice('Çerçevesiz').props.tabIndex,0);assert.equal(ui.calls.length,0);
});

test('disabled picker cannot open or save a changed draft',t=>{
  const ui=setup(t,{disabled:true});assert.equal(ui.open().props.open,false);ui.choose('Koi');ui.save();assert.equal(ui.calls.length,0);
});

test('frame renderer fails closed for unlisted IDs and clips the fixed atlas to each measured ornament',async()=>{
  const {AVATAR_FRAME_GEOMETRY}=await import('../lib/avatar-frame-geometry.mjs');
  for(const frameId of [undefined,null,'none','unknown','../avatar.png','<svg onload=alert(1)>'])assert.equal(AvatarFrame({frameId}),null);
  for(const frame of AVATAR_FRAMES){
    const html=renderToStaticMarkup(React.createElement(AvatarFrame,{frameId:frame.id}));
    assert.match(html,new RegExp(`data-frame-id="${frame.id}"`));assert.match(html,/aria-hidden="true"/);assert.match(html,/<svg/);assert.match(html,/<image href="\/site\/assets\/avatar-frames-v1\.png"/);assert.doesNotMatch(html,/<img\b|https?:|data:/);
    const tree=AvatarFrame({frameId:frame.id}),{crop,aperture:[cx,cy,radius]}=AVATAR_FRAME_GEOMETRY[frame.id];
    const viewport=find(tree,node=>node.type==='svg');assert.equal(viewport.props.viewBox,`${cx-radius} ${cy-radius} ${radius*2} ${radius*2}`);
    const clip=find(viewport.props.children,node=>node.type==='svg');assert.ok(clip,'the ornament has its own clipped SVG viewport');assert.equal(clip.props.overflow,'hidden');
    assert.deepEqual([clip.props.x,clip.props.y,clip.props.width,clip.props.height].map(Number),crop);assert.equal(clip.props.viewBox,crop.join(' '));
    const image=find(clip,node=>node.type==='image');assert.equal(Number(image.props.x),0);assert.equal(Number(image.props.y),0);assert.equal(Number(image.props.width),1448);assert.equal(Number(image.props.height),1086);
  }
});
