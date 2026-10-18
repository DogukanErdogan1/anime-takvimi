import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const runtime=resolve('.sites-runtime');mkdirSync(runtime,{recursive:true});const files=[];
function write(name,source){const file=resolve(runtime,`account-avatar-frames-${name}-${process.pid}.mjs`);files.push(file);writeFileSync(file,source);return file;}
const hooksFile=write('hooks',`let values=[],cursor=0,effects=new Map(),queue=[],dirty=false,writes=0;export function reset(){values=[];cursor=0;effects=new Map();queue=[];dirty=false;writes=0;}export function begin(){cursor=0;dirty=false;}export function useState(initial){const index=cursor++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return[values[index],next=>{const value=typeof next==='function'?next(values[index]):next;if(!Object.is(values[index],value)){values[index]=value;dirty=true;writes++;}}];}export function useEffect(callback,deps){const index=cursor++,old=effects.get(index);if(!old||old.deps.length!==deps.length||deps.some((value,i)=>!Object.is(value,old.deps[i])))queue.push({index,callback,deps});}export function flush(){for(const entry of queue.splice(0)){effects.get(entry.index)?.cleanup?.();effects.set(entry.index,{deps:entry.deps,cleanup:entry.callback()});}return dirty;}export function changed(){return writes;}export function unmount(){for(const effect of effects.values())effect.cleanup?.();effects.clear();}`);
const portalFile=write('portal',`export function createPortal(children,target,key){return{type:'test-portal',key,props:{children,target}};}`);
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX};
const compile=(name,source)=>write(name,ts.transpileModule(source,{compilerOptions:options}).outputText);
const frameFile=compile('renderer',readFileSync(new URL('../components/experience/avatar-frame.tsx',import.meta.url),'utf8')
  .replace("from '../../lib/avatar-frames.mjs'",`from '${new URL('../lib/avatar-frames.mjs',import.meta.url).href}'`)
  .replace("from '../../lib/avatar-frame-geometry.mjs'",`from '${new URL('../lib/avatar-frame-geometry.mjs',import.meta.url).href}'`));
const source=readFileSync(new URL('../components/experience/account-avatar-frames.tsx',import.meta.url),'utf8')
  .replace("from 'react'",`from './${hooksFile.split(/[/\\]/).at(-1)}'`)
  .replace("from 'react-dom'",`from './${portalFile.split(/[/\\]/).at(-1)}'`)
  .replace("from './avatar-frame'",`from './${frameFile.split(/[/\\]/).at(-1)}'`);
const componentFile=compile('component',source);
after(()=>{for(const file of files)try{unlinkSync(file);}catch{}});
const hooks=await import(pathToFileURL(hooksFile).href),{default:AccountAvatarFrames}=await import(pathToFileURL(componentFile).href),{AvatarFrame}=await import(pathToFileURL(frameFile).href);

function setup(t,{ready=true,hosts=1,rootExists=true}={}){
  const previous={document:globalThis.document,MutationObserver:globalThis.MutationObserver,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
  const observers=[],pending=new Set(),frames=new Map();let frameNumber=0,unmounted=false;
  function notify(node){for(const observer of observers){if(!observer.connected)continue;for(let parent=node;parent;parent=parent.parentNode){if(parent===observer.target){pending.add(observer);break;}}}}
  class Element{
    constructor(tag='span'){this.tagName=tag.toUpperCase();this.children=[];this.attributes=new Map();this.parentNode=null;this.className='';}
    setAttribute(key,value){this.attributes.set(key,value);}hasAttribute(key){return this.attributes.has(key);}
    appendChild(child){child.remove();child.parentNode=this;this.children.push(child);notify(this);return child;}
    remove(){if(!this.parentNode)return;const parent=this.parentNode;parent.children.splice(parent.children.indexOf(this),1);this.parentNode=null;notify(parent);}
    querySelectorAll(selector){assert.equal(selector,'[data-avatar-frame]');const result=[];function visit(node){for(const child of node.children){if(child.hasAttribute('data-avatar-frame'))result.push(child);visit(child);}}visit(this);return result;}
  }
  const root=new Element('div'),makeHost=()=>{const host=new Element('span');host.setAttribute('data-avatar-frame','');const photo=new Element('img');photo.setAttribute('data-account-avatar','');host.appendChild(photo);return host;};
  const initialHosts=Array.from({length:hosts},()=>makeHost());for(const host of initialHosts)root.appendChild(host);
  globalThis.document={querySelector(selector){assert.equal(selector,'.nav-account');return rootExists?root:null;},createElement(tag){return new Element(tag);}};
  globalThis.MutationObserver=class{constructor(callback){this.callback=callback;this.connected=false;observers.push(this);}observe(target,options){this.target=target;this.options=options;this.connected=true;}disconnect(){this.connected=false;pending.delete(this);}};
  globalThis.requestAnimationFrame=callback=>{const number=++frameNumber;frames.set(number,callback);return number;};globalThis.cancelAnimationFrame=number=>frames.delete(number);
  const props={frameId:'platin',ready};hooks.reset();let tree;
  function render(){for(let count=0;count<8;count++){hooks.begin();tree=AccountAvatarFrames(props);if(!hooks.flush())return tree;}assert.fail('account avatar effects must settle');}
  function mutations(){const queued=[...pending];pending.clear();for(const observer of queued)if(observer.connected)observer.callback([]);}
  function animation(){const queued=[...frames.values()];frames.clear();for(const callback of queued)callback();render();}
  function settle(){for(let count=0;count<8&&(pending.size||frames.size);count++){mutations();animation();}assert.equal(pending.size+frames.size,0,'owned portal mutations must settle without an observer loop');return render();}
  const unmount=()=>{if(!unmounted){hooks.unmount();unmounted=true;}};
  t.after(()=>{unmount();for(const[key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  render();
  return{root,initialHosts,makeHost,props,observers,frames,pending,render,mutations,animation,settle,unmount,writes:hooks.changed,portals(){return render().props.children;},create(tag){return new Element(tag);}};
}

test('account decoration adds owned portal slots while preserving the native photo and controls',t=>{
  const ui=setup(t,{hosts:2});const portals=ui.portals();assert.equal(portals.length,2);assert.equal(ui.observers.length,1);assert.deepEqual(ui.observers[0].options,{childList:true,subtree:true});
  for(const [index,host] of ui.initialHosts.entries()){
    assert.equal(host.children[0].tagName,'IMG');assert.equal(host.children[0].hasAttribute('data-account-avatar'),true);assert.equal(host.children.length,2);
    const slot=host.children[1];assert.equal(slot.className,'at-account-frame-slot');assert.equal(slot.attributes.get('aria-hidden'),'true');assert.equal(portals[index].props.target,slot);assert.equal(portals[index].props.children.type,AvatarFrame);assert.equal(portals[index].props.children.props.frameId,'platin');
  }
});

test('native account rerender replaces detached avatar slots and repairs a replaced photo subtree',t=>{
  const ui=setup(t);ui.settle();const originalHost=ui.initialHosts[0],oldSlot=ui.portals()[0].props.target;
  originalHost.remove();const nextHost=ui.makeHost();ui.root.appendChild(nextHost);ui.settle();const nextSlot=ui.portals()[0].props.target;
  assert.notEqual(nextSlot,oldSlot);assert.equal(nextSlot.parentNode,nextHost);assert.equal(oldSlot.parentNode,null);assert.equal(originalHost.children.length,1);assert.equal(nextHost.children[0].tagName,'IMG');
  nextSlot.remove();ui.settle();const repaired=ui.portals()[0].props.target;assert.notEqual(repaired,nextSlot);assert.equal(repaired.parentNode,nextHost);assert.equal(nextHost.children.length,2);
});

test('owned portal changes do not cause redundant state writes or a mutation loop',t=>{
  const ui=setup(t);ui.settle();const writes=ui.writes(),slot=ui.portals()[0].props.target,ornament=ui.create('svg');slot.appendChild(ornament);
  ui.settle();assert.equal(ui.writes(),writes);assert.equal(ui.portals()[0].props.target,slot);assert.equal(slot.children[0],ornament);
  for(let count=0;count<4;count++){ui.observers[0].callback([]);ui.animation();assert.equal(ui.writes(),writes);}
});

test('frame updates reuse the same host slot and cleanup removes only owned elements',t=>{
  const ui=setup(t);ui.settle();const host=ui.initialHosts[0],slot=ui.portals()[0].props.target,foreign=ui.create('button');host.appendChild(foreign);ui.settle();const writes=ui.writes();
  ui.props.frameId='koi';assert.equal(ui.portals()[0].props.children.props.frameId,'koi');assert.equal(ui.portals()[0].props.target,slot);assert.equal(ui.writes(),writes);assert.equal(ui.observers.length,1);
  ui.observers[0].callback([]);assert.equal(ui.frames.size,1);ui.unmount();assert.equal(ui.frames.size,0);assert.equal(ui.observers[0].connected,false);assert.equal(slot.parentNode,null);assert.deepEqual(host.children.map(child=>child.tagName),['IMG','BUTTON']);assert.equal(foreign.parentNode,host);
});

test('readiness cleanup detaches the old account and a new ready host gets fresh slots',t=>{
  const ui=setup(t);ui.settle();const oldSlot=ui.portals()[0].props.target;ui.props.ready=false;ui.render();assert.equal(oldSlot.parentNode,null);assert.equal(ui.observers[0].connected,false);
  ui.initialHosts[0].remove();const next=ui.makeHost();ui.root.appendChild(next);ui.props.ready=true;ui.props.frameId='none';ui.settle();const portal=ui.portals()[0];assert.equal(portal.props.target.parentNode,next);assert.equal(portal.props.children.props.frameId,'none');assert.equal(ui.observers.length,2);assert.equal(ui.observers[1].connected,true);
});

test('unready pages create no slots or observer',t=>{
  const ui=setup(t,{ready:false});assert.deepEqual(ui.portals(),[]);assert.equal(ui.observers.length,0);assert.equal(ui.initialHosts[0].children.length,1);
});

test('an absent account region creates no slots or observer',t=>{
  const ui=setup(t,{rootExists:false});assert.deepEqual(ui.portals(),[]);assert.equal(ui.observers.length,0);assert.equal(ui.initialHosts[0].children.length,1);
});

// Extract the actual native event callback and its account guards. This checks
// the React-to-native bridge without reimplementing membership bootstrapping.
const membership=readFileSync(new URL('../public/site/membership.js',import.meta.url),'utf8');
const membershipAst=ts.createSourceFile('membership.js',membership,ts.ScriptTarget.ESNext,true,ts.ScriptKind.JS);let eventCallback;const guards=[];
function visit(node){if(ts.isFunctionDeclaration(node)&&['registered','activeMember'].includes(node.name?.text))guards.push(node.getText(membershipAst));if(ts.isCallExpression(node)&&node.expression.getText(membershipAst)==='window.addEventListener'&&node.arguments[0]?.text==='anime:avatarframechange')eventCallback=node.arguments[1].getText(membershipAst);ts.forEachChild(node,visit);}visit(membershipAst);
assert.ok(eventCallback,'production avatar frame bridge must be registered');assert.equal(guards.length,2);
function bridge(account,blocked=false){let renders=0;const state={account,blocked};const callback=runInNewContext(`${guards.join('\n')}\n(${eventCallback})`,{state,renderAccount(){renders++;}});return{state,send(detail){callback({detail});},renders:()=>renders};}
const account=()=>({authenticated:true,registered:true,user:{id:'owner',status:'active',avatarFrame:'platin'}});

test('native account bridge accepts the current active account event and rejects stale, invalid or blocked events',()=>{
  const current=bridge(account());current.send({userId:'owner',frameId:'koi'});assert.equal(current.state.account.user.avatarFrame,'koi');assert.equal(current.renders(),1);
  for(const detail of [null,{userId:'other',frameId:'defne'},{userId:'owner',frameId:'<script>'},{userId:'owner',frameId:42}])current.send(detail);assert.equal(current.state.account.user.avatarFrame,'koi');assert.equal(current.renders(),1);
  for(const fixture of [bridge(null),bridge({...account(),authenticated:false}),bridge({...account(),registered:false}),bridge({...account(),user:{...account().user,status:'suspended'}}),bridge(account(),true)]){fixture.send({userId:'owner',frameId:'koi'});assert.equal(fixture.renders(),0);}
});
