'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bell, Bookmark, Camera, Check, ChevronDown, ExternalLink, Eye, Heart, ListPlus, Minus, Play, Plus, Settings, Shield, Star, StarHalf, Trash2, X } from 'lucide-react';
import type { Anime, Library, LibraryChange as Change, ExperienceSnapshot as Snapshot } from './types';
import { watchStatus } from './model';

const states = [
  ['watching', 'İzliyorum'], ['planned', 'İzleyeceğim'], ['completed', 'Tamamladım'], ['dropped', 'Bıraktım']
] as const;
type TrackingStatus = typeof states[number][0];
type Review = { id: string; userId: string; displayName: string; body: string; spoiler: boolean; score: number | null; createdAt: string };
type Profile = { id: string; displayName: string; bio: string; isPublic: boolean; coverUrl?: string | null; createdAt?: string };
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

function useAnimeBanner(item: Anime | undefined) {
  const [banner, setBanner] = useState<string | null>(null);
  useEffect(() => {
    let active = true, sequence = 0; setBanner(null);
    const load = () => { const request = ++sequence; if (item?.malId && window.AnimeBanners?.resolve) window.AnimeBanners.resolve(item.malId).then(value => { if (active && request === sequence) setBanner(window.AnimeBanners?.safeBanner(value, item.malId) || null); }).catch(() => {}); };
    const changed = (event: Event) => { if ((event as CustomEvent<{malId: number}>).detail?.malId === item?.malId) load(); };
    load(); window.addEventListener('anime:bannerchange', changed);
    return () => { active = false; window.removeEventListener('anime:bannerchange', changed); };
  }, [item?.malId]);
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
function Poster({ item, className = '' }: {item: Anime; className?: string}) {
  const source = imageUrl(item.image);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  return <span className={`at-poster ${className}`}>{source && !failed ? <img src={source} alt={`${item.title} afişi`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/> : <span className="at-poster-missing"><Bookmark size={24}/><small>Afiş bulunamadı</small></span>}</span>;
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
        <div className="at-detail-title-row"><h1 id="experience-detail-title">{item.title}</h1><label className="at-status-compact"><span className="at-visually-hidden">İzleme durumu</span><span className="at-select-wrap"><select value={status} disabled={!canEdit} onChange={event => setStatus(event.target.value as TrackingStatus)}><option value="" disabled>Listene ekle</option>{states.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><ChevronDown size={13}/></span></label></div>
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
    <nav className="at-detail-jump" aria-label="Anime sayfası bölümleri"><button className="is-active" onClick={()=>document.getElementById("at-detail-overview")?.scrollIntoView({block:"start"})}>Genel bakış</button><button onClick={()=>document.getElementById("at-detail-tracking")?.scrollIntoView({block:"start"})}>Bölüm takibi</button><button onClick={()=>document.getElementById("at-reviews-title")?.scrollIntoView({block:"start"})}>Yorumlar</button></nav>
    <div className="at-detail-bottom">
      {!snapshot.account?.authenticated && <p className="at-signin-prompt">Listen bu tarayıcıda saklanır. Cihazların arasında eşitlemek ve yorum yazmak için <a href="/giris">giriş yap</a> veya <a href="/uye-ol">üye ol</a>.</p>}
      {snapshot.libraryLoading && <p className="at-muted" role="status">Hesap listen yükleniyor…</p>}
      {snapshot.blocked && <p className="at-muted">Hesabının düzenleme yetkisi şu anda kapalı.</p>}
      <Reviews item={item} snapshot={snapshot}/>
    </div>
  </article>;
}

function Reviews({item, snapshot}: {item: Anime; snapshot: Snapshot}) {
  const [result, setResult] = useState<{reviews: Review[]; average: number | null; total: number} | null>(null);
  const [error, setError] = useState('');
  const [version, reload] = useState(0);
  const [body, setBody] = useState('');
  const [spoiler, setSpoiler] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [revealed, setRevealed] = useState<string[]>([]);
  const [hiding, setHiding] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setError(''); setBody(''); setSpoiler(false); setSendError(''); setRevealed([]);
    if (!item.malId) { setError('Yorumlar için geçerli bir anime kimliği bulunamadı.'); return () => controller.abort(); }
    api<{reviews: Review[]; average: number | null; total: number}>(`/api/anime/${item.malId}/reviews`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setResult(value); }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Yorumlar alınamadı.'); });
    return () => controller.abort();
  }, [item.malId, version]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (sending || !body.trim() || !userCanEdit(snapshot)) return;
    setSending(true); setSendError('');
    try {
      await api(`/api/anime/${item.malId}/reviews`, { method: 'POST', body: JSON.stringify({ body: body.trim(), spoiler, score: snapshot.library.scores?.[item.id] || null }) });
      setBody(''); setSpoiler(false); reload(value => value + 1);
    } catch (reason) { setSendError(reason instanceof Error ? reason.message : 'Yorum gönderilemedi.'); }
    finally { setSending(false); }
  };
  const hide = async (review: Review) => {
    setHiding(review.id); setSendError('');
    try {
      await api(`/api/anime/${item.malId}/reviews/${encodeURIComponent(review.id)}`, { method: 'PATCH', body: JSON.stringify({hidden: true}) });
      setResult(current => current ? {...current, reviews: current.reviews.filter(value => value.id !== review.id), total: Math.max(0, current.total - 1)} : null);
      reload(value => value + 1);
    } catch (reason) { setSendError(reason instanceof Error ? reason.message : 'Yorum kaldırılamadı.'); }
    finally { setHiding(null); }
  };
  return <section className="at-reviews" aria-labelledby="at-reviews-title"><div className="at-section-line"><h3 id="at-reviews-title">İzleyenler ne diyor?</h3>{result && <span className="at-review-count">{result.total} yorum{result.average != null && <> · <Star size={13}/> {Number(result.average).toFixed(1)}</>}</span>}</div>{userCanEdit(snapshot) && <form className="at-review-form" onSubmit={submit}><label htmlFor="at-review-body">Senin yorumun</label><textarea id="at-review-body" value={body} maxLength={2000} minLength={1} required rows={3} placeholder="Bu hikâye sende ne bıraktı?" onChange={event => setBody(event.target.value)}/><div className="at-review-submit"><label className="at-check-label"><input type="checkbox" checked={spoiler} onChange={event => setSpoiler(event.target.checked)}/> Spoiler içeriyor</label><button className="at-primary-button" disabled={sending || body.trim().length < 1}>{sending ? 'Gönderiliyor…' : 'Yorumu paylaş'}<ArrowRight size={15}/></button></div></form>}{sendError && <p className="at-error" role="alert">{sendError}</p>}{error ? <p className="at-error" role="alert">{error} <button className="at-text-button" onClick={() => reload(value => value + 1)}>Tekrar dene</button></p> : !result ? <p className="at-muted" role="status">Yorumlar yükleniyor…</p> : result.reviews.length === 0 ? <p className="at-empty-note">Henüz yorum yok. İlk düşünceyi sen paylaş.</p> : <div className="at-review-list">{result.reviews.map(review => { const hidden = review.spoiler && !revealed.includes(review.id); return <article className="at-review" key={review.id}><div className="at-review-author"><span className="at-mini-avatar" aria-hidden="true">{initial(review.displayName)}</span><div><strong>{review.displayName}</strong><time dateTime={review.createdAt}>{dateLabel(review.createdAt)}</time></div>{review.score != null && <span className="at-user-score"><Star size={13}/>{review.score}/10</span>}{(snapshot.account?.user?.id === review.userId || snapshot.account?.user?.role === 'admin') && <button className="at-icon-button" aria-label="Bu yorumu kaldır" title="Yorumu kaldır" disabled={hiding === review.id} onClick={() => hide(review)}><Trash2 size={15}/></button>}</div>{hidden ? <button className="at-spoiler-button" onClick={() => setRevealed(current => [...current, review.id])}><Eye size={17}/> Spoiler içeren yorumu göster</button> : <p>{review.body}</p>}</article>; })}</div>}</section>;
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
    setCoverDraft(null); setCoverSaving(false); setCoverError(''); setCoverNotice(''); setFailedCovers([]);
    return () => {lifecycle.alive = false; lifecycle.sequence++; lifecycle.controller?.abort();};
  }, [coverScope]);
  useEffect(() => () => {if (coverDraft) URL.revokeObjectURL(coverDraft.url);}, [coverDraft]);
  useEffect(() => {
    const controller = new AbortController();
    setProfile(null); setPublicLibrary(null); setError(''); setEditing(false); setTab('all'); setEditingCollection(null); setNotice(''); setSaveError(''); setCollectionError('');
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
  const completed = items.filter(item => watchStatus(item, library) === 'completed').length;
  const watching = items.filter(item => watchStatus(item, library) === 'watching').length;
  const episodes = Object.values(library.progress).reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0);
  const genreCounts = new Map<string, number>();
  items.filter(item => (library.progress[item.id] || 0) > 0 || library.tracking?.[item.id] === 'completed').forEach(item => item.genres?.forEach(genre => genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1)));
  const genres = [...genreCounts].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const maxGenre = genres[0]?.[1] || 1;
  const editable = isOwner && userCanEdit(snapshot);
  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault(); if (saving) return;
    setSaving(true); setSaveError(''); setNotice('');
    try { const value = await api<{profile: Profile}>('/api/profile', {method: 'PUT', body: JSON.stringify({bio: bio.trim(), isPublic})}); setProfile(current => ({...value.profile, coverUrl: current ? current.coverUrl : value.profile.coverUrl})); setEditing(false); setNotice('Profilin kaydedildi.'); }
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
      setCollectionTitle(''); setEditingCollection(createdId);
    } catch (reason) { setCollectionError(reason instanceof Error ? reason.message : 'Koleksiyon oluşturulamadı. Tekrar deneyebilirsin.'); }
  };
  const toggleCollection = (collectionId: string, animeId: string) => onChange(current => ({collections: current.collections.map(collection => collection.id === collectionId ? {...collection, animeIds: collection.animeIds.includes(animeId) ? collection.animeIds.filter(id => id !== animeId) : [...collection.animeIds, animeId]} : collection)}));
  if (snapshot.ready && isOwner && !member) return <section className="at-profile at-profile-guest"><div className="at-overline">SANA AİT BİR ALAN</div><h1>Anime yolculuğun burada başlasın.</h1><p>İzlediğin bölümleri hatırla, favorilerini sakla ve kendi koleksiyonlarını oluştur.</p><a className="at-primary-button" href="/giris">Giriş yap<ArrowRight size={17}/></a><a className="at-text-button" href="/uye-ol">Yeni hesap oluştur</a><button className="at-text-button" onClick={onClose}>Keşfetmeye dön</button></section>;
  const favorites = items.filter(item=>library.favorites.includes(item.id));
  const jumpToLibrary = (next='all') => {setTab(next);document.getElementById('at-profile-library')?.scrollIntoView({block:'start'});};
  return <section className="at-profile"><button className="at-profile-back at-text-button" onClick={onClose}><ArrowLeft size={14}/> Keşfetmeye dön</button>
    {error ? <section className="at-profile-error"><Shield size={30}/><h1>Profile erişilemiyor</h1><p role="alert">{error}</p><button className="at-primary-button" onClick={()=>retry(value=>value+1)}>Tekrar dene</button></section> : !profile ? <p className="at-profile-loading" role="status">Profil yükleniyor…</p> : <>
      <header className="at-profile-header">
        <div className={'at-profile-cover-strip'+(coverPicture && coverPicture!==fallbackCover?' has-cover':'')+(uploadedCover && coverPicture===uploadedCover?' has-uploaded-cover':'')+(coverDraft?' has-preview':'')} aria-busy={coverSaving}>{coverPicture && <img key={coverPicture} src={coverPicture} alt="" aria-hidden="true" referrerPolicy="no-referrer" onError={()=>coverImageFailed(coverPicture)}/>}{editable && <div className="at-cover-actions"><input ref={coverInput} id="at-profile-cover-file" aria-label="Profil kapak görseli seç" type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={coverSaving} onChange={selectCover}/><button type="button" disabled={coverSaving} className="at-cover-upload" title="PNG, JPEG veya WebP · En fazla 2 MiB" onClick={()=>coverInput.current?.click()}><Camera size={15}/>{uploadedCover?'Kapağı değiştir':'Kapak görseli yükle'}</button>{uploadedCover && !coverDraft && <button type="button" disabled={coverSaving} className="at-cover-remove" onClick={()=>void mutateCover(true)} aria-label="Yüklenen kapağı kaldır ve otomatik görsele dön"><Trash2 size={14}/><span>Kaldır</span></button>}</div>}</div>
        <div className="at-profile-identity-row"><div className="at-profile-avatar" aria-hidden="true">{avatar && <img src={avatar} alt="" onError={event=>{event.currentTarget.hidden=true;}}/>}<span>{initial(profile.displayName)}</span></div>
          <div className="at-profile-identity"><h1>{profile.displayName}</h1><span className="at-profile-visibility"><Shield size={12}/>{profile.isPublic?'Herkese açık profil':'Sadece sana özel'}<i>·</i>{episodes} bölüm izlendi</span>{profile.bio && <p>{profile.bio}</p>}</div>
          <section className="at-profile-inline-stats" aria-label="İzleme istatistikleri"><div><strong>{completed}</strong><span>tamamlandı</span></div><div><strong>{watching}</strong><span>izleniyor</span></div><div><strong>{favorites.length}</strong><span>favori</span></div></section>
          {editable && <div className="at-profile-actions"><button className="at-outline-button" onClick={()=>{setEditing(!editing);setBio(profile.bio||'');setPublic(profile.isPublic);setSaveError('');}}>Profili düzenle</button><button className="at-icon-button" title="Hesap ayarları" aria-label="Hesap ayarlarını aç" onClick={()=>(window as ExperienceWindow).AnimeMembership?.openSettings?.()}><Settings size={17}/></button></div>}
        </div>
      </header>
      {coverDraft && editable && <div className="at-cover-preview-panel"><div><strong>Kapak önizlemesi</strong><span>{coverDraft.file.name}</span><small>Görselin kapak alanında yukarıdaki gibi görünecek.</small></div><div className="at-cover-preview-buttons"><button type="button" className="at-text-button" disabled={coverSaving} onClick={()=>{setCoverDraft(null);setCoverError('');setCoverNotice('');}}>Vazgeç</button><button type="button" className="at-primary-button" disabled={coverSaving} onClick={()=>void mutateCover()}>{coverSaving?'Yükleniyor…':'Kapağı kaydet'}<Check size={14}/></button></div></div>}
      {coverError && <p className="at-error at-cover-feedback" role="alert">{coverError}</p>}
      {coverNotice && <p className="at-success at-cover-feedback" role="status">{coverNotice}</p>}
      {notice && <p className="at-success" role="status">{notice}</p>}
      {editing && <form className="at-profile-edit" onSubmit={saveProfile}><label className="at-field" htmlFor="at-profile-bio">Kendinden bahset<textarea id="at-profile-bio" value={bio} maxLength={500} rows={3} onChange={event=>setBio(event.target.value)} placeholder="Sevdiğin hikâyeler, favori türlerin…"/></label><label className="at-check-label"><input type="checkbox" checked={isPublic} onChange={event=>setPublic(event.target.checked)}/> Profilimi ve anime listelerimi herkese aç</label><p className="at-muted">Açtığında adın, biyografin, listelerin ve izleme istatistiklerin profil bağlantısından görülebilir.</p>{saveError && <p className="at-error" role="alert">{saveError}</p>}<div className="at-edit-actions"><button type="button" className="at-text-button" onClick={()=>setEditing(false)}>Vazgeç</button><button className="at-primary-button" disabled={saving}>{saving?'Kaydediliyor…':'Değişiklikleri kaydet'}<Check size={15}/></button></div></form>}
      {isOwner && profile.isPublic && <div className="at-public-link"><span>Profil bağlantın</span><a href={'/#profile='+encodeURIComponent(profile.id)}>{typeof window!=='undefined'?window.location.origin:''}/#profile={profile.id}<ExternalLink size={12}/></a></div>}
      <section className="at-profile-favorites"><div className="at-section-line"><h2>{isOwner?'Vazgeçilmezlerim':'Favoriler'}</h2><button className="at-text-button" onClick={()=>jumpToLibrary('favorites')}>Tümünü gör <ArrowRight size={13}/></button></div>{favorites.length ? <div className="at-favorites-ribbon">{favorites.slice(0,7).map(item=><button className="at-profile-anime" key={item.id} onClick={()=>onOpenDetail(item)}><Poster item={item}/><span className="at-profile-anime-name">{item.title}</span></button>)}</div> : <p className="at-empty-note">{isOwner?'Kalbine dokunan hikâyeleri favorilerine ekle.':'Bu profilde henüz favori anime bulunmuyor.'}</p>}</section>
      <div className="at-profile-insights"><section className="at-status-section"><div className="at-section-line"><h2>{isOwner?'İzleme durumların':'İzleme durumları'}</h2><span>{items.length} anime</span></div><div className="at-status-bars">{states.map(([value,label])=>{const count=items.filter(item=>watchStatus(item,library)===value).length;return <div key={value}><span>{label}<small>{count}</small></span><i><b style={{width:(items.length?count/items.length*100:0)+'%'}}/></i></div>;})}</div><p>{episodes} bölüm · {completed} tamamlanan hikâye</p></section>
        <section className="at-genre-section"><div className="at-section-line"><h2>{isOwner?'Tür dağılımın':'Tür dağılımı'}</h2><span>İzlenen seriler</span></div>{genres.length ? <div className="at-genre-bars">{genres.map(([genre,count])=><div key={genre}><span>{genre}<small>{count} seri</small></span><i><b style={{width:count/maxGenre*100+'%'}}/></i></div>)}</div> : <p className="at-muted">İzlediğin animeler arttıkça tür dağılımın burada görünecek.</p>}</section>
      </div>
      <section className="at-collections"><div className="at-section-line"><h2>{isOwner?'Koleksiyonlarım':'Koleksiyonlar'}</h2><ListPlus size={18}/></div>
        {editable && <form className="at-collection-create" onSubmit={createCollection}><label className="at-visually-hidden" htmlFor="at-new-collection">Yeni koleksiyon adı</label><input id="at-new-collection" placeholder="Yeni koleksiyon adı" value={collectionTitle} maxLength={60} onChange={event=>setCollectionTitle(event.target.value)}/><button type="submit" className="at-outline-button" disabled={!collectionTitle.trim()||library.collections.length>=30}><Plus size={14}/>Oluştur</button></form>}
        {collectionError && <p className="at-error" role="alert">{collectionError}</p>}<div className="at-collection-list">{library.collections.map(collection=>{const collectionItems=collection.animeIds.map(id=>items.find(item=>item.id===id)).filter((item):item is Anime=>Boolean(item));return <article className="at-collection" key={collection.id}><div className="at-collection-heading"><div><h3>{collection.title}</h3><span>{collection.animeIds.length} anime · {isOwner?'Sana ait bir seçki':'Özel bir seçki'}</span></div>{editable && <><button className="at-text-button" onClick={()=>setEditingCollection(editingCollection===collection.id?null:collection.id)}>{editingCollection===collection.id?'Bitti':'Düzenle'}</button><button className="at-icon-button" aria-label={collection.title+' koleksiyonunu sil'} onClick={()=>onChange(current=>({collections:current.collections.filter(value=>value.id!==collection.id)}))}><Trash2 size={14}/></button></>}</div>{editingCollection===collection.id && editable ? <div className="at-collection-choices">{items.length ? items.map(item=><label key={item.id} className="at-check-label"><input type="checkbox" checked={collection.animeIds.includes(item.id)} onChange={()=>toggleCollection(collection.id,item.id)}/>{item.title}</label>) : <p className="at-muted">Önce listene anime ekle.</p>}</div> : collectionItems.length ? <div className="at-collection-posters">{collectionItems.slice(0,8).map(item=><button key={item.id} title={item.title} aria-label={item.title+' detaylarını aç'} onClick={()=>onOpenDetail(item)}><Poster item={item}/></button>)}{collectionItems.length>8 && <span>+{collectionItems.length-8}</span>}</div> : <p className="at-muted">Henüz anime eklenmedi.</p>}</article>;})}</div>
        {!library.collections.length && <p className="at-empty-note">{isOwner?'Bir sonraki maratonun için kendi seçkini oluştur.':'Henüz bir koleksiyon oluşturulmamış.'}</p>}
      </section>
      <section className="at-profile-library" id="at-profile-library"><div className="at-section-line"><h2>{isOwner?'Anime listem':'Anime listesi'}</h2><span>{items.length} anime</span></div><div className="at-profile-tabs" role="group" aria-label="İzleme listesi filtresi">{[['all','Tümü'],...states,['favorites','Favoriler']].map(([value,label])=><button key={value} className={tab===value?'is-active':''} onClick={()=>setTab(value)} aria-pressed={tab===value}>{label}{value==='favorites' && <Heart size={12}/>}</button>)}</div>{selected.length ? <div className="at-profile-anime-grid">{selected.map(item=><button className="at-profile-anime" key={item.id} onClick={()=>onOpenDetail(item)}><Poster item={item}/><span className="at-profile-anime-name">{item.title}</span><small>{library.progress[item.id]||0} / {item.episodes||'?'} bölüm{library.scores?.[item.id]?' · ★ '+library.scores[item.id]:''}</small></button>)}</div> : <div className="at-profile-empty"><Bookmark size={28}/><h3>Bu rafta henüz bir hikâye yok.</h3><p>{isOwner?'Keşfettiğin animeleri listene ekleyerek başlayabilirsin.':'Bu kategoride henüz anime bulunmuyor.'}</p>{isOwner && <button className="at-text-button" onClick={onClose}>Animeleri keşfet <ArrowRight size={15}/></button>}</div>}</section>
    </>}
  </section>;
}
