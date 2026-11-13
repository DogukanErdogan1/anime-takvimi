import {cache} from 'react';
import Link from 'next/link';
import {notFound} from 'next/navigation';
import type {Metadata} from 'next';
import AnimeShell from '@/components/anime-shell';
import {normalizeAnimePage} from '@/lib/anime-page.mjs';
import type {Anime} from '@/components/experience/types';
export const dynamic='force-dynamic';
const load=cache(async(id:string)=>{if(!/^[1-9]\d{0,9}$/.test(id)||Number(id)>2147483647)return null;const response=await fetch('https://api.tenrai.org/v1/anime/'+id+'/full',{signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}});if(response.status===404)return null;if(!response.ok)throw new Error('Anime bilgisine şu anda ulaşılamıyor.');const json=await response.json() as {data:unknown};return normalizeAnimePage(json.data,Number(id)) as Anime;});
type Props={params:Promise<{id:string}>};
export async function generateMetadata({params}:Props):Promise<Metadata>{const {id}=await params;try{const anime=await load(id);if(!anime)return {title:'Anime bulunamadı',robots:{index:false,follow:false}};return {title:anime.title+' · Anime Takvimi',description:anime.summary.slice(0,160)||anime.title+' detayları ve izleme takibi.',alternates:{canonical:'/anime/'+id},openGraph:{title:anime.title,description:anime.summary.slice(0,160),...(anime.image?{images:[anime.image]}:{})}};}catch{return {title:'Anime Takvimi · Yeniden dene',robots:{index:false,follow:false}};}}
export default async function AnimePage({params}:Props){const {id}=await params;let anime:Anime|null;try{anime=await load(id);}catch{return <main className="at-enhancement-panel"><h1>Anime bilgisi yüklenemedi.</h1><p>Veri kaynağına ulaşılamadı. Biraz sonra yeniden deneyebilirsin.</p><Link href={'/anime/'+id}>Yeniden dene</Link> · <Link href="/">Keşfetmeye dön</Link></main>;}if(!anime)notFound();return <AnimeShell initialAnime={anime}/>;}
