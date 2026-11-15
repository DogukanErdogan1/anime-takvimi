import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {resolve,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

mkdirSync('.sites-runtime',{recursive:true});const files=[];
const write=(name,code)=>{const file=resolve(`.sites-runtime/library-tools-react-${name}-${process.pid}.mjs`);files.push(file);writeFileSync(file,code);return file;};
const hooksFile=write('hooks',`let values=[],index=0;export function reset(){values=[];index=0;}export function begin(){index=0;}export function useState(initial){const i=index++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return[values[i],next=>{values[i]=typeof next==='function'?next(values[i]):next;}];}`);
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX};
const modelFile=write('model',ts.transpileModule(readFileSync(new URL('../components/experience/model.ts',import.meta.url),'utf8'),{compilerOptions:options}).outputText);
const detail=readFileSync(new URL('../components/experience/detail-profile.tsx',import.meta.url),'utf8'),experience=readFileSync(new URL('../components/experience/experience.tsx',import.meta.url),'utf8');
const extract=(code,name)=>{const ast=ts.createSourceFile('component.tsx',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);return ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name).getText(ast);};
const code=`import {useState} from './${basename(hooksFile)}';import {statuses,watchStatus,bulkLibraryPatch} from './${basename(modelFile)}';import {Popover} from 'radix-ui';import {Bookmark,Compass,Heart,Plus,ArrowRight,Pencil,Shield,ChevronDown,Check,X} from 'lucide-react';const Poster=()=>null,ProfileLibraryEditor=()=>null,ActivityPanel=()=>null,LibraryTransfer=()=>null,WatchStatusSelect=()=>null;${extract(detail,'EpisodeNotes')}\n${extract(experience,'Watchlist')}`;
const componentFile=write('component',ts.transpileModule(code,{compilerOptions:options}).outputText);
const hooks=await import(pathToFileURL(hooksFile).href),{EpisodeNotes,Watchlist}=await import(pathToFileURL(componentFile).href);
after(()=>{for(const file of files)unlinkSync(file);});
const anime=(id,patch={})=>({id:`mal-${id}`,malId:id,title:`Anime ${id}`,episodes:12,...patch});
const library=()=>({saved:['mal-1','mal-2'],savedAnime:{'mal-1':anime(1),'mal-2':anime(2)},reminders:[],view:'grid',progress:{'mal-1':0,'mal-2':4},tracking:{},favorites:[],scores:{},collections:[],episodeNotes:{'mal-1':{'3':'Existing private note'}}});
const text=node=>node==null||typeof node==='boolean'?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);
function find(tree,predicate){if(!tree||typeof tree!=='object')return null;if(Array.isArray(tree)){for(const node of tree){const match=find(node,predicate);if(match)return match;}return null;}return predicate(tree)?tree:find(tree.props?.children,predicate);}
function setup(Component,disabled=false){hooks.reset();let current=library(),changes=0;const props=Component===EpisodeNotes?{item:anime(1),library:current,disabled}:{snapshot:{ready:true,blocked:false,libraryLoading:false,accountScope:'alice',account:null,library:current},onDetail(){}};props.onChange=patch=>{current={...current,...(typeof patch==='function'?patch(current):patch)};if(Component===EpisodeNotes)props.library=current;else props.snapshot.library=current;changes++;};const render=()=>{hooks.begin();return Component(props);};const button=label=>{const node=find(render(),node=>node.type==='button'&&text(node)===label);assert.ok(node,`button ${label}`);return node;};return {props,render,button,library:()=>current,changes:()=>changes,field:()=>find(render(),node=>node.type==='input'&&node.props.type==='number'),textarea:()=>find(render(),node=>node.type==='textarea'),submit(){return find(render(),node=>node.type==='form').props.onSubmit({preventDefault(){}});},external(patch){props.onChange(patch);}};}

test('episode drafts survive switching chapters and saving one note preserves other drafts and newer library state',()=>{
 const ui=setup(EpisodeNotes);ui.textarea().props.onChange({target:{value:'First draft'}});ui.field().props.onChange({target:{value:'2'}});ui.textarea().props.onChange({target:{value:'Second draft'}});ui.field().props.onChange({target:{value:'1'}});assert.equal(ui.textarea().props.value,'First draft');
 ui.external(current=>({episodeNotes:{...current.episodeNotes,'mal-1':{...current.episodeNotes['mal-1'],'9':'Newer note'}}}));ui.submit();
 assert.deepEqual(ui.library().episodeNotes['mal-1'],{'1':'First draft','3':'Existing private note','9':'Newer note'});assert.match(text(ui.render()),/Notun saklandı/);ui.external({episodeNotes:{'mal-1':{'3':'Existing private note','9':'Newer note'}}});assert.doesNotMatch(text(ui.render()),/Notun saklandı/);ui.field().props.onChange({target:{value:'2'}});assert.equal(ui.textarea().props.value,'Second draft');
 const before=ui.changes();ui.field().props.onChange({target:{value:'0'}});ui.submit();assert.equal(ui.changes(),before);
});

test('disabled note editor cannot mutate even if a stale submit handler is called',()=>{
 const ui=setup(EpisodeNotes,true);assert.equal(ui.textarea().props.disabled,true);ui.textarea().props.onChange({target:{value:'Should not save'}});ui.submit();assert.equal(ui.changes(),0);
});

test('changing the library filter clears selected anime and bulk commands affect only the newly selected visible items',()=>{
 const ui=setup(Watchlist);ui.button('Toplu düzenle').props.onClick();find(ui.render(),node=>node.type==='input'&&node.props['aria-label']==='Anime 1 seç').props.onChange();ui.button('İzliyorum').props.onClick();
 const status=()=>find(ui.render(),node=>node.props?.label==='Seçili animelerin izleme durumu');assert.equal(status().props.disabled,true);
 ui.button('Görünenlerin tümünü seç (1)').props.onClick();ui.button('Favorilere ekle').props.onClick();assert.deepEqual(ui.library().favorites,['mal-2']);assert.equal(ui.changes(),1);assert.equal(status().props.disabled,true);assert.equal(ui.library().episodeNotes['mal-1']['3'],'Existing private note');
});
