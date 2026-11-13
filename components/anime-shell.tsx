import Script from 'next/script';
import Link from 'next/link';
import {animeMarkup} from '@/app/anime-markup';
import AnimeExperience from './experience/experience';
import type {Anime} from './experience/types';
export default function AnimeShell({initialAnime}:{initialAnime?:Anime}){return <div className={initialAnime?'anime-direct-shell':undefined}>
 {initialAnime&&<main className="anime-detail-prerender at-enhancement-panel"><Link href="/">← Anime Takvimi</Link><h1>{initialAnime.title}</h1>{initialAnime.image&&<img src={initialAnime.image} width={225} height={338} fetchPriority="high" alt={initialAnime.title+' afişi'} referrerPolicy="no-referrer"/>}<p>{initialAnime.studio} · {initialAnime.episodes?initialAnime.episodes+' bölüm':'Bölüm sayısı açıklanmadı'}</p><p>{initialAnime.summary}</p><a href={initialAnime.malUrl||undefined} rel="noopener noreferrer">MyAnimeList’te gör</a></main>}
 <div id="anime-site" dangerouslySetInnerHTML={{__html:animeMarkup}}/><AnimeExperience initialAnime={initialAnime}/><Script id="anime-bootstrap" src="/site/bootstrap.js" strategy="afterInteractive"/>
 </div>;}
