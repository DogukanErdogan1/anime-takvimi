'use client';
import {useEffect} from 'react';
export default function ThemePreference(){
  useEffect(()=>{
    try{document.documentElement.dataset.theme=localStorage.getItem('anime-takvimi-theme-v1')==='dark'?'dark':'light';}catch{document.documentElement.dataset.theme='light';}
  },[]);
  return null;
}
