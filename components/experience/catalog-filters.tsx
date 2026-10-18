'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Popover,Select} from 'radix-ui';
import {ArrowDownAZ,CalendarDays,Check,ChevronDown,ChevronUp,Search,Star,Tags,TrendingUp,X} from 'lucide-react';

type Kind='sort'|'genre';
type FilterState={value:string;disabled:boolean;options:{value:string;label:string;disabled:boolean}[]};
type Target={kind:Kind;select:HTMLSelectElement;slot:HTMLElement};
const sorting={
  popular:{Icon:TrendingUp,description:'En çok takip edilen animeler'},
  rating:{Icon:Star,description:'MyAnimeList puanına göre'},
  title:{Icon:ArrowDownAZ,description:'Başlığa göre alfabetik'},
  airtime:{Icon:CalendarDays,description:'Yayın günü ve saatine göre'},
};
const fold=(value:string)=>value.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').trim();

export function readCatalogFilter(select:HTMLSelectElement):FilterState{
  return {value:select.value,disabled:select.disabled,options:Array.from(select.options).map(option=>({value:option.value,label:option.label,disabled:option.disabled}))};
}
export function changeCatalogFilter(select:HTMLSelectElement,value:string){
  if(select.disabled||!Array.from(select.options).some(option=>option.value===value&&!option.disabled))return false;
  select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));return true;
}
function CatalogFilter({kind,select}:Omit<Target,'slot'>){
  const [state,setState]=useState(()=>readCatalogFilter(select));
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState<string|null>(null);
  const search=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null),id=useId();
  const title=kind==='sort'?'Sıralama':'Anime türü';
  const selected=state.options.find(option=>option.value===state.value);
  const filtered=state.options.filter(option=>!option.disabled&&fold(option.label).includes(fold(query)));
  const index=filtered.findIndex(option=>option.value===active);
  const toggle=(next:boolean)=>{setOpen(next);if(!next){setQuery('');setActive(null);}};
  const choose=(value:string)=>{if(changeCatalogFilter(select,value)){setState(readCatalogFilter(select));toggle(false);}};
  useEffect(()=>{
    const sync=()=>{const next=readCatalogFilter(select);setState(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);if(!select.closest('label')?.parentElement?.getClientRects().length)toggle(false);};
    const close=()=>toggle(false);
    const observer=new MutationObserver(sync);
    observer.observe(select,{subtree:true,childList:true,attributes:true,attributeFilter:['selected','disabled','value','label']});
    select.addEventListener('change',sync);
    const updates=['anime:viewrender','anime:accountchange','anime:librarychange'];
    const navigation=['anime:navigate','anime:detail','anime:profile','anime:adminchange','hashchange'];
    updates.forEach(event=>window.addEventListener(event,sync));navigation.forEach(event=>window.addEventListener(event,close));
    return()=>{observer.disconnect();select.removeEventListener('change',sync);updates.forEach(event=>window.removeEventListener(event,sync));navigation.forEach(event=>window.removeEventListener(event,close));};
  },[select]);
  useEffect(()=>{
    const viewport=list.current,option=viewport?.querySelector<HTMLElement>('[data-highlighted="true"]');
    if(!viewport||!option)return;
    const top=option.offsetTop,bottom=top+option.offsetHeight;
    if(top<viewport.scrollTop)viewport.scrollTop=top;
    else if(bottom>viewport.scrollTop+viewport.clientHeight)viewport.scrollTop=bottom-viewport.clientHeight;
  },[active]);
  if(kind==='sort'){
    const Icon=sorting[state.value as keyof typeof sorting]?.Icon||TrendingUp;
    return <Select.Root value={state.value} open={open} onOpenChange={toggle} disabled={state.disabled} onValueChange={choose}>
      <Select.Trigger type="button" className="at-watch-status-trigger at-catalog-filter-trigger" aria-label={title}>
        <span className="at-watch-status-symbol" aria-hidden="true"><Icon size={15}/></span><Select.Value>{selected?.label}</Select.Value><Select.Icon className="at-watch-status-chevron"><ChevronDown size={14}/></Select.Icon>
      </Select.Trigger>
      <Select.Portal><Select.Content className="at-watch-status-menu at-catalog-sort-menu" position="popper" align="end" sideOffset={7} collisionPadding={12}>
        <Select.ScrollUpButton className="at-watch-status-scroll"><ChevronUp size={15}/></Select.ScrollUpButton>
        <Select.Viewport><Select.Group><Select.Label className="at-watch-status-heading">Sıralama</Select.Label>
          {state.options.map(option=>{const meta=sorting[option.value as keyof typeof sorting],ItemIcon=meta?.Icon||TrendingUp;return <Select.Item key={option.value} value={option.value} disabled={option.disabled} textValue={option.label} className="at-watch-status-option">
            <span className="at-watch-status-symbol" aria-hidden="true"><ItemIcon size={16}/></span><span className="at-watch-status-copy"><Select.ItemText>{option.label}</Select.ItemText>{meta&&<small>{meta.description}</small>}</span><Select.ItemIndicator className="at-watch-status-check"><Check size={16}/></Select.ItemIndicator>
          </Select.Item>;})}
        </Select.Group></Select.Viewport><Select.ScrollDownButton className="at-watch-status-scroll"><ChevronDown size={15}/></Select.ScrollDownButton>
      </Select.Content></Select.Portal>
    </Select.Root>;
  }
  return <Popover.Root open={open} onOpenChange={toggle}>
    <Popover.Trigger type="button" className="at-watch-status-trigger at-catalog-filter-trigger" disabled={state.disabled} aria-label={`${title}: ${selected?.label||'Tüm türler'}`}>
      <span className="at-watch-status-symbol" aria-hidden="true"><Tags size={15}/></span><span>{selected?.label||'Tüm türler'}</span><span className="at-watch-status-chevron"><ChevronDown size={14}/></span>
    </Popover.Trigger>
    <Popover.Portal><Popover.Content className="at-watch-status-menu at-catalog-genre-menu" align="end" sideOffset={7} collisionPadding={12} aria-label="Anime türünü seç" onOpenAutoFocus={event=>{event.preventDefault();search.current?.focus();}}>
      <div className="at-watch-status-heading">Anime türü <span>{state.options.filter(option=>option.value!=='all').length}</span></div>
      <div className="at-catalog-genre-search"><Search size={15} aria-hidden="true"/><input ref={search} value={query} onChange={event=>{setQuery(event.target.value);setActive(null);}} placeholder="Tür ara…" aria-label="Türlerde ara" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={id} aria-activedescendant={index>=0?`${id}-${index}`:undefined} autoComplete="off" onKeyDown={event=>{
        if(event.nativeEvent.isComposing)return;
        if(filtered.length&&(event.key==='ArrowDown'||event.key==='ArrowUp')){event.preventDefault();const next=event.key==='ArrowDown'?(index+1)%filtered.length:index<=0?filtered.length-1:index-1;setActive(filtered[next].value);}
        if(event.key==='Enter'){event.preventDefault();const option=filtered[index>=0?index:0];if(option)choose(option.value);}
      }}/>{query&&<button type="button" aria-label="Tür aramasını temizle" onClick={()=>{setQuery('');setActive(null);search.current?.focus();}}><X size={13}/></button>}</div>
      <div ref={list} id={id} className="at-catalog-genre-options" role="listbox" aria-label="Anime türleri">
        {filtered.map((option,position)=><div id={`${id}-${position}`} key={option.value} role="option" aria-selected={option.value===state.value} data-highlighted={option.value===active||undefined} className={'at-watch-status-option at-catalog-genre-option'+(option.value===state.value?' is-selected':'')} onMouseEnter={()=>setActive(option.value)} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(option.value)}>
          <span className="at-watch-status-symbol" aria-hidden="true"><Tags size={14}/></span><span className="at-watch-status-copy">{option.label}</span>{option.value===state.value&&<Check size={15} className="at-watch-status-check" aria-label="Seçili tür"/>}
        </div>)}
      </div>
      {!filtered.length&&<p className="at-catalog-genre-empty" role="status">Bu aramayla eşleşen tür bulunamadı.</p>}
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
export default function CatalogFilters({page}:{page:string}){
  const [targets,setTargets]=useState<Target[]>([]);
  useEffect(()=>{
    const attached:{target:Target;label:HTMLElement;wasHidden:boolean}[]=[];
    for(const kind of ['sort','genre'] as const){
      const select=document.getElementById(kind) as HTMLSelectElement|null,label=select?.closest<HTMLElement>('label');
      if(!select||!label?.parentNode)continue;
      const slot=document.createElement('div');slot.className=`at-catalog-filter-slot is-${kind}`;
      label.parentNode.insertBefore(slot,label);
      attached.push({target:{kind,select,slot},label,wasHidden:label.hidden});label.hidden=true;
    }
    setTargets(attached.map(item=>item.target));
    return()=>{for(const item of attached){item.target.slot.remove();item.label.hidden=item.wasHidden;}};
  },[]);
  return <>{targets.map(target=>createPortal(<CatalogFilter kind={target.kind} select={target.select}/>,target.slot,target.kind+page))}</>;
}
