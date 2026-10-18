'use client';

import {useEffect,useId,useRef,useState} from 'react';
import type {CSSProperties,KeyboardEvent} from 'react';
import {Popover} from 'radix-ui';
import {Check,Moon,Palette,Sun,X} from 'lucide-react';
import {THEMES,THEME_EVENT,applyTheme,getActiveTheme} from './themes';
import type {ThemeId} from './themes';
import './theme-picker.css';

type Theme=(typeof THEMES)[number];

function ThemeMotif({id}:{id:ThemeId}){
  if(id==='porselen')return <svg viewBox="0 0 70 64"><path d="m13 34 24-24 23 24-23 22Z" fill="currentColor" opacity=".16"/><path d="m13 34 24-24 23 24-23 22Zm0 0h47M37 10v46" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="m37 10 9 24-9 22-8-22Z" fill="currentColor" opacity=".35"/></svg>;
  if(id==='gece')return <svg viewBox="0 0 70 64"><g fill="none" stroke="currentColor"><ellipse cx="35" cy="32" rx="29" ry="12" transform="rotate(-31 35 32)" opacity=".5"/><circle cx="35" cy="32" r="18" opacity=".25"/></g><circle cx="35" cy="32" r="9" fill="currentColor"/><circle cx="58" cy="17" r="3" fill="currentColor"/><path d="m15 10 1.5 4.5L21 16l-4.5 1.5L15 22l-1.5-4.5L9 16l4.5-1.5Z" fill="currentColor" opacity=".7"/></svg>;
  if(id==='nar')return <svg viewBox="0 0 70 64"><path d="M35 12c17 0 26 13 22 27-4 15-16 21-22 21S17 54 13 39c-4-14 5-27 22-27Z" fill="currentColor" opacity=".14"/><path d="m27 9 8 7 8-7M35 18v36" fill="none" stroke="currentColor" strokeWidth="1.5"/><g fill="currentColor"><ellipse cx="26" cy="27" rx="4" ry="5"/><ellipse cx="43" cy="29" rx="4" ry="5"/><ellipse cx="24" cy="41" rx="4" ry="5"/><ellipse cx="42" cy="44" rx="4" ry="5"/><ellipse cx="34" cy="35" rx="3" ry="4"/></g></svg>;
  if(id==='buzul')return <svg viewBox="0 0 70 64"><path d="m35 6 21 14 7 27-28 12L8 47l6-27Z" fill="currentColor" opacity=".13"/><path d="m35 6 21 14 7 27-28 12L8 47l6-27Zm0 0 9 27-9 26-10-26Zm-21 14 30 13 19 14M8 47l17-14 31-13" fill="none" stroke="currentColor" strokeWidth="1.4"/></svg>;
  if(id==='ada')return <svg viewBox="0 0 70 64"><path d="M6 39c8-9 13 9 22 0s14 9 23 0 13 0 15 0M6 48c8-9 13 9 22 0s14 9 23 0 13 0 15 0M6 57c8-9 13 9 22 0s14 9 23 0 13 0 15 0" fill="none" stroke="currentColor" strokeWidth="1.6" opacity=".6"/><path d="M21 29c1-11 9-18 17-18 9 0 15 8 16 18Z" fill="currentColor" opacity=".32"/><path d="M15 30h45" stroke="currentColor" strokeWidth="1.4"/></svg>;
  if(id==='kumtasi')return <svg viewBox="0 0 70 64"><g fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 49C17 17 38 60 68 19M2 39C19 6 40 49 68 9" opacity=".35"/><path d="M2 59C17 27 38 70 68 29"/><path d="M12 64C26 42 47 68 68 42" opacity=".7"/></g><circle cx="44" cy="16" r="8" fill="currentColor" opacity=".3"/></svg>;
  if(id==='volt')return <svg viewBox="0 0 70 64"><path d="m39 5-23 30h16l-2 24 25-34H39Z" fill="currentColor"/><path d="M8 12h13M5 19h10m40 29h11m-16 7h13" stroke="currentColor" strokeWidth="1.5" opacity=".4"/></svg>;
  return <svg viewBox="0 0 70 64"><g fill="currentColor"><path d="M35 33C10 34 6 9 20 10c12 1 15 14 15 23Z" opacity=".45"/><path d="M35 33C36 7 61 5 60 20c-1 11-15 13-25 13Z" opacity=".75"/><path d="M35 33c25-1 29 24 14 23-11-1-14-14-14-23Z" opacity=".45"/><path d="M35 33C34 59 9 61 10 46c1-11 15-13 25-13Z" opacity=".75"/><circle cx="35" cy="33" r="4"/></g></svg>;
}

function ThemePreview({theme}:{theme:Theme}){
  const colors=theme.colors;
  const style={
    '--preview-paper':colors.paper,'--preview-surface':colors.surface,'--preview-ink':colors.ink,
    '--preview-muted':colors.muted,'--preview-line':colors.line,'--preview-accent':colors.accent,
    '--preview-sage':colors.sage,'--preview-nav':colors.nav,
  } as CSSProperties;
  return <span className="at-theme-preview" data-preview={theme.id} data-mode={theme.mode} style={style} aria-hidden="true">
    <span className="at-theme-preview-top"><i/><i/></span>
    <span className="at-theme-motif"><ThemeMotif id={theme.id}/></span>
    <span className="at-theme-preview-cards"><i/><i/><i/><i/></span>
    <span className="at-theme-preview-bottom"><i/><i/></span>
  </span>;
}

export default function ThemePicker(){
  const [active,setActive]=useState<ThemeId>(THEMES[0].id);
  const [open,setOpen]=useState(false);
  const grid=useRef<HTMLDivElement>(null);
  const title=useId();
  const selected=THEMES.find(theme=>theme.id===active)||THEMES[0];
  useEffect(()=>{
    const sync=()=>setActive(getActiveTheme());
    const close=()=>setOpen(false);
    sync();
    window.addEventListener(THEME_EVENT,sync);
    window.addEventListener('hashchange',close);
    window.addEventListener('anime:navigate',close);
    return()=>{window.removeEventListener(THEME_EVENT,sync);window.removeEventListener('hashchange',close);window.removeEventListener('anime:navigate',close);};
  },[]);
  const choose=(id:ThemeId)=>{applyTheme(id);setActive(id);};
  function move(event:KeyboardEvent<HTMLButtonElement>,index:number){
    if(event.altKey||event.ctrlKey||event.metaKey)return;
    let next=index;
    if(event.key==='ArrowRight')next=(index+1)%THEMES.length;
    else if(event.key==='ArrowLeft')next=(index+THEMES.length-1)%THEMES.length;
    else if(event.key==='ArrowDown')next=(index+2)%THEMES.length;
    else if(event.key==='ArrowUp')next=(index+THEMES.length-2)%THEMES.length;
    else if(event.key==='Home')next=0;
    else if(event.key==='End')next=THEMES.length-1;
    else return;
    event.preventDefault();
    choose(THEMES[next].id);
    grid.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  }
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger type="button" className="nav-item theme-nav-trigger" aria-label="Temayı değiştir" title="Temayı değiştir">
      <span data-icon="palette" aria-hidden="true"><Palette className="icon" aria-hidden="true"/></span>
    </Popover.Trigger>
    <Popover.Portal><Popover.Content className="at-theme-picker" align="end" sideOffset={12} collisionPadding={12} aria-labelledby={title} onOpenAutoFocus={event=>{event.preventDefault();grid.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();}}>
      <header className="at-theme-picker-heading"><h2 id={title}>Görünüm</h2><span className="at-theme-current" aria-live="polite">{selected.name}</span><Popover.Close type="button" className="at-theme-close" aria-label="Tema seçimini kapat"><X size={15}/></Popover.Close></header>
      <div ref={grid} className="at-theme-grid" role="radiogroup" aria-label="Site teması">
        {THEMES.map((theme,index)=><button key={theme.id} type="button" role="radio" aria-checked={active===theme.id} aria-label={`${theme.name}, ${theme.mode==='light'?'açık':'koyu'} tema. ${theme.description}`} tabIndex={active===theme.id?0:-1} className={'at-theme-card'+(active===theme.id?' is-selected':'')} onClick={()=>choose(theme.id)} onKeyDown={event=>move(event,index)}>
          <ThemePreview theme={theme}/>
          {active===theme.id&&<span className="at-theme-selected" aria-hidden="true"><Check size={13} strokeWidth={3}/></span>}
          <span className="at-theme-card-label"><strong>{theme.name}</strong>{theme.mode==='light'?<Sun size={15} aria-hidden="true"/>:<Moon size={15} aria-hidden="true"/>}</span>
        </button>)}
      </div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
