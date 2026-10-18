'use client';

import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {AvatarFrame} from './avatar-frame';

/** Decorate the existing account avatar without replacing its photo or controls. */
export default function AccountAvatarFrames({frameId,ready}:{frameId?:string|null;ready:boolean}) {
  const [targets,setTargets]=useState<HTMLElement[]>([]);
  useEffect(()=>{
    if(!ready)return;
    const root=document.querySelector('.nav-account');
    if(!root)return;
    const slots=new Map<HTMLElement,HTMLSpanElement>();
    let frame=0;
    const reconcile=()=>{
      frame=0;
      const hosts=Array.from(root.querySelectorAll<HTMLElement>('[data-avatar-frame]'));
      for(const [host,slot] of slots){if(!hosts.includes(host)){slot.remove();slots.delete(host);}}
      for(const host of hosts){
        const current=slots.get(host);
        if(current?.parentNode===host)continue;
        const slot=document.createElement('span');
        slot.className='at-account-frame-slot';slot.setAttribute('aria-hidden','true');
        host.appendChild(slot);slots.set(host,slot);
      }
      const next=hosts.map(host=>slots.get(host)!);
      setTargets(previous=>previous.length===next.length&&previous.every((item,index)=>item===next[index])?previous:next);
    };
    const observer=new MutationObserver(()=>{if(!frame)frame=requestAnimationFrame(reconcile);});
    observer.observe(root,{childList:true,subtree:true});
    reconcile();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();for(const slot of slots.values())slot.remove();};
  },[ready]);
  return <>{targets.map((target,index)=>createPortal(<AvatarFrame frameId={frameId}/>,target,String(index)))}</>;
}
