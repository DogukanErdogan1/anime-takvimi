'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bell, Bookmark, Camera, Check, ChevronDown, CircleCheck, Clapperboard, Compass, ExternalLink, Eye, EyeOff, Heart, LayoutGrid, ListPlus, MessageCircle, Minus, Pencil, Play, Plus, Settings, Shield, Star, StarHalf, Trash2, X } from 'lucide-react';
import type { Anime, Library, LibraryChange as Change, ExperienceSnapshot as Snapshot } from './types';
import { advanceEpisode, watchStatus } from './model';
import {WatchStatusSelect} from './watch-status-select';
import {isAvatarFrame} from '../../lib/avatar-frames.mjs';
import {AvatarFrame} from './avatar-frame';
import AvatarFramePicker from './avatar-frame-picker';

const states = [
  ['watching', 'İzliyorum'], ['planned', 'İzleyeceğim'], ['completed', 'Tamamladım'], ['dropped', 'Bıraktım']
] as const;
type TrackingStatus = typeof states[number][0];
type Review = { id: string; userId: string; displayName: string; body: string; spoiler: boolean; score: number | null; createdAt: string };
type ReviewPage = {reviews: Review[]; average: number | null; total: number};
type Profile = { id: string; displayName: string; bio: string; isPublic: boolean; coverUrl?: string | null; avatarFrame?: string | null; createdAt?: string };
type Details = { trailerUrl?: string | null; relations?: {id: number; title: string; url: string}[] };
type ExperienceWindow = Window & {
  AnimeData?: { getDetails?: (id: number, options: { signal: AbortSignal }) => Promise<Details> };
  AnimeMembership?: { openSettings?: () => void; openProfile?: () => void };
};

function imageUrl(value: string | null | undefined) {
  try {
    const url = new URL(value || '');
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && ['cdn.myanimelist.net', 'myanimelist.net', 'www.myanimelist.net'].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

function malUrl(value: string | null | undefined) {
  try {
    const url = new URL(value || '');
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && ['myanimelist.net', 'www.myanimelist.net'].includes(url.hostname) && /^\/anime\/\d+(?:\/[^?#]*)?$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

function trailerUrl(value: string | null | undefined) {
  try {
    const url = new URL(value || '');
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (['www.youtube.com', 'youtube.com'].includes(url.hostname)) {
      const id = url.searchParams.get('v') || url.pathname.match(/^\/embed\/([\w-]{11})$/)?.[1];
      return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
    }
    return url.hostname === 'youtu.be' && /^\/[\w-]{11}$/.test(url.pathname) ? `https://www.youtube.com/watch?v=${url.pathname.slice(1)}` : null;
  } catch { return null; }
}

function avatarUrl(value: string | null | undefined) {
  try { const url = new URL(value || '', window.location.origin); return url.origin === window.location.origin && !url.username && !url.password && url.pathname === '/api/account/avatar' ? url.pathname + url.search : null; }
  catch { return null; }
}

function profileCoverUrl(value: string | null | undefined, publicUserId?: string) {
  try {
    const url = new URL(value || '', window.location.origin);
    const path = publicUserId ? `/api/profiles/${encodeURIComponent(publicUserId)}/cover` : '/api/profile/cover';
    return url.origin === window.location.origin && !url.username && !url.password && !url.hash && url.pathname === path && /^\?v=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(url.search) ? url.pathname + url.search : null;
  } catch { return null; }
}

function useAnimeBanner(item: Anime | undefined, enabled = true) {
  const [banner, setBanner] = useState<string | null>(null);
  useEffect(() => {
    let active = true, sequence = 0; setBanner(null);
    if (!enabled) return;
    const load = () => { const request = ++sequence; if (item?.malId && window.AnimeBanners?.resolve) window.AnimeBanners.resolve(item.malId).then(value => { if (active && request === sequence) setBanner(window.AnimeBanners?.safeBanner(value, item.malId) || null); }).catch(() => {}); };
    const changed = (event: Event) => { if ((event as CustomEvent<{malId: number}>).detail?.malId === item?.malId) load(); };
    load(); window.addEventListener('anime:bannerchange', changed);
    return () => { active = false; window.removeEventListener('anime:bannerchange', changed); };
  }, [item?.malId, enabled]);
  return banner;
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const body = await response.json().catch(() => null) as {error?: {message?: string}; message?: string} | null;
  if (!response.ok) throw new Error(body?.error?.message || body?.message || (response.status === 401 ? 'Devam etmek için giriş yapmalısın.' : 'İşlem tamamlanamadı. Tekrar deneyebilirsin.'));
  if (!body || typeof body !== 'object') throw new Error('Sunucudan geçerli bir yanıt alınamadı.');
  return body as T;
}

function initial(name: string) { return name.trim().split(/\s+/).map(part => [...part][0]).slice(0, 2).join('').toLocaleUpperCase('tr-TR') || 'A'; }
function dateLabel(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Istanbul' }); }
function userCanEdit(snapshot: Snapshot) { return snapshot.ready && !snapshot.blocked && !snapshot.libraryLoading && snapshot.account?.authenticated === true && snapshot.account.registered === true && snapshot.account.user?.status === 'active'; }
function canTrack(snapshot: Snapshot) { return snapshot.ready && !snapshot.blocked && !snapshot.libraryLoading && snapshot.account?.user?.status !== 'suspended'; }
function stored(library: Library, item: Anime): Partial<Library> {
  return { saved: [...new Set([...library.saved, item.id])], savedAnime: { ...library.savedAnime, [item.id]: item } };
}
function allItems(snapshot: Snapshot, library: Library = snapshot.library): Anime[] {
  const index = new Map<string, Anime>();
  for (const item of [...snapshot.catalog, ...snapshot.schedule, ...Object.values(library.savedAnime)]) if (item?.id) index.set(item.id, item);
  return [...new Set([...library.saved, ...Object.keys(library.tracking || {}), ...(library.favorites || []), ...(library.collections || []).flatMap(collection => collection.animeIds)])].map(id => index.get(id)).filter((item): item is Anime => Boolean(item));
}
export function AnimePoster({item,className='at-poster',showTitle=false}:{item:Anime;className?:string;showTitle?:boolean}) {
  const primary=imageUrl(item.image),key=`${item.malId}:${primary||''}`;
  const [failed,setFailed]=useState<{key:string;urls:string[]}>({key,urls:[]});
  const [cover,setCover]=useState<{key:string;url:string|null}>({key,url:null});
  const failures=failed.key===key?failed.urls:[];
  const needsFallback=!primary||failures.includes(primary);
  const alternate=cover.key===key?cover.url:null;
  const source=!needsFallback?primary:alternate&&!failures.includes(alternate)?alternate:null;
  useEffect(()=>{
    if(!needsFallback || !Number.isSafeInteger(item.malId) || item.malId<1)return;
    let active=true;
    const provider=window.AnimeBanners;
    if(provider?.resolvePoster)provider.resolvePoster(item.malId).then(value=>{
      if(active)setCover({key,url:provider.safePoster(value)});
    }).catch(()=>{});
    return()=>{active=false;};
  },[key,needsFallback,item.malId]);
  return <span className={className}>{source?<img key={source} src={source} alt={showTitle?item.title:`${item.title} afişi`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(previous=>({key,urls:[...new Set([...(previous.key===key?previous.urls:[]),source])]}))}/>:showTitle?<span className="exp-poster-fallback">{item.title}</span>:<span className="at-poster-missing"><Bookmark size={24}/><small>Afiş bulunamadı</small></span>}</span>;
}
function Poster({item,className=''}:{item:Anime;className?:string}) {
  return <AnimePoster item={item} className={`at-poster ${className}`}/>;
}

function ProfileCardArtwork({item}:{item:Anime}) {
  const target=useRef<HTMLDivElement>(null);
  const [visible,setVisible]=useState(false);
  const [failed,setFailed]=useState<string[]>([]);
  const banner=useAnimeBanner(item,visible);
  const source=[banner,imageUrl(item.image)].find(value=>value&&!failed.includes(value));
  useEffect(()=>{
    const element=target.current;
    if(!element)return;
    if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}
    },{rootMargin:'180px'});
    observer.observe(element);
    return()=>observer.disconnect();
  },[]);
  return <div ref={target} className="at-library-art" aria-hidden="true">{source&&<img key={source} src={source} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(previous=>previous.includes(source)?previous:[...previous,source])}/>}</div>;
}

type ProfileLibraryItemProps = {item:Anime;library:Library;canEdit:boolean;onChange:Change};

export function ProfileLibraryEditor({item,library,canEdit,onChange}:ProfileLibraryItemProps) {
  if(!canEdit)return null;
  const total=typeof item.episodes==='number'&&Number.isSafeInteger(item.episodes)&&item.episodes>0?item.episodes:null;
  const limit=Math.min(total||9999,9999);
  const safeCount=(value:number|undefined)=>typeof value==='number'&&Number.isFinite(value)?Math.min(limit,Math.max(0,Math.floor(value))):0;
  const count=safeCount(library.progress[item.id]);
  const favorite=library.favorites.includes(item.id);
  const setStatus=(next:TrackingStatus)=>{
    if(!canEdit||!states.some(([id])=>id===next))return;
    onChange(current=>({...stored(current,item),tracking:{...current.tracking,[item.id]:next},...(next==='completed'&&total?{progress:{...current.progress,[item.id]:limit}}:{})}));
  };
  const setProgress=(next:number,relative=false)=>{
    if(!canEdit||!Number.isFinite(next))return;
    onChange(current=>{
      const value=safeCount(relative?safeCount(current.progress[item.id])+next:next);
      return {...stored(current,item),progress:{...current.progress,[item.id]:value},tracking:{...current.tracking,[item.id]:total&&value>=total?'completed':value>0?'watching':'planned'}};
    });
  };
  return <div className="at-library-editor">
    <button type="button" className={'at-library-favorite-toggle'+(favorite?' is-active':'')} aria-label={item.title+': '+(favorite?'favorilerden çıkar':'favorilere ekle')} aria-pressed={favorite} title={favorite?'Favorilerden çıkar':'Favorilere ekle'} onClick={()=>{
      if(canEdit)onChange(current=>({...stored(current,item),favorites:current.favorites.includes(item.id)?current.favorites.filter(id=>id!==item.id):[...current.favorites,item.id]}));
    }}><Heart size={17} fill={favorite?'currentColor':'none'} aria-hidden="true"/></button>
    <details className="at-library-edit-details">
      <summary aria-label={item.title+': izleme bilgilerini düzenle'}><Pencil size={14} aria-hidden="true"/><span>Düzenle</span><ChevronDown size={14} className="at-library-edit-chevron" aria-hidden="true"/></summary>
      <div className="at-library-edit-panel">
        <div className="at-library-edit-field"><span>İzleme durumu</span><WatchStatusSelect value={watchStatus(item,library)} label={item.title+': izleme durumu'} onChange={setStatus} compact/></div>
        <div className="at-library-edit-field"><span>İzlediğin bölüm</span><span className="at-library-edit-stepper"><button type="button" disabled={count<=0} onClick={()=>setProgress(-1,true)} aria-label={item.title+': bölüm sayısını azalt'}><Minus size={14} aria-hidden="true"/></button><input type="number" min={0} max={limit} step={1} inputMode="numeric" value={count} onChange={event=>setProgress(Number(event.target.value))} aria-label={item.title+': izlediğin bölüm sayısı'}/><button type="button" disabled={count>=limit} onClick={()=>setProgress(1,true)} aria-label={item.title+': bölüm sayısını artır'}><Plus size={14} aria-hidden="true"/></button></span></div>
        <small className="at-library-edit-note">Değişiklikler otomatik kaydedilir.</small>
      </div>
    </details>
  </div>;
}

export function ProfileClassicAnimeCard({item,library,canEdit,onChange,onOpenDetail}:ProfileLibraryItemProps&{onOpenDetail:(item:Anime)=>void}) {
  return <article className="at-profile-classic-item" aria-label={item.title}>
    <button type="button" className="at-profile-anime" onClick={()=>onOpenDetail(item)}><Poster item={item}/><span className="at-profile-anime-name">{item.title}</span><small>{library.progress[item.id]||0} / {item.episodes||'?'} bölüm{library.scores?.[item.id]?' · ★ '+library.scores[item.id]:''}</small></button>
    <ProfileLibraryEditor item={item} library={library} canEdit={canEdit} onChange={onChange}/>
  </article>;
}

export function ProfileAnimeCard({item,library,canEdit,onChange,onOpenDetail}:{item:Anime;library:Library;canEdit:boolean;onChange:Change;onOpenDetail:(item:Anime)=>void}) {
  const total=typeof item.episodes==='number'&&Number.isSafeInteger(item.episodes)&&item.episodes>0?item.episodes:null;
  const safeCount=(value:number|undefined)=>typeof value==='number'&&Number.isFinite(value)?Math.min(9999,Math.max(0,Math.floor(value))):0;
  const count=total?Math.min(total,safeCount(library.progress[item.id])):safeCount(library.progress[item.id]);
  const status=watchStatus(item,library);
  const label=states.find(([id])=>id===status)![1];
  const complete=status==='completed'||Boolean(total&&count>=total);
  const finished=complete||count>=9999;
  const actionLabel=complete?'Tamamlandı':finished?'Bölüm sınırına ulaşıldı':'Bir bölüm izledim';
  const advance=()=>{
    if(!canEdit||finished)return;
    onChange(current=>{
      const currentCount=safeCount(current.progress[item.id]);
      if(watchStatus(item,current)==='completed'||currentCount>=(total||9999))return {};
      return advanceEpisode({...item,episodes:total},{...current,progress:{...current.progress,[item.id]:currentCount}});
    });
  };
  return <article className={'at-library-card is-'+status} aria-label={item.title}>
    <ProfileCardArtwork item={item}/>
    <button type="button" className="at-library-poster" aria-label={item.title+' detaylarını aç'} onClick={()=>onOpenDetail(item)}><Poster item={item}/></button>
    <div className="at-library-copy">
      <h3><button type="button" onClick={()=>onOpenDetail(item)}>{item.title}</button></h3>
      <div className="at-library-meta"><span className="at-library-status"><i aria-hidden="true"/>{label}</span><span className="at-library-episodes">{count} / {total||'?'} bölüm</span>{library.scores?.[item.id]>0&&<span className="at-library-score"><Star size={12} aria-hidden="true"/>{library.scores[item.id]}</span>}{library.favorites?.includes(item.id)&&<Heart className="at-library-favorite" size={14} aria-label="Favori"/>}</div>
      {total?<div className="at-library-progress" role="progressbar" aria-label={item.title+' izleme ilerlemesi'} aria-valuenow={count} aria-valuemin={0} aria-valuemax={total} aria-valuetext={`${count} / ${total} bölüm`}><span style={{width:`${count/total*100}%`}}/></div>:<div className="at-library-progress is-unknown" aria-hidden="true"><span/></div>}
    </div>
    {canEdit&&<button type="button" className="at-library-advance" onClick={advance} disabled={finished} aria-label={item.title+': '+actionLabel.toLocaleLowerCase('tr-TR')} title={actionLabel}>{complete?<Check size={20}/>:finished?<Minus size={20}/>:<Plus size={22}/>}</button>}
    <ProfileLibraryEditor item={item} library={library} canEdit={canEdit} onChange={onChange}/>
  </article>;
}

export function ProfileInsights({items,library,isOwner,onStatusSelect}:{items:Anime[];library:Library;isOwner:boolean;onStatusSelect:(status:TrackingStatus)=>void}) {
  const statusCounts=states.map(([id,label])=>{
    const series=items.filter(item=>watchStatus(item,library)===id);
    return {id,label,count:series.length,art:series.map(item=>imageUrl(item.image)).find(Boolean)};
  });
  const total=items.length;
  const completed=statusCounts.find(status=>status.id==='completed')!.count;
  const completion=total?Math.round(completed/total*100):0;
  const episodes=Object.values(library.progress).reduce((sum,count)=>sum+Math.max(0,Number(count)||0),0);
  const watched=items.filter(item=>(library.progress[item.id]||0)>0||watchStatus(item,library)==='completed');
  const genreCounts=new Map<string,number>();
  for(const item of watched)for(const genre of new Set(item.genres||[]))genreCounts.set(genre,(genreCounts.get(genre)||0)+1);
  const genres=[...genreCounts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'tr')).slice(0,4);
  const statusIcons={watching:Play,planned:Bookmark,completed:CircleCheck,dropped:X};
  return <div className="at-profile-insights at-insights-opening">
    <section className="at-opening-panel at-insight-status" aria-labelledby="at-status-heading">
      <header className="at-opening-heading"><div><small>AÇILIŞ SEKANSI</small><h2 id="at-status-heading">{isOwner?'İzleme durumların':'İzleme durumları'}</h2></div><Play size={19} aria-hidden="true"/></header>
      <div className="at-sequence-statuses" role="group" aria-label={total?statusCounts.map(status=>`${status.label}: ${status.count} anime`).join(', '):'Listede henüz anime yok'}>
        {statusCounts.map(status=>{
          const Icon=statusIcons[status.id];
          return <button key={status.id} type="button" data-status={status.id} className={'at-sequence-status'+(!status.count?' is-empty':'')} onClick={()=>onStatusSelect(status.id)} aria-label={`${status.label}: ${status.count} anime. Listede göster`}>
            <span className="at-sequence-band" aria-hidden="true"><span className="at-sequence-art" style={status.art?{backgroundImage:`url(${JSON.stringify(status.art)})`}:undefined}/></span>
            <strong className="at-sequence-count">{status.count}</strong>
            <span className="at-sequence-label"><Icon size={13} aria-hidden="true"/>{status.label}</span>
            <ArrowRight className="at-sequence-arrow" size={18} aria-hidden="true"/>
          </button>;
        })}
      </div>
      <footer className="at-opening-summary"><span>Toplam <strong>{total}</strong> anime <i aria-hidden="true">·</i> <strong>{episodes}</strong> bölüm izlendi</span><span><strong>%{completion}</strong> tamamlandı</span></footer>
    </section>
    <section className="at-opening-panel at-insight-genres" aria-labelledby="at-genres-heading">
      <header className="at-opening-heading"><div><small>{isOwner?'HİKÂYELERİNİN RENKLERİ':'HİKÂYELERİN RENKLERİ'}</small><h2 id="at-genres-heading">{isOwner?'Tür dağılımın':'Tür dağılımı'}</h2></div><Compass size={21} aria-hidden="true"/></header>
      {genres.length?<><ol className="at-sequence-genres">{genres.map(([genre,count],index)=>{
        const share=Math.round(count/watched.length*100);
        const art=watched.filter(item=>item.genres?.includes(genre)).map(item=>imageUrl(item.image)).find(Boolean);
        return <li key={genre}>
          <span className="at-sequence-rank" aria-hidden="true">{String(index+1).padStart(2,'0')}</span>
          <strong className={'at-sequence-genre'+(art?' has-art':'')} style={art?{backgroundImage:`linear-gradient(110deg,var(--sequence-type-tint),transparent 50%,var(--sequence-type-tint)),url(${JSON.stringify(art)})`}:undefined}>{genre}</strong>
          <span className="at-sequence-genre-total"><span><b>{count}</b> seri</span><small>%{share}</small></span>
        </li>;
      })}</ol><p className="at-sequence-explanation">{watched.length} izlenen seri üzerinden · Bir seri birden fazla tür içerebilir.</p></>:<div className="at-sequence-empty"><Compass size={29}/><strong>Hikâyelerin zevkini anlatsın.</strong><p>İzlemeye başladığın serilerle tür dağılımın burada oluşacak.</p></div>}
    </section>
  </div>;
}

export function AnimeDetail({ item, snapshot, onClose, onChange }: {item: Anime; snapshot: Snapshot; onClose: () => void; onChange: Change}) {
  const [details, setDetails] = useState<Details | null>(null);
  const [detailError, setDetailError] = useState('');
  const [detailVersion, retryDetail] = useState(0);
  const canEdit = canTrack(snapshot);
  const library = snapshot.library;
  const total = typeof item.episodes === 'number' && item.episodes > 0 ? item.episodes : null;
  const progress = Math.min(total || 9999, Math.max(0, library.progress[item.id] || 0));
  const status = library.saved.includes(item.id) || library.tracking[item.id] || progress > 0 ? watchStatus(item, library) : '';
  const favorite = library.favorites?.includes(item.id) || false;
  const reminder = library.reminders.includes(item.id);
  const score = library.scores?.[item.id] || 0;
  const poster = imageUrl(item.image);
  const banner = useAnimeBanner(item);
  const mal = malUrl(item.malUrl);
  useEffect(() => {
    const controller = new AbortController();
    setDetails(null); setDetailError('');
    const getter = (window as ExperienceWindow).AnimeData?.getDetails;
    if (!getter || !item.malId) { setDetailError('Ek bilgiler şu anda alınamıyor.'); return () => controller.abort(); }
    getter(item.malId, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setDetails(value); }).catch(error => { if (!controller.signal.aborted) setDetailError(error instanceof Error ? error.message : 'Ek bilgiler alınamadı.'); });
    return () => controller.abort();
  }, [item.malId, detailVersion]);
  const setStatus = (next: TrackingStatus) => {
    onChange(current => {
      const patch: Partial<Library> = { ...stored(current, item), tracking: { ...current.tracking, [item.id]: next } };
      if (next === 'completed' && total) patch.progress = { ...current.progress, [item.id]: total };
      return patch;
    });
  };
  const setProgress = (next: number, relative = false) => {
    if (!Number.isFinite(next)) return;
    onChange(current => {
      const value = Math.min(total || 9999, Math.max(0, Math.floor(relative ? (current.progress[item.id] || 0) + next : next)));
      return { ...stored(current, item), progress: { ...current.progress, [item.id]: value }, tracking: { ...current.tracking, [item.id]: total && value === total ? 'completed' : value > 0 ? 'watching' : 'planned' } };
    });
  };
  const trailer = trailerUrl(details?.trailerUrl);
  const relations = details?.relations?.filter(relation => malUrl(relation.url)) || [];
  return <article className="at-detail" aria-labelledby="experience-detail-title">
    <div className="at-detail-top"><button className="at-text-button" onClick={onClose}><ArrowLeft size={15}/> Geri dön</button>{mal && <a href={mal} target="_blank" rel="noopener noreferrer">MyAnimeList <ExternalLink size={12}/></a>}</div>
    <div className="at-detail-overview" id="at-detail-overview">
      <aside className="at-detail-cover"><Poster item={item} className="at-detail-poster"/></aside>
      <div className="at-detail-intro">
        <div className="at-detail-title-row"><h1 id="experience-detail-title">{item.title}</h1><div className="at-status-compact"><WatchStatusSelect value={status} disabled={!canEdit} onChange={setStatus} compact/></div></div>
        {item.original && item.original !== item.title && <p className="at-original">{item.original}</p>}
        <div className="at-detail-genres">{item.genres?.join(' · ')}</div>
        <div className="at-detail-meta"><span>{item.studio || 'Stüdyo bilgisi yok'}</span>{item.year && <span>{item.year}</span>}<span>{total ? total+' bölüm' : 'Bölüm sayısı belirsiz'}</span>{item.duration && <span>{item.duration} dk</span>}{item.rating && <span className="at-mal-score"><Star size={12} fill="currentColor"/>{Number(item.rating).toFixed(2)} MAL</span>}</div>
        <p className="at-intro-summary" tabIndex={0}>{item.summary || 'Bu anime için henüz bir özet bulunmuyor.'}</p>
        <section className="at-compact-tracking" id="at-detail-tracking" aria-label="Anime takibi">
          <div className="at-progress-row"><span><strong>{progress}</strong> / {total || '?'} bölüm izlendi</span><div className="at-episode-stepper"><button className="at-icon-button" disabled={!canEdit || progress<=0} onClick={()=>setProgress(-1,true)} aria-label="İzlenen bölüm sayısını azalt"><Minus size={14}/></button><label className="at-visually-hidden" htmlFor="at-detail-progress">İzlediğin bölüm</label><input id="at-detail-progress" type="number" min="0" max={total||9999} value={progress} disabled={!canEdit} onChange={event=>setProgress(Number(event.target.value))}/><button className="at-icon-button" disabled={!canEdit || total!==null&&progress>=total} onClick={()=>setProgress(1,true)} aria-label="Bir bölüm izledim"><Plus size={14}/></button></div><button disabled={!canEdit} className={'at-icon-button at-favorite '+(favorite?'is-active':'')} aria-label={favorite?'Favorilerden çıkar':'Favorilere ekle'} aria-pressed={favorite} onClick={()=>onChange(current=>({...stored(current,item),favorites:current.favorites.includes(item.id)?current.favorites.filter(id=>id!==item.id):[...current.favorites,item.id]}))}><Heart size={17} fill={favorite?'currentColor':'none'}/></button><button disabled={!canEdit} className={'at-icon-button '+(reminder?'is-active':'')} aria-label={reminder?'Yayın hatırlatmasını kapat':'Yayın hatırlatmasını aç'} aria-pressed={reminder} onClick={()=>onChange(current=>({...stored(current,item),reminders:current.reminders.includes(item.id)?current.reminders.filter(id=>id!==item.id):[...current.reminders,item.id]}))}><Bell size={17}/></button></div>
          {total && <div className="at-progress-meter" role="progressbar" aria-label="İzlenen bölümler" aria-valuenow={Math.min(progress,total)} aria-valuemin={0} aria-valuemax={total}><span style={{width:Math.min(100,progress/total*100)+'%'}}/></div>}
          {item.airing && item.broadcastLocal && item.day!=null && item.time && <p className="at-broadcast-note">{['Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'][item.day]} · {item.time} Türkiye saati · Haftalık yayın planı</p>}
        </section>
      </div>
      <aside className="at-detail-media" aria-label="Anime fragmanı">
        <div className={'at-trailer-preview'+(trailer?' is-playable':'')}>
          {(banner||poster) && <img src={banner||poster!} alt="" aria-hidden="true" referrerPolicy="no-referrer" onError={event=>{event.currentTarget.hidden=true;}}/>}
          {trailer ? <a href={trailer} target="_blank" rel="noopener noreferrer"><span><Play size={25} fill="currentColor"/></span><strong>Fragmanı izle</strong><small>YouTube'da açılır</small></a> : <div className="at-trailer-unavailable"><Play size={24}/><span>{detailError?'Fragman bilgisi alınamadı':details?'Fragman bulunmuyor':'Fragman yükleniyor…'}</span></div>}
        </div>
        {detailError ? <p className="at-detail-media-note">{detailError} <button className="at-text-button" onClick={()=>retryDetail(value=>value+1)}>Tekrar dene</button></p> : !details && <p className="at-detail-media-note" role="status">Fragman ve bağlantılı seriler yükleniyor…</p>}
      </aside>
      <section className="at-rating-block" aria-labelledby="at-rating-label"><div><h2 id="at-rating-label">Puanın</h2><div className="at-large-score"><strong>{score||'—'}</strong><span>/10</span></div></div><div className="at-rating-stars" aria-hidden="true">{Array.from({length:5},(_,index)=>score>=index*2+2?<Star key={index} size={21} fill='currentColor' className='is-filled'/>:score>=index*2+1?<StarHalf key={index} size={21} fill='currentColor' className='is-filled'/>:<Star key={index} size={21}/>)}</div><label className="at-score-edit"><span className="at-visually-hidden">Puanını seç</span><select disabled={!canEdit} value={score} onChange={event=>{const value=Number(event.target.value);onChange(current=>{const scores={...current.scores};if(value)scores[item.id]=value;else delete scores[item.id];return {...stored(current,item),scores};});}}><option value="0">Puan ver</option>{Array.from({length:10},(_,index)=>10-index).map(value=><option value={value} key={value}>{value} / 10</option>)}</select><ChevronDown size={13}/></label></section>
      <section className="at-detail-relations" aria-label="Bağlantılı seriler"><h2>Bağlantılı seriler</h2>{relations.length ? <div>{relations.map(relation=><a key={relation.id} href={malUrl(relation.url)!} target="_blank" rel="noopener noreferrer"><span>{relation.title}</span><ExternalLink size={13}/></a>)}</div> : <p>{details?'Bağlantılı seri bilgisi bulunmuyor.':detailError?'Ek bilgiler şu anda alınamıyor.':'Bağlantılı seriler yükleniyor…'}</p>}</section>
    </div>
    <div className="at-detail-bottom">
      {!snapshot.account?.authenticated && <p className="at-signin-prompt">Listen bu tarayıcıda saklanır. Cihazların arasında eşitlemek ve yorum yazmak için <a href="/giris">giriş yap</a> veya <a href="/uye-ol">üye ol</a>.</p>}
      {snapshot.libraryLoading && <p className="at-muted" role="status">Hesap listen yükleniyor…</p>}
      {snapshot.blocked && <p className="at-muted">Hesabının düzenleme yetkisi şu anda kapalı.</p>}
      <Reviews key={`${item.malId}:${snapshot.account?.user?.id || "guest"}`} item={item} snapshot={snapshot}/>
    </div>
  </article>;
}

export function Reviews({item, snapshot}: {item: Anime; snapshot: Snapshot}) {
  const [result, setResult] = useState<ReviewPage | null>(null);
  const [error, setError] = useState('');
  const [version, reload] = useState(0);
  const [body, setBody] = useState('');
  const [spoiler, setSpoiler] = useState(false);
  const [editing, setEditing] = useState<Review | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [notice, setNotice] = useState('');
  const [revealed, setRevealed] = useState<string[]>([]);
  const [hiding, setHiding] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [ownRemoved, setOwnRemoved] = useState(false);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const touched = useRef(false);
  const generation = useRef(0);
  const mutation = useRef<AbortController | null>(null);
  const moreRequest = useRef<AbortController | null>(null);
  const user = snapshot.account?.user;
  const userId = user?.id;
  const editable = userCanEdit(snapshot);
  const busy = sending || hiding !== null;
  const score = snapshot.library.scores?.[item.id] ?? editing?.score ?? null;
  const changed = !editing || body.trim() !== editing.body || spoiler !== editing.spoiler || score !== editing.score;
  const canSubmit = editable && !ownRemoved && !busy && !!item.malId && body.trim().length > 0 && changed;
  const ownAvatar = avatarUrl(user?.avatarUrl);
  const avatar = (name: string, own: boolean) => <span className="at-mini-avatar at-review-avatar" aria-hidden="true"><span>{initial(name)}</span>{own && ownAvatar && <img src={ownAvatar} alt="" onError={event => {event.currentTarget.hidden = true;}}/>}</span>;

  // A new anime/account invalidates every pending mutation as well as its draft.
  useEffect(() => {
    generation.current++;
    touched.current = false;
    setBody(''); setSpoiler(false); setEditing(null); setSendError(''); setNotice('');
    setSending(false); setHiding(null); setConfirming(null); setOwnRemoved(false); setRevealed([]);
    return () => {
      generation.current++;
      mutation.current?.abort(); mutation.current = null;
      moreRequest.current?.abort(); moreRequest.current = null;
    };
  }, [item.malId, userId]);

  useEffect(() => {
    const controller = new AbortController();
    moreRequest.current?.abort(); moreRequest.current = null;
    setResult(null); setError(''); setPage(1); setLoadingMore(false);
    if (!item.malId) { setError('Yorumlar için geçerli bir anime kimliği bulunamadı.'); return () => controller.abort(); }
    api<ReviewPage>(`/api/anime/${item.malId}/reviews?page=1&limit=20`, {signal: controller.signal}).then(value => {
      if (controller.signal.aborted) return;
      setResult(value);
      const own = value.reviews.find(review => review.userId === userId);
      if (own) {
        setEditing(own);
        if (!touched.current) { setBody(own.body); setSpoiler(own.spoiler); }
      }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Yorumlar alınamadı.'); });
    return () => controller.abort();
  }, [item.malId, userId, version]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || mutation.current) return;
    const controller = new AbortController(), token = generation.current;
    mutation.current = controller; setSending(true); setSendError(''); setNotice('');
    try {
      const value = await api<{review: Review}>(`/api/anime/${item.malId}/reviews`, {method: 'POST', signal: controller.signal, body: JSON.stringify({body: body.trim(), spoiler, score})});
      if (generation.current !== token || controller.signal.aborted) return;
      touched.current = false; setEditing(value.review); setBody(value.review.body); setSpoiler(value.review.spoiler);
      setNotice('Yorumun kaydedildi.'); setRevealed([]); reload(value => value + 1);
    } catch (reason) {
      if (generation.current === token && !controller.signal.aborted) setSendError(reason instanceof Error ? reason.message : 'Yorum gönderilemedi.');
    } finally {
      if (generation.current === token && mutation.current === controller) { mutation.current = null; setSending(false); }
    }
  };

  const beginEdit = (review: Review) => {
    if (busy || !editable || review.userId !== userId) return;
    touched.current = false; setEditing(review); setBody(review.body); setSpoiler(review.spoiler); setSendError(''); setNotice('');
    textarea.current?.focus({preventScroll: true}); textarea.current?.scrollIntoView({block: 'center'});
  };
  const resetDraft = () => {
    touched.current = false; setBody(editing?.body || ''); setSpoiler(editing?.spoiler || false); setSendError('');
  };
  const hide = async (review: Review) => {
    if (mutation.current || !editable || (review.userId !== userId && user?.role !== 'admin')) return;
    const controller = new AbortController(), token = generation.current;
    mutation.current = controller; setHiding(review.id); setSendError(''); setNotice('');
    try {
      await api(`/api/anime/${item.malId}/reviews/${encodeURIComponent(review.id)}`, {method: 'PATCH', signal: controller.signal, body: JSON.stringify({hidden: true})});
      if (generation.current !== token || controller.signal.aborted) return;
      setConfirming(null); setNotice(review.userId === userId ? '' : 'Yorum yayından kaldırıldı.');
      if (review.userId === userId) { setOwnRemoved(true); setEditing(null); setBody(''); setSpoiler(false); touched.current = false; }
      reload(value => value + 1);
    } catch (reason) {
      if (generation.current === token && !controller.signal.aborted) setSendError(reason instanceof Error ? reason.message : 'Yorum kaldırılamadı.');
    } finally {
      if (generation.current === token && mutation.current === controller) { mutation.current = null; setHiding(null); }
    }
  };
  const loadMore = async () => {
    if (!result || moreRequest.current || busy) return;
    const controller = new AbortController(), token = generation.current, nextPage = page + 1;
    moreRequest.current = controller; setLoadingMore(true); setError('');
    try {
      const value = await api<ReviewPage>(`/api/anime/${item.malId}/reviews?page=${nextPage}&limit=20`, {signal: controller.signal});
      if (generation.current !== token || controller.signal.aborted) return;
      setResult(current => current ? {...value, reviews: [...current.reviews, ...value.reviews.filter(review => !current.reviews.some(existing => existing.id === review.id))]} : value);
      setPage(nextPage);
      const own = value.reviews.find(review => review.userId === userId);
      if (own) { setEditing(own); if (!touched.current) {setBody(own.body);setSpoiler(own.spoiler);} }
    } catch (reason) {
      if (generation.current === token && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Diğer yorumlar alınamadı.');
    } finally {
      if (generation.current === token && moreRequest.current === controller) {moreRequest.current = null;setLoadingMore(false);}
    }
  };

  return <section className="at-reviews" aria-labelledby="at-reviews-title">
    <div className="at-section-line at-reviews-heading"><div><h3 id="at-reviews-title">İzleyenler ne diyor?</h3><p>Fikrini paylaş, başka bakış açılarını keşfet.</p></div>{result && <span className="at-review-count">{result.total} yorum{result.average != null && <><span aria-hidden="true">·</span><Star size={14}/><span>{Number(result.average).toFixed(1)}</span></>}</span>}</div>
    {editable && !ownRemoved && <form className="at-review-form" onSubmit={submit} aria-busy={sending}>
      <div className="at-review-composer-head">{avatar(user?.displayName || 'Sen', true)}<div><label htmlFor="at-review-body">{editing ? 'Yorumunu düzenle' : 'Senin yorumun'}</label><span>{user?.displayName}{score !== null && <> · <Star size={12}/>{score}/10</>}</span></div><span className="at-review-counter" id="at-review-counter">{body.length.toLocaleString('tr-TR')} / 2.000</span></div>
      <textarea ref={textarea} id="at-review-body" aria-describedby="at-review-hint at-review-counter" value={body} maxLength={2000} minLength={1} required rows={4} disabled={busy} placeholder="Hikâye, karakterler veya atmosfer… Senin düşüncen ne?" onChange={event => {touched.current = true;setBody(event.target.value);setSendError('');setNotice('');}}/>
      <p className="at-review-hint" id="at-review-hint">Her anime için bir yorum paylaşabilirsin; yeniden kaydettiğinde mevcut yorumun güncellenir.</p>
      <div className="at-review-submit"><label className="at-review-spoiler-check"><input type="checkbox" checked={spoiler} disabled={busy} onChange={event => {touched.current = true;setSpoiler(event.target.checked);setNotice('');}}/><span><strong>Spoiler içeriyor</strong><small>Önemli olayları okumadan önce gizle.</small></span></label><div className="at-review-submit-actions">{editing && changed && <button className="at-text-button" type="button" disabled={busy} onClick={resetDraft}>Vazgeç</button>}<button type="submit" className="at-primary-button" disabled={!canSubmit}>{sending ? 'Kaydediliyor…' : editing ? 'Yorumu güncelle' : 'Yorumu paylaş'}{sending ? <span className="at-review-spinner" aria-hidden="true"/> : <ArrowRight size={16}/>}</button></div></div>
    </form>}
    {ownRemoved && <p className="at-review-feedback" role="status">Yorumun yayından kaldırıldı. Kaldırılan yorum yeniden yayımlanamaz.</p>}
    {notice && <p className="at-review-feedback is-success" role="status"><Check size={16}/>{notice}</p>}
    {sendError && <p className="at-error at-review-feedback" role="alert">{sendError}</p>}
    {error && <p className="at-error at-review-feedback" role="alert">{error}<button type="button" className="at-text-button" onClick={() => reload(value => value + 1)}>Tekrar dene</button></p>}
    {!result && !error ? <div className="at-review-loading" role="status"><span className="at-review-spinner" aria-hidden="true"/>Yorumlar yükleniyor…</div> : result?.reviews.length === 0 ? <div className="at-review-empty"><MessageCircle size={27}/><strong>İlk düşünceyi sen paylaş.</strong><p>Henüz yorum yok. Bu anime hakkında konuşmayı başlatabilirsin.</p></div> : result && <div className="at-review-list">{result.reviews.map(review => {
      const own = review.userId === userId, hidden = review.spoiler && !revealed.includes(review.id);
      return <article className="at-review" key={review.id}>
        <header className="at-review-author">{avatar(review.displayName, own)}<div className="at-review-author-copy"><strong>{review.displayName}{own && <span className="at-review-self">Sen</span>}</strong><time dateTime={review.createdAt}>{dateLabel(review.createdAt)}</time></div><div className="at-review-actions">{review.score != null && <span className="at-user-score"><Star size={13}/>{review.score}/10</span>}{editable && own && <button type="button" className="at-icon-button" aria-label="Kendi yorumunu düzenle" title="Yorumunu düzenle" disabled={busy} onClick={() => beginEdit(review)}><Pencil size={16}/></button>}{editable && (own || user?.role === 'admin') && <button type="button" className="at-icon-button" aria-label="Bu yorumu kaldır" title="Yorumu kaldır" aria-expanded={confirming === review.id} disabled={busy} onClick={() => setConfirming(confirming === review.id ? null : review.id)}><Trash2 size={16}/></button>}</div></header>
        {review.spoiler && <span className="at-review-spoiler-tag"><Shield size={12}/>Spoiler içeriyor</span>}
        {hidden ? <button type="button" className="at-spoiler-button" onClick={() => setRevealed(current => [...current, review.id])}><Eye size={18}/><span><strong>Spoiler içeren yorum</strong><small>Okumak için dokun.</small></span></button> : <><p className="at-review-body">{review.body}</p>{review.spoiler && <button type="button" className="at-review-rehide" onClick={() => setRevealed(current => current.filter(id => id !== review.id))}><EyeOff size={14}/>Spoileri yeniden gizle</button>}</>}
        {confirming === review.id && <div className="at-review-remove-confirm" role="group" aria-label="Yorumu kaldırmayı onayla"><p>Bu yorum yayından kaldırılacak. İşlemi bu ekrandan geri alamazsın.</p><div><button type="button" className="at-text-button" disabled={busy} onClick={() => setConfirming(null)}>Vazgeç</button><button type="button" className="at-review-remove-button" disabled={busy} onClick={() => void hide(review)}>{hiding === review.id ? 'Kaldırılıyor…' : 'Yorumu kaldır'}</button></div></div>}
      </article>;
    })}</div>}
    {result && result.reviews.length < result.total && <div className="at-review-pagination"><span>{result.reviews.length} / {result.total} yorum</span><button type="button" className="at-outline-button" disabled={loadingMore || busy} onClick={() => void loadMore()}>{loadingMore ? 'Yükleniyor…' : 'Daha fazla yorum'}<ChevronDown size={16}/></button></div>}
  </section>;
}

const emptyLibrary: Library = { saved: [], reminders: [], progress: {}, view: 'grid', savedAnime: {}, tracking: {}, scores: {}, favorites: [], collections: [] };

let collectionSequence = 0;
function nextCollectionId(collections: Library['collections']) {
  let token: string;
  try {
    // Collection IDs are labels, not secrets. getRandomValues also works in
    // browsers where randomUUID is unavailable outside a secure context.
    const bytes = new Uint8Array(12);
    globalThis.crypto.getRandomValues(bytes);
    token = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    token = `${Date.now().toString(36)}-${(++collectionSequence).toString(36)}-${Math.floor(Math.random() * 0x100000000).toString(36)}`;
  }
  const occupied = new Set(collections.map(collection => collection.id));
  let id = `list-${token}`;
  while (occupied.has(id)) id = `list-${token}-${(++collectionSequence).toString(36)}`;
  return id;
}

export function ProfileView({ snapshot, publicUserId, onClose, onChange, onOpenDetail }: {snapshot: Snapshot; publicUserId?: string; onClose: () => void; onChange: Change; onOpenDetail: (item: Anime) => void}) {
  const isOwner = !publicUserId;
  const member = snapshot.account?.authenticated && snapshot.account.registered && snapshot.account.user;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [publicLibrary, setPublicLibrary] = useState<Library | null>(null);
  const [error, setError] = useState('');
  const [version, retry] = useState(0);
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState('');
  const [isPublic, setPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState('all');
  const [collectionTitle, setCollectionTitle] = useState('');
  const [collectionError, setCollectionError] = useState('');
  const [editingCollection, setEditingCollection] = useState<string | null>(null);
  const [coverDraft, setCoverDraft] = useState<{file: File; url: string} | null>(null);
  const [coverSaving, setCoverSaving] = useState(false);
  const [coverError, setCoverError] = useState('');
  const [coverNotice, setCoverNotice] = useState('');
  const [failedCovers, setFailedCovers] = useState<string[]>([]);
  const [expandedCollection, setExpandedCollection] = useState<string | null>(null);
  const [libraryPage,setLibraryPage]=useState(1);
  const [libraryViewPreference,setLibraryViewPreference]=useState<{key:string;view:'cinema'|'classic'}>({key:'',view:'cinema'});
  const libraryViewKey=`anime-takvimi-profile-library-view-v1:${encodeURIComponent(snapshot.account?.user?.id||'guest')}`;
  const libraryView=libraryViewPreference.key===libraryViewKey?libraryViewPreference.view:'cinema';
  useEffect(()=>{
    let view:'cinema'|'classic'='cinema';
    try{if(window.localStorage.getItem(libraryViewKey)==='classic')view='classic';}catch{/* The view selector also works without storage. */}
    setLibraryViewPreference({key:libraryViewKey,view});
  },[libraryViewKey]);
  const chooseLibraryView=(view:'cinema'|'classic')=>{
    setLibraryViewPreference({key:libraryViewKey,view});
    try{window.localStorage.setItem(libraryViewKey,view);}catch{/* Keep the current selection when storage is unavailable. */}
  };
  const coverInput = useRef<HTMLInputElement>(null);
  const coverScope = `${publicUserId || 'own'}:${snapshot.account?.user?.id || 'guest'}:${snapshot.accountScope || 'guest'}`;
  const coverLifecycle = useRef({scope: coverScope, sequence: 0, alive: true, controller: null as AbortController | null});
  if (coverLifecycle.current.scope !== coverScope) {
    coverLifecycle.current.controller?.abort();
    coverLifecycle.current = {scope: coverScope, sequence: coverLifecycle.current.sequence + 1, alive: true, controller: null};
  }
  useEffect(() => {
    const lifecycle = coverLifecycle.current;
    lifecycle.alive = true;
    setCoverDraft(null); setCoverSaving(false); setCoverError(''); setCoverNotice(''); setFailedCovers([]); setLibraryPage(1);
    return () => {lifecycle.alive = false; lifecycle.sequence++; lifecycle.controller?.abort();};
  }, [coverScope]);
  useEffect(() => () => {if (coverDraft) URL.revokeObjectURL(coverDraft.url);}, [coverDraft]);
  useEffect(() => {
    const controller = new AbortController();
    setProfile(null); setPublicLibrary(null); setError(''); setEditing(false); setTab('all'); setLibraryPage(1); setEditingCollection(null); setExpandedCollection(null); setNotice(''); setSaveError(''); setCollectionError('');
    if (!snapshot.ready || (isOwner && !member)) return () => controller.abort();
    const path = isOwner ? '/api/profile' : `/api/profiles/${encodeURIComponent(publicUserId!)}`;
    api<{profile: Profile; library?: Library}>(path, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setProfile(value.profile); setBio(value.profile.bio || ''); setPublic(value.profile.isPublic === true); if (!isOwner) setPublicLibrary(value.library || emptyLibrary);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Profil yüklenemedi.'); });
    return () => controller.abort();
  }, [snapshot.ready, snapshot.account?.user?.id, publicUserId, isOwner, Boolean(member), version]);
  const library = isOwner ? snapshot.library : publicLibrary || emptyLibrary;
  const items = useMemo(() => allItems(snapshot, library), [snapshot.catalog, snapshot.schedule, library]);
  const coverItem = items.find(item => library.favorites.includes(item.id)) || items[0];
  const cover = useAnimeBanner(coverItem);
  const uploadedCover = profileCoverUrl(profile?.coverUrl, publicUserId);
  const fallbackCover = imageUrl(coverItem?.image);
  const coverPicture = [coverDraft?.url, uploadedCover, cover, fallbackCover].find(source => source && !failedCovers.includes(source)) || null;
  const avatar = isOwner && member ? avatarUrl(member.avatarUrl) : null;
  const selected = tab === 'favorites' ? items.filter(item => library.favorites?.includes(item.id)) : tab === 'all' ? items : items.filter(item => watchStatus(item, library) === tab);
  const pageSize=5;
  const pageCount=Math.max(1,Math.ceil(selected.length/pageSize));
  const currentPage=Math.min(pageCount,Math.max(1,libraryPage));
  const pageItems=selected.slice((currentPage-1)*pageSize,currentPage*pageSize);
  const pageLinks:(number|string)[]=[];
  const nearbyPages=pageCount<=7?Array.from({length:pageCount},(_,index)=>index+1):[...new Set([1,currentPage-1,currentPage,currentPage+1,pageCount])].filter(page=>page>=1&&page<=pageCount).sort((a,b)=>a-b);
  for(let index=0;index<nearbyPages.length;index++){
    const previous=nearbyPages[index-1],page=nearbyPages[index];
    if(index&&page-previous===2)pageLinks.push(previous+1);
    else if(index&&page-previous>2)pageLinks.push(`gap-${page}`);
    pageLinks.push(page);
  }
  useEffect(()=>{if(libraryPage!==currentPage)setLibraryPage(currentPage);},[libraryPage,currentPage]);
  const chooseLibraryPage=(page:number)=>{
    setLibraryPage(Math.min(pageCount,Math.max(1,page)));
    if(typeof document!=='undefined')document.getElementById('at-profile-library')?.scrollIntoView({block:'start'});
  };
  const completed = items.filter(item => watchStatus(item, library) === 'completed').length;
  const watching = items.filter(item => watchStatus(item, library) === 'watching').length;
  const episodes = Object.values(library.progress).reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0);
  const editable = isOwner && userCanEdit(snapshot);
  const frameAccount = useRef(coverScope);
  frameAccount.current = coverScope;
  const saveFrame = async (frameId: string, signal: AbortSignal) => {
    if (!editable || !profile || !member || profile.id !== member.id || !isAvatarFrame(frameId)) throw new Error('Çerçeve seçmek için hesabına giriş yapmalısın.');
    const scope = coverScope, profileId = profile.id;
    const value = await api<{avatarFrame: string}>('/api/profile/frame', {method: 'PUT', body: JSON.stringify({frameId}), signal});
    if (signal.aborted || frameAccount.current !== scope) throw new DOMException('İşlem iptal edildi.', 'AbortError');
    if (!isAvatarFrame(value.avatarFrame) || value.avatarFrame !== frameId) throw new Error('Çerçeven için geçerli bir sunucu yanıtı alınamadı. Tekrar deneyebilirsin.');
    setProfile(current => current && current.id === profileId ? {...current, avatarFrame: value.avatarFrame} : current);
    setNotice(value.avatarFrame === 'none' ? 'Profil çerçeven kaldırıldı.' : 'Profil çerçeven kaydedildi.');
    window.dispatchEvent(new CustomEvent('anime:avatarframechange', {detail: {userId: profileId, frameId: value.avatarFrame}}));
    return value.avatarFrame;
  };
  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault(); if (saving) return;
    setSaving(true); setSaveError(''); setNotice('');
    try { const value = await api<{profile: Profile}>('/api/profile', {method: 'PUT', body: JSON.stringify({bio: bio.trim(), isPublic})}); setProfile(current => ({...value.profile, coverUrl: current ? current.coverUrl : value.profile.coverUrl, avatarFrame: current ? current.avatarFrame : value.profile.avatarFrame})); setEditing(false); setNotice('Profilin kaydedildi.'); }
    catch (reason) { setSaveError(reason instanceof Error ? reason.message : 'Profil kaydedilemedi.'); }
    finally { setSaving(false); }
  };
  const selectCover = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!editable || coverSaving || !file) return;
    setCoverError(''); setCoverNotice(''); setCoverDraft(null);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {setCoverError('PNG, JPEG veya WebP bir kapak görseli seç.'); return;}
    if (!file.size || file.size > 2 * 1024 * 1024) {setCoverError('Kapak görseli boş olmamalı ve en fazla 2 MiB olmalı.'); return;}
    try {setCoverDraft({file, url: URL.createObjectURL(file)});}
    catch {setCoverError('Görselin önizlemesi hazırlanamadı. Başka bir dosya seçebilirsin.');}
  };
  const mutateCover = async (remove = false) => {
    if (!editable || coverSaving || coverLifecycle.current.controller || (!remove && !coverDraft) || (remove && !uploadedCover)) return;
    const lifecycle = coverLifecycle.current, sequence = ++lifecycle.sequence, profileId = profile?.id;
    const controller = new AbortController(); lifecycle.controller = controller;
    const current = () => lifecycle.alive && coverLifecycle.current === lifecycle && lifecycle.sequence === sequence && !controller.signal.aborted;
    setCoverSaving(true); setCoverError(''); setCoverNotice('');
    try {
      const value = await api<{coverUrl: string | null}>('/api/profile/cover', remove ? {method: 'DELETE', signal: controller.signal} : {method: 'POST', body: coverDraft!.file, headers: {'Content-Type': coverDraft!.file.type}, signal: controller.signal});
      if (!current()) return;
      const result = remove && value.coverUrl === null ? null : profileCoverUrl(value.coverUrl);
      if ((!remove && !result) || (remove && value.coverUrl !== null)) throw new Error('Kapak görseli için geçerli bir sunucu yanıtı alınamadı. Tekrar deneyebilirsin.');
      setProfile(previous => previous && previous.id === profileId ? {...previous, coverUrl: result} : previous);
      setCoverDraft(null); setFailedCovers([]);
      setCoverNotice(remove ? 'Yüklediğin kapak kaldırıldı. Otomatik görsel kullanılacak.' : 'Kapak görselin kaydedildi.');
    } catch (reason) {if (current()) setCoverError(reason instanceof Error ? reason.message : 'Kapak görseli kaydedilemedi. Tekrar deneyebilirsin.');}
    finally {if (current()) {lifecycle.controller = null; setCoverSaving(false);}}
  };
  const coverImageFailed = (source: string) => {
    setFailedCovers(previous => previous.includes(source) ? previous : [...previous, source]);
    if (source === coverDraft?.url) {setCoverDraft(null); setCoverError('Seçilen görsel görüntülenemedi. Başka bir dosya seç.');}
    else if (source === uploadedCover && isOwner) setCoverError('Yüklenen kapak görüntülenemedi. Otomatik görsel gösteriliyor.');
  };
  const createCollection = (event: React.FormEvent) => {
    event.preventDefault();
    const title = collectionTitle.trim();
    if (!editable || !title) return;
    setCollectionError('');
    try {
      let createdId: string | null = null;
      onChange(current => {
        if (current.collections.length >= 30) throw new Error('En fazla 30 koleksiyon oluşturabilirsin.');
        if (Array.from(title).length > 60 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(title)) throw new Error('Koleksiyon adı 1–60 geçerli karakterden oluşmalı.');
        createdId = nextCollectionId(current.collections);
        return {collections: [...current.collections, {id: createdId, title, animeIds: []}]};
      });
      if (!createdId) { setCollectionError('Hesap listen henüz hazır değil. Biraz sonra tekrar deneyebilirsin.'); return; }
      setCollectionTitle(''); setExpandedCollection(null); setEditingCollection(createdId);
    } catch (reason) { setCollectionError(reason instanceof Error ? reason.message : 'Koleksiyon oluşturulamadı. Tekrar deneyebilirsin.'); }
  };
  const toggleCollection = (collectionId: string, animeId: string) => onChange(current => ({collections: current.collections.map(collection => collection.id === collectionId ? {...collection, animeIds: collection.animeIds.includes(animeId) ? collection.animeIds.filter(id => id !== animeId) : [...collection.animeIds, animeId]} : collection)}));
  if (snapshot.ready && isOwner && !member) return <section className="at-profile at-profile-guest"><div className="at-overline">SANA AİT BİR ALAN</div><h1>Anime yolculuğun burada başlasın.</h1><p>İzlediğin bölümleri hatırla, favorilerini sakla ve kendi koleksiyonlarını oluştur.</p><a className="at-primary-button" href="/giris">Giriş yap<ArrowRight size={17}/></a><a className="at-text-button" href="/uye-ol">Yeni hesap oluştur</a><button className="at-text-button" onClick={onClose}>Keşfetmeye dön</button></section>;
  const favorites = items.filter(item=>library.favorites.includes(item.id));
  const jumpToLibrary = (next='all') => {setTab(next);setLibraryPage(1);document.getElementById('at-profile-library')?.scrollIntoView({block:'start'});};
  return <section className="at-profile"><button className="at-profile-back at-text-button" onClick={onClose}><ArrowLeft size={14}/> Keşfetmeye dön</button>
    {error ? <section className="at-profile-error"><Shield size={30}/><h1>Profile erişilemiyor</h1><p role="alert">{error}</p><button className="at-primary-button" onClick={()=>retry(value=>value+1)}>Tekrar dene</button></section> : !profile ? <p className="at-profile-loading" role="status">Profil yükleniyor…</p> : <>
      <header className="at-profile-header">
        <div className={'at-profile-cover-strip'+(coverPicture && coverPicture!==fallbackCover?' has-cover':'')+(uploadedCover && coverPicture===uploadedCover?' has-uploaded-cover':'')+(coverDraft?' has-preview':'')} aria-busy={coverSaving}>{coverPicture && <img key={coverPicture} src={coverPicture} alt="" aria-hidden="true" referrerPolicy="no-referrer" onError={()=>coverImageFailed(coverPicture)}/>}{editable && <div className="at-cover-actions"><input ref={coverInput} id="at-profile-cover-file" aria-label="Profil kapak görseli seç" type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={coverSaving} onChange={selectCover}/><button type="button" disabled={coverSaving} className="at-cover-upload" title="PNG, JPEG veya WebP · En fazla 2 MiB" onClick={()=>coverInput.current?.click()}><Camera size={15}/>{uploadedCover?'Kapağı değiştir':'Kapak görseli yükle'}</button>{uploadedCover && !coverDraft && <button type="button" disabled={coverSaving} className="at-cover-remove" onClick={()=>void mutateCover(true)} aria-label="Yüklenen kapağı kaldır ve otomatik görsele dön"><Trash2 size={14}/><span>Kaldır</span></button>}</div>}</div>
        <div className="at-profile-identity-row"><div className="at-profile-avatar" aria-hidden="true">{avatar && <img src={avatar} alt="" onError={event=>{event.currentTarget.hidden=true;}}/>}<span>{initial(profile.displayName)}</span><AvatarFrame frameId={profile.avatarFrame}/></div>
          <div className="at-profile-identity"><h1>{profile.displayName}</h1><span className="at-profile-visibility"><Shield size={12}/>{profile.isPublic?'Herkese açık profil':'Sadece sana özel'}<i>·</i>{episodes} bölüm izlendi</span>{profile.bio && <p>{profile.bio}</p>}</div>
          <section className="at-profile-inline-stats" aria-label="İzleme istatistikleri"><div><strong>{completed}</strong><span>tamamlandı</span></div><div><strong>{watching}</strong><span>izleniyor</span></div><div><strong>{favorites.length}</strong><span>favori</span></div></section>
          {editable && <div className="at-profile-actions"><AvatarFramePicker key={coverScope} frameId={profile.avatarFrame} userId={profile.id} accountScope={coverScope} displayName={profile.displayName} avatar={avatar} onSave={saveFrame}/><button className="at-outline-button" onClick={()=>{setEditing(!editing);setBio(profile.bio||'');setPublic(profile.isPublic);setSaveError('');}}>Profili düzenle</button><button className="at-icon-button" title="Hesap ayarları" aria-label="Hesap ayarlarını aç" onClick={()=>(window as ExperienceWindow).AnimeMembership?.openSettings?.()}><Settings size={17}/></button></div>}
        </div>
      </header>
      {coverDraft && editable && <div className="at-cover-preview-panel"><div><strong>Kapak önizlemesi</strong><span>{coverDraft.file.name}</span><small>Görselin kapak alanında yukarıdaki gibi görünecek.</small></div><div className="at-cover-preview-buttons"><button type="button" className="at-text-button" disabled={coverSaving} onClick={()=>{setCoverDraft(null);setCoverError('');setCoverNotice('');}}>Vazgeç</button><button type="button" className="at-primary-button" disabled={coverSaving} onClick={()=>void mutateCover()}>{coverSaving?'Yükleniyor…':'Kapağı kaydet'}<Check size={14}/></button></div></div>}
      {coverError && <p className="at-error at-cover-feedback" role="alert">{coverError}</p>}
      {coverNotice && <p className="at-success at-cover-feedback" role="status">{coverNotice}</p>}
      {notice && <p className="at-success" role="status">{notice}</p>}
      {editing && <form className="at-profile-edit" onSubmit={saveProfile}><label className="at-field" htmlFor="at-profile-bio">Kendinden bahset<textarea id="at-profile-bio" value={bio} maxLength={500} rows={3} onChange={event=>setBio(event.target.value)} placeholder="Sevdiğin hikâyeler, favori türlerin…"/></label><label className="at-check-label"><input type="checkbox" checked={isPublic} onChange={event=>setPublic(event.target.checked)}/> Profilimi ve anime listelerimi herkese aç</label><p className="at-muted">Açtığında adın, biyografin, listelerin ve izleme istatistiklerin profil bağlantısından görülebilir.</p>{saveError && <p className="at-error" role="alert">{saveError}</p>}<div className="at-edit-actions"><button type="button" className="at-text-button" onClick={()=>setEditing(false)}>Vazgeç</button><button className="at-primary-button" disabled={saving}>{saving?'Kaydediliyor…':'Değişiklikleri kaydet'}<Check size={15}/></button></div></form>}
      {isOwner && profile.isPublic && <div className="at-public-link"><span>Profil bağlantın</span><a href={'/#profile='+encodeURIComponent(profile.id)}>{typeof window!=='undefined'?window.location.origin:''}/#profile={profile.id}<ExternalLink size={12}/></a></div>}
      <section className="at-profile-favorites"><div className="at-section-line"><h2>{isOwner?'Vazgeçilmezlerim':'Favoriler'}</h2><button className="at-text-button" onClick={()=>jumpToLibrary('favorites')}>Tümünü gör <ArrowRight size={13}/></button></div>{favorites.length ? <div className="at-favorites-ribbon">{favorites.slice(0,7).map(item=><button className="at-profile-anime" key={item.id} onClick={()=>onOpenDetail(item)}><Poster item={item}/><span className="at-profile-anime-name">{item.title}</span></button>)}</div> : <p className="at-empty-note">{isOwner?'Kalbine dokunan hikâyeleri favorilerine ekle.':'Bu profilde henüz favori anime bulunmuyor.'}</p>}</section>
      <ProfileInsights items={items} library={library} isOwner={isOwner} onStatusSelect={jumpToLibrary}/>
      <section className="at-collections at-collections-cinematic" aria-labelledby="at-collections-heading">
        <header className="at-collections-intro"><small>{isOwner?'SANA AİT HİKÂYELER':'BİR ARAYA GELEN HİKÂYELER'}</small><h2 id="at-collections-heading">{isOwner?'Koleksiyonlarım':'Koleksiyonlar'}</h2><p>{isOwner?'Sevdiğin serileri kendi hikâyende bir araya getir.':'Her seçkide başka bir hikâye keşfet.'}</p></header>
        {editable && <form className="at-collection-create" onSubmit={createCollection}><label className="at-visually-hidden" htmlFor="at-new-collection">Yeni koleksiyon adı</label><input id="at-new-collection" placeholder="Yeni koleksiyon adı" value={collectionTitle} maxLength={60} onChange={event=>setCollectionTitle(event.target.value)}/><button type="submit" className="at-collection-submit" disabled={!collectionTitle.trim()||library.collections.length>=30}><Plus size={17}/>Oluştur</button></form>}
        {collectionError && <p className="at-error" role="alert">{collectionError}</p>}
        <div className="at-collection-list">{library.collections.map((collection,index)=>{
          const collectionItems=collection.animeIds.map(id=>items.find(item=>item.id===id)).filter((item):item is Anime=>Boolean(item));
          const artwork=collectionItems.filter(item=>imageUrl(item.image)).slice(0,3);
          const isEditing=editingCollection===collection.id&&editable;
          const isExpanded=expandedCollection===collection.id;
          const panelId=`at-collection-content-${collection.id}`;
          return <article className="at-collection at-collection-feature" key={collection.id}>
            <div className={'at-collection-cover'+(!artwork.length?' has-no-art':'')}>
              <div className="at-collection-montage" aria-hidden="true">{artwork.map(item=><div className="at-collection-scene" key={item.id}><Poster item={item}/></div>)}</div>
              <div className="at-collection-cover-copy"><small>KOLEKSİYON {String(index+1).padStart(2,'0')}</small><h3><span>{collection.title}</span></h3><div className="at-collection-caption"><strong>{collection.animeIds.length} anime</strong><p>{isOwner?'Sana ait bir seçki':'Özel bir seçki'}</p></div></div>
              {!collection.animeIds.length&&<span className="at-collection-cover-empty"><ListPlus size={38}/><span>Yeni hikâyelere yer aç.</span></span>}
            </div>
            <footer className="at-collection-toolbar">
              {editable&&<div className="at-collection-manage"><button type="button" className="at-collection-edit" aria-label={collection.title+(isEditing?' koleksiyonunu düzenlemeyi bitir':' koleksiyonunu düzenle')} aria-expanded={isEditing} aria-controls={panelId} onClick={()=>{setExpandedCollection(null);setEditingCollection(isEditing?null:collection.id);}}>{isEditing?<Check size={17}/>:<Pencil size={17}/>}<span>{isEditing?'Bitti':'Düzenle'}</span></button><button type="button" className="at-collection-delete" aria-label={collection.title+' koleksiyonunu sil'} onClick={()=>{onChange(current=>({collections:current.collections.filter(value=>value.id!==collection.id)}));if(isEditing)setEditingCollection(null);if(isExpanded)setExpandedCollection(null);}}><Trash2 size={17}/></button></div>}
              <button type="button" className="at-collection-open" aria-label={collection.title+(isExpanded?' koleksiyonunu kapat':' koleksiyonunu aç')} aria-expanded={isExpanded} aria-controls={panelId} onClick={()=>{setEditingCollection(null);setExpandedCollection(isExpanded?null:collection.id);}}><span>{isExpanded?'Koleksiyonu kapat':'Koleksiyonu aç'}</span>{isExpanded?<ChevronDown size={19}/>:<ArrowRight size={19}/>}</button>
            </footer>
            <div id={panelId} className="at-collection-content" hidden={!isEditing&&!isExpanded}>
              {isEditing?<><p className="at-collection-content-label">Bu seçkide hangi animeler olsun?</p><div className="at-collection-choices">{items.length?items.map(item=><label key={item.id} className="at-check-label"><input type="checkbox" checked={collection.animeIds.includes(item.id)} onChange={()=>toggleCollection(collection.id,item.id)}/>{item.title}</label>):<p className="at-muted">Önce listene anime ekle.</p>}</div></>:isExpanded?(collectionItems.length?<div className="at-collection-anime-grid">{collectionItems.map(item=><button type="button" className="at-profile-anime" key={item.id} aria-label={item.title+' detaylarını aç'} onClick={()=>onOpenDetail(item)}><Poster item={item}/><span className="at-profile-anime-name">{item.title}</span></button>)}</div>:<p className="at-muted">{collection.animeIds.length?'Bu koleksiyondaki anime bilgileri şu anda görüntülenemiyor.':'Henüz anime eklenmedi.'}</p>):null}
            </div>
          </article>;
        })}</div>
        {!library.collections.length && <p className="at-empty-note">{isOwner?'Bir sonraki maratonun için kendi seçkini oluştur.':'Henüz bir koleksiyon oluşturulmamış.'}</p>}
      </section>
      <section className="at-profile-library" id="at-profile-library">
        <div className="at-section-line at-library-heading"><div className="at-library-heading-copy"><h2>{isOwner?'Anime listem':'Anime listesi'}</h2><span>{items.length} anime</span></div><div className="at-library-view-toggle" role="group" aria-label="Liste görünümü"><button type="button" aria-pressed={libraryView==='classic'} title="Eski afiş tasarımı" onClick={()=>chooseLibraryView('classic')}><LayoutGrid size={15}/><span>Klasik</span></button><button type="button" aria-pressed={libraryView==='cinema'} title="Yeni sinematik tasarım" onClick={()=>chooseLibraryView('cinema')}><Clapperboard size={15}/><span>Sinematik</span></button></div></div>
        <div className="at-profile-tabs" role="group" aria-label="İzleme listesi filtresi">{[['all','Tümü'],...states,['favorites','Favoriler']].map(([value,label])=><button type="button" key={value} className={tab===value?'is-active':''} onClick={()=>{setTab(value);setLibraryPage(1);}} aria-pressed={tab===value}>{label}{value==='favorites'&&<Heart size={12}/>}</button>)}</div>
        {selected.length?<>
          {libraryView==='cinema'?<div className="at-library-cinema" id="at-library-page-items">{pageItems.map(item=><ProfileAnimeCard key={item.id} item={item} library={library} canEdit={editable} onChange={onChange} onOpenDetail={onOpenDetail}/>)}</div>:<div className="at-profile-anime-grid at-library-classic" id="at-library-page-items">{pageItems.map(item=><ProfileClassicAnimeCard key={item.id} item={item} library={library} canEdit={editable} onChange={onChange} onOpenDetail={onOpenDetail}/>)}</div>}
          <footer className="at-library-page-footer"><p role="status" aria-live="polite">{(currentPage-1)*pageSize+1}–{Math.min(currentPage*pageSize,selected.length)} / {selected.length} anime{pageCount>1&&<span> · Sayfa {currentPage} / {pageCount}</span>}</p>{pageCount>1&&<nav className="at-library-pagination" aria-label="Anime listesi sayfaları"><button type="button" aria-label="Önceki sayfa" aria-controls="at-library-page-items" disabled={currentPage===1} onClick={()=>chooseLibraryPage(currentPage-1)}><ArrowLeft size={15}/></button>{pageLinks.map(page=>typeof page==='number'?<button type="button" key={page} aria-label={`${page}. sayfa`} aria-current={page===currentPage?'page':undefined} aria-controls="at-library-page-items" onClick={()=>chooseLibraryPage(page)}>{page}</button>:<span key={page} aria-hidden="true">…</span>)}<button type="button" aria-label="Sonraki sayfa" aria-controls="at-library-page-items" disabled={currentPage===pageCount} onClick={()=>chooseLibraryPage(currentPage+1)}><ArrowRight size={15}/></button></nav>}</footer>
        </>:<div className="at-profile-empty"><Bookmark size={28}/><h3>Bu rafta henüz bir hikâye yok.</h3><p>{isOwner?'Keşfettiğin animeleri listene ekleyerek başlayabilirsin.':'Bu kategoride henüz anime bulunmuyor.'}</p>{isOwner&&<button type="button" className="at-text-button" onClick={onClose}>Animeleri keşfet <ArrowRight size={15}/></button>}</div>}
      </section>
    </>}
  </section>;
}
