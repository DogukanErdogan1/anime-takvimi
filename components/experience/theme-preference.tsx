'use client';
import {useEffect} from 'react';
import {applyTheme,LEGACY_THEME_KEY,readThemePreference,THEME_KEY} from './themes';
export default function ThemePreference(){
  useEffect(()=>{
    const restore=()=>applyTheme(readThemePreference(),false);
    restore();
    const sync=(event:StorageEvent)=>{
      if(event.key===null||event.key===THEME_KEY||event.key===LEGACY_THEME_KEY)restore();
    };
    window.addEventListener('storage',sync);
    return()=>window.removeEventListener('storage',sync);
  },[]);
  return null;
}
