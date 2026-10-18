'use client';

import {Select} from 'radix-ui';
import {Bookmark,Check,ChevronDown,ChevronUp,CircleCheck,ListPlus,Play,Square} from 'lucide-react';
import type {WatchStatus} from './types';

const options=[
  {value:'watching',label:'İzliyorum',description:'İzlemeye devam ediyorum',Icon:Play},
  {value:'planned',label:'İzleyeceğim',description:'Daha sonra izleyeceğim',Icon:Bookmark},
  {value:'completed',label:'Tamamladım',description:'Tüm bölümleri bitirdim',Icon:CircleCheck},
  {value:'dropped',label:'Bıraktım',description:'İzlemeyi bıraktım',Icon:Square},
] as const;

export function WatchStatusSelect({value,onChange,disabled=false,label='İzleme durumu',compact=false}:{
  value:WatchStatus|'';onChange:(value:WatchStatus)=>void;disabled?:boolean;label?:string;compact?:boolean;
}){
  const selected=options.find(option=>option.value===value),Icon=selected?.Icon||ListPlus;
  return <Select.Root value={value} disabled={disabled} onValueChange={next=>{if(options.some(option=>option.value===next))onChange(next as WatchStatus);}}>
    <Select.Trigger className={'at-watch-status-trigger'+(compact?' is-compact':'')} aria-label={label} data-watch-status={value||'empty'}>
      <span className="at-watch-status-symbol" aria-hidden="true"><Icon size={15}/></span>
      <Select.Value placeholder="Listene ekle">{selected?.label}</Select.Value>
      <Select.Icon className="at-watch-status-chevron"><ChevronDown size={14}/></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content className="at-watch-status-menu" position="popper" align="start" sideOffset={7} collisionPadding={12}>
        <Select.ScrollUpButton className="at-watch-status-scroll"><ChevronUp size={15}/></Select.ScrollUpButton>
        <Select.Viewport>
          <Select.Group>
            <Select.Label className="at-watch-status-heading">İzleme durumu</Select.Label>
            {options.map(option=><Select.Item key={option.value} value={option.value} textValue={option.label} className="at-watch-status-option" data-watch-status={option.value}>
              <span className="at-watch-status-symbol" aria-hidden="true"><option.Icon size={16}/></span>
              <span className="at-watch-status-copy"><Select.ItemText>{option.label}</Select.ItemText><small>{option.description}</small></span>
              <Select.ItemIndicator className="at-watch-status-check"><Check size={16}/></Select.ItemIndicator>
            </Select.Item>)}
          </Select.Group>
        </Select.Viewport>
        <Select.ScrollDownButton className="at-watch-status-scroll"><ChevronDown size={15}/></Select.ScrollDownButton>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}
