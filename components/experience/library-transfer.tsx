'use client';
import {useRef,useState} from 'react';
import {Download,Upload,Check,X,ChevronDown,FileSpreadsheet,SlidersHorizontal} from 'lucide-react';
import {DropdownMenu} from 'radix-ui';
import type {Library,LibraryChange} from './types';
import {exportLibrary,parseLibraryJson,fromMalEntries,mergeLibraries,libraryCsv} from '../../lib/library-transfer.mjs';
export default function LibraryTransfer({library,onChange,disabled=false,compact=false}:{library:Library;onChange:LibraryChange;disabled?:boolean;compact?:boolean}){
 const input=useRef<HTMLInputElement>(null),[draft,setDraft]=useState<Library|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reading,setReading]=useState(false);
 function download(csv=false){const blob=new Blob([csv?libraryCsv(library):exportLibrary(library)],{type:csv?'text/csv;charset=utf-8':'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='anime-takvimi-listem.'+(csv?'csv':'json');link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function read(file:File){setReading(true);setDraft(null);setNotice('');setError('');try{
  if(file.size>1048576)throw new Error('Dosya en fazla 1 MiB olabilir.');
  const text=await file.text();let imported:Library;
  if(file.name.toLowerCase().endsWith('.xml')){
   if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('Bu XML dosyası desteklenmiyor.');
   const xml=new DOMParser().parseFromString(text,'application/xml');if(xml.querySelector('parsererror')||!xml.querySelector('myanimelist'))throw new Error('MyAnimeList XML dışa aktarımını seç.');
   imported=fromMalEntries([...xml.querySelectorAll('anime')].map(node=>{const get=(name:string)=>node.querySelector(name)?.textContent||'';return {id:get('series_animedb_id'),title:get('series_title'),episodes:get('series_episodes'),progress:get('my_watched_episodes'),score:get('my_score'),status:get('my_status')};})) as Library;
  }else imported=parseLibraryJson(text) as Library;
  mergeLibraries(library,imported);setDraft(imported);
 }catch(reason){setError(reason instanceof Error?reason.message:'Dosya okunamadı.');}finally{setReading(false);if(input.current)input.current.value='';}}
 return <section className={'at-library-transfer'+(compact?' is-compact':'')} aria-label="Liste aktarımı">
  {compact?<DropdownMenu.Root modal={false}>
   <DropdownMenu.Trigger className="at-transfer-trigger"><SlidersHorizontal size={15} aria-hidden="true"/><span>Liste işlemleri</span><ChevronDown size={14} aria-hidden="true"/></DropdownMenu.Trigger>
   <DropdownMenu.Portal><DropdownMenu.Content className="at-transfer-menu" align="end" sideOffset={8} collisionPadding={12} aria-label="Liste işlemleri">
    <DropdownMenu.Label className="at-transfer-menu-label">Listeni taşı ve yedekle</DropdownMenu.Label>
    <DropdownMenu.Item className="at-transfer-menu-item" onSelect={()=>download()}><Download size={17} aria-hidden="true"/><span>JSON yedeği<small>Listeni ve ilerlemeni kaydet</small></span></DropdownMenu.Item>
    <DropdownMenu.Item className="at-transfer-menu-item" onSelect={()=>download(true)}><FileSpreadsheet size={17} aria-hidden="true"/><span>CSV indir<small>Tablo olarak dışa aktar</small></span></DropdownMenu.Item>
    <DropdownMenu.Separator className="at-transfer-menu-separator"/>
    <DropdownMenu.Item className="at-transfer-menu-item" disabled={disabled||reading} onSelect={()=>input.current?.click()}><Upload size={17} aria-hidden="true"/><span>{reading?'Okunuyor…':'İçe aktar'}<small>JSON veya MyAnimeList XML</small></span></DropdownMenu.Item>
   </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>:<><div><strong>Listen her zaman yanında</strong><p>JSON yedeğini veya MyAnimeList XML dosyanı içe aktar. Mevcut ilerleme ve puanların korunur.</p></div><div className="at-transfer-actions"><button type="button" className="at-outline-button" onClick={()=>download()}><Download size={15}/>JSON yedeği</button><button type="button" className="at-text-button" onClick={()=>download(true)}>CSV indir</button><button type="button" className="at-primary-button" disabled={disabled||reading} onClick={()=>input.current?.click()}><Upload size={15}/>{reading?'Okunuyor…':'İçe aktar'}</button></div></>}
  <input ref={input} type="file" accept=".json,.xml,application/json,text/xml" hidden aria-label="Liste dosyası seç" onChange={event=>{const file=event.target.files?.[0];if(file)void read(file);}}/>
  {draft&&<div className="at-transfer-preview" role="status"><p><strong>{draft.saved.length} anime</strong> okundu. Yeni kayıtlar mevcut listene eklenecek; aynı animedeki mevcut ayarların korunacak.</p><button type="button" className="at-primary-button" disabled={disabled} onClick={()=>{try{const merged=mergeLibraries(library,draft) as Library;onChange(merged,{recordActivity:false});setDraft(null);setNotice('Liste birleştirildi.');}catch{setError('Birleştirme sınırı aşıldı. Listede en fazla 500 anime bulunabilir.');}}}><Check size={15}/>Listeme ekle</button><button type="button" className="at-text-button" onClick={()=>setDraft(null)}><X size={15}/>Vazgeç</button></div>}{error&&<p className="at-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>;
}
