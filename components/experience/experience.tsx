'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowRight,Bell,Bookmark,Check,ChevronRight,CircleCheck,Compass,Heart,Play,Plus,Search,Star,X} from 'lucide-react';
import {AnimeDetail,ProfileView} from './detail-profile';
import {ExperienceControls} from './notifications';
import {advanceEpisode,recommendations,statuses,watchStatus} from './model';
import {todayFollowed} from './reminder-logic';
import type {Anime,ExperienceSnapshot,Library,LibraryChange,WatchStatus} from './types';
import './experience.css';
import './detail-profile.css';

const emptyLibrary:Library={saved:[],reminders:[],progress:{},view:'grid',savedAnime:{},tracking:{},scores:{},favorites:[],collections:[]};
const initial:ExperienceSnapshot={ready:false,page:'discover',catalog:[],schedule:[],library:emptyLibrary,account:null,accountScope:null,loading:true,error:null,libraryLoading:false,blocked:false};
function readSnapshot():ExperienceSnapshot {
  const data=window.animeTakvimi?.getExperienceSnapshot?.();
  if(!data)return initial;
  const account=window.AnimeMembership?.getAccount?.()||null;
  const member=window.AnimeMembership?.getStatus?.();
  return {...data,ready:true,library:{...emptyLibrary,...data.library},account,loading:!!data.loading,error:data.error?'Anime verileri şu anda alınamıyor. Yeniden deneyebilirsin.':null,libraryLoading:!!member?.libraryLoading,blocked:!!member?.blocked||account?.user?.status==='suspended'};
}
function Poster({item,className=''}:{item:Anime;className?:string}) {
  const [broken,setBroken]=useState(false);
  useEffect(()=>setBroken(false),[item.image]);
  return <span className={`exp-poster ${className}`}>{item.image&&!broken?<img src={item.image} alt={item.title} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setBroken(true)}/>:<span className="exp-poster-fallback">{item.title}</span>}</span>;
}
function useBanner(item:Anime|undefined){
  const [banner,setBanner]=useState<string|null>(null);
  useEffect(()=>{let alive=true,generation=0;const load=()=>{const token=++generation;setBanner(null);if(item)window.AnimeBanners?.resolve(item.malId).then(value=>{if(alive&&token===generation)setBanner(window.AnimeBanners?.safeBanner(value,item.malId)||null);});};const changed=(event:Event)=>{if((event as CustomEvent).detail?.malId===item?.malId)load();};load();window.addEventListener('anime:bannerchange',changed);return()=>{alive=false;window.removeEventListener('anime:bannerchange',changed);};},[item?.malId]);
  return banner;
}
function ContinueCard({item,snapshot,onChange,onDetail}:{item:Anime;snapshot:ExperienceSnapshot;onChange:LibraryChange;onDetail:(i:Anime)=>void}){
  const count=snapshot.library.progress[item.id]||0;
  return <article className="exp-continue-card"><button className="exp-cover-button" onClick={()=>onDetail(item)}><Poster item={item}/></button><div><button className="exp-title-link" onClick={()=>onDetail(item)}>{item.title}</button><p>{count}{item.episodes?` / ${item.episodes}`:''} bölüm</p><div className="exp-progress" role="progressbar" aria-label={`${item.title} izleme ilerlemesi`} aria-valuenow={count} aria-valuemin={0} aria-valuemax={item.episodes||9999}><span style={{width:`${Math.min(100,item.episodes?count/item.episodes*100:0)}%`}}/></div><button className="exp-increment" disabled={snapshot.blocked||snapshot.libraryLoading||!!item.episodes&&count>=item.episodes} onClick={()=>onChange(current=>advanceEpisode(item,current))}><Plus size={14}/> Bölüm</button></div></article>;
}
export function PersonalHome({snapshot,onChange,onDetail}:{snapshot:ExperienceSnapshot;onChange:LibraryChange;onDetail:(i:Anime)=>void}){
  const [tab,setTab]=useState<WatchStatus>('watching');
  const [offset,setOffset]=useState(0);
  const saved=snapshot.library.saved.map(id=>snapshot.library.savedAnime[id]).filter(Boolean);
  const continuing=saved.filter(item=>watchStatus(item,snapshot.library)==='watching');
  const hero=continuing[0]||snapshot.catalog.find(item=>item.image)||saved[0];
  const banner=useBanner(hero);
  const count=hero?snapshot.library.progress[hero.id]||0:0;
  const suggestions=recommendations(snapshot.catalog,snapshot.library,12);
  const start=offset<suggestions.length?offset:0;
  const picks=suggestions.slice(start,start+4);
  const today=todayFollowed([...snapshot.schedule,...snapshot.catalog,...Object.values(snapshot.library.savedAnime)],[...snapshot.library.saved,...snapshot.library.reminders],new Date()).slice(0,2);
  const selected=saved.filter(item=>watchStatus(item,snapshot.library)===tab).slice(0,3);
  const name=snapshot.account?.user?.displayName;
  const statusIcons={watching:Play,planned:Bookmark,completed:CircleCheck,dropped:X};
  useEffect(()=>{if(saved.length||snapshot.library.reminders.length)window.animeTakvimi?.loadSchedule();},[snapshot.accountScope,saved.length,snapshot.library.reminders.length]);
  return <section className="exp-home" aria-label="Sana özel anime dünyası">
    <div className={'exp-cinema'+(banner?' has-banner':'')}>
      {(banner||hero?.image)&&<img className="exp-cinema-art" src={banner||hero!.image!} alt="" referrerPolicy="no-referrer" decoding="async" onError={event=>{event.currentTarget.hidden=true;}}/>}
      <div className="exp-cinema-shade"/>
      <div className="exp-hero-copy">
        <p className="exp-welcome">{name?'Hoş geldin, '+name+'.':'Yeni hikâyeler seni bekliyor.'}</p>
        <h1>Senin anime dünyan<span>.</span></h1>
        {hero?<div className="exp-hero-anime">
          <button className="exp-hero-cover" onClick={()=>onDetail(hero)} aria-label={hero.title+' detayları'}><Poster item={hero}/></button>
          <div className="exp-hero-meta"><small>{continuing.length?'KALDIĞIN YERDEN DEVAM ET':'SEZONDAN BİR HİKÂYE'}</small><h2>{hero.title}</h2><p>{continuing.length?count+(hero.episodes?' / '+hero.episodes:'')+' bölüm':hero.format+' · '+hero.studio}</p>{continuing.length>0&&<div className="exp-progress"><span style={{width:(hero.episodes?Math.min(100,count/hero.episodes*100):0)+'%'}}/></div>}</div>
          <div className="exp-hero-actions">
            <button className="exp-primary" disabled={snapshot.blocked||snapshot.libraryLoading} onClick={()=>continuing.length?onChange(current=>advanceEpisode(hero,current)):snapshot.library.saved.includes(hero.id)?window.animeTakvimi?.navigate('watchlist'):onChange(current=>({saved:[...new Set([...current.saved,hero.id])],savedAnime:{...current.savedAnime,[hero.id]:hero},tracking:{...current.tracking,[hero.id]:current.tracking[hero.id]||'planned'}}))}>{continuing.length?<Plus size={15}/>:snapshot.library.saved.includes(hero.id)?<Check size={15}/>:<Bookmark size={15}/>} {continuing.length?'Bölüm':snapshot.library.saved.includes(hero.id)?'Listemde':'Listeme ekle'}</button>
            <button className="exp-hero-detail" onClick={()=>onDetail(hero)}>Detayları gör <ArrowRight size={15}/></button>
          </div>
        </div>:<div className="exp-hero-loading" role="status">{snapshot.loading?'Sezonun hikâyeleri yükleniyor…':'Yeni hikâyeleri keşfetmek için sezon kütüphanesini aç.'}<a href="#seasons">Sezonları keşfet <ArrowRight size={16}/></a></div>}
      </div>
      {(today.length>0||snapshot.account?.authenticated)&&<aside className="exp-today"><div><h2>Bugünkü yayınların</h2><a href="#schedule">Tümünü gör <ArrowRight size={12}/></a></div>{today.length?today.map(item=><div className="exp-today-row" key={item.id}><button className="exp-today-link" onClick={()=>onDetail(item)}><Poster item={item}/><span><strong>{item.title}</strong><small>Haftalık plana göre · {item.time}</small></span></button><button className={'exp-today-bell'+(snapshot.library.reminders.includes(item.id)?' is-active':'')} aria-label={snapshot.library.reminders.includes(item.id)?'Yayın hatırlatmasını kaldır':'Yayın hatırlatmasını seç'} aria-pressed={snapshot.library.reminders.includes(item.id)} disabled={snapshot.blocked||snapshot.libraryLoading} onClick={()=>onChange(current=>({reminders:current.reminders.includes(item.id)?current.reminders.filter(id=>id!==item.id):[...current.reminders,item.id],savedAnime:{...current.savedAnime,[item.id]:item}}))}><Bell size={17}/></button></div>):<div className="exp-today-empty"><Bell size={20}/><p>Bugün için takip ettiğin bir yayın yok.</p><a href="#schedule">Yayın takvimine göz at <ArrowRight size={13}/></a></div>}</aside>}
    </div>
    <div className="exp-personal-strip">
      <div className="exp-discovery-layout">
        <div className="exp-discovery-copy">
          <div className="exp-status-tabs" role="group" aria-label="İzleme durumun">{statuses.map(status=>{const Icon=statusIcons[status.id];return <button key={status.id} aria-pressed={tab===status.id} className={tab===status.id?'active':''} onClick={()=>setTab(status.id)}><Icon size={17}/>{status.label}<span>{saved.filter(item=>watchStatus(item,snapshot.library)===status.id).length}</span></button>;})}</div>
          <div className="exp-recommendation-title"><small>{saved.length?'SANA ÖZEL ÖNERİLER':'SEZONDAN SEÇTİKLERİMİZ'}</small><h2>Bir sonraki<br/>favorin<span>.</span></h2><p>{saved.length?'Sevdiğin hikâyelerden yola çıktık.':'Listeni oluştur, sana uygun hikâyeleri birlikte bulalım.'}</p></div>
        </div>
        <div className="exp-recommendation-area"><div className="exp-recommendation-posters">{picks.length?picks.map(({item,reason})=><article key={item.id}><button className="exp-pick-cover" onClick={()=>onDetail(item)}><Poster item={item}/>{item.rating!==null&&<span className="exp-score"><Star size={12}/>{item.rating.toFixed(1)}</span>}</button><button className="exp-title-link" onClick={()=>onDetail(item)}>{item.title}</button><p>{reason?reason+' sevdiğin için':item.genres.slice(0,3).join(' · ')||item.format}</p></article>):<p className="exp-muted">{snapshot.loading?'Öneriler hazırlanıyor…':snapshot.error||'Bu sezon için henüz öneri bulunamadı.'}</p>}</div>{suggestions.length>4&&<button className="exp-recommendation-next" aria-label="Sonraki anime önerileri" onClick={()=>setOffset(start+4>=suggestions.length?0:start+4)}><ChevronRight size={19}/></button>}</div>
      </div>
      {selected.length>0&&<details className="exp-home-library"><summary>{statuses.find(status=>status.id===tab)?.label} <span>{selected.length} anime</span><ChevronRight size={14}/></summary><div className="exp-continue-row">{selected.map(item=><ContinueCard key={item.id} item={item} snapshot={snapshot} onChange={onChange} onDetail={onDetail}/>)}</div><a href="#watchlist">Listemin tamamı <ArrowRight size={14}/></a></details>}
    </div>
  </section>;
}

export function Watchlist({snapshot,onChange,onDetail}:{snapshot:ExperienceSnapshot;onChange:LibraryChange;onDetail:(i:Anime)=>void}){
  const [tab,setTab]=useState<WatchStatus|'all'>('all');
  const items=snapshot.library.saved.map(id=>snapshot.library.savedAnime[id]).filter(Boolean).filter(item=>tab==='all'||watchStatus(item,snapshot.library)===tab);
  return <section className="exp-watchlist"><header className="exp-page-heading"><small>KİŞİSEL KÜTÜPHANEN</small><h1>Her hikâyenin<br/>bir yeri var<span>.</span></h1><p>İzlediklerin, beklettiklerin, yeniden döneceklerin.</p></header><div className="exp-status-tabs" role="group" aria-label="Listeyi filtrele"><button className={tab==='all'?'active':''} aria-pressed={tab==='all'} onClick={()=>setTab('all')}>Tümü <span>{snapshot.library.saved.length}</span></button>{statuses.map(status=><button key={status.id} className={tab===status.id?'active':''} aria-pressed={tab===status.id} onClick={()=>setTab(status.id)}>{status.label}</button>)}<a href="#profile">Profilim <ArrowRight size={14}/></a></div>{snapshot.libraryLoading?<p role="status">Hesap listen yükleniyor…</p>:items.length?<div className="exp-library-grid">{items.map(item=><article key={item.id}><button className="exp-pick-cover" onClick={()=>onDetail(item)}><Poster item={item}/>{snapshot.library.favorites.includes(item.id)&&<span className="exp-favorite-badge"><Heart size={17} fill="currentColor"/></span>}</button><button className="exp-title-link" onClick={()=>onDetail(item)}>{item.title}</button><label className="exp-status-select">Durum<select disabled={snapshot.blocked} value={watchStatus(item,snapshot.library)} onChange={event=>{const value=event.target.value as WatchStatus;onChange(current=>({tracking:{...current.tracking,[item.id]:value},...(value==='completed'&&item.episodes?{progress:{...current.progress,[item.id]:item.episodes}}:{})}));}}>{statuses.map(status=><option value={status.id} key={status.id}>{status.label}</option>)}</select></label><p className="exp-muted">{snapshot.library.progress[item.id]||0}{item.episodes?` / ${item.episodes}`:''} bölüm</p><button className="exp-text-button" disabled={snapshot.blocked||!!item.episodes&&(snapshot.library.progress[item.id]||0)>=item.episodes} onClick={()=>onChange(current=>advanceEpisode(item,current))}><Plus size={14}/> Bölüm izledim</button></article>)}</div>:<div className="exp-empty"><Bookmark size={34}/><h2>Burada yeni hikâyelere yer var.</h2><p>{tab==='all'?'Keşfederken sevdiğin animeleri listene ekle.':'Bu durumda henüz bir anime yok.'}</p><a href="#discover" className="exp-primary">Anime keşfet <Compass size={16}/></a></div>}</section>;
}
function NavigationSearch(){
  const [query,setQuery]=useState('');
  const [expanded,setExpanded]=useState(false);
  const input=useRef<HTMLInputElement>(null);
  const toggle=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(!expanded)return;const frame=requestAnimationFrame(()=>input.current?.focus());return()=>cancelAnimationFrame(frame);},[expanded]);
  const close=(restoreFocus=false)=>{setExpanded(false);if(restoreFocus)toggle.current?.focus();};
  return <div className="exp-nav-search-anchor"><form className={'exp-nav-search'+(expanded?' is-open':'')} role="search" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))close();}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}}} onSubmit={event=>{event.preventDefault();if(!expanded){setExpanded(true);return;}if(!query.trim()){input.current?.focus();return;}window.animeTakvimi?.navigate('discover');const search=document.getElementById('search') as HTMLInputElement|null;if(search){search.value=query.trim();search.dispatchEvent(new Event('input',{bubbles:true}));close();requestAnimationFrame(()=>{search.scrollIntoView({block:'center',behavior:'smooth'});search.focus({preventScroll:true});});}}}>
    <button ref={toggle} type={expanded?'submit':'button'} className="exp-search-trigger" onClick={event=>{if(!expanded){event.preventDefault();setExpanded(true);}}} aria-label={expanded?'Anime ara':'Aramayı aç'} aria-expanded={expanded} aria-controls="nav-anime-search"><Search size={19}/></button>
    <input ref={input} id="nav-anime-search" type="search" value={query} tabIndex={expanded?0:-1} aria-hidden={!expanded} onChange={event=>setQuery(event.target.value)} placeholder="Anime, seri veya tür ara…" aria-label="Anime, seri veya tür ara" autoComplete="off"/>
    <button type="button" className="exp-search-close" tabIndex={expanded?0:-1} aria-hidden={!expanded} onClick={()=>close(true)} aria-label="Aramayı kapat"><X size={16}/></button>
  </form></div>;
}
export default function AnimeExperience(){
  const [snapshot,setSnapshot]=useState(initial);
  const [hash,setHash]=useState('');
  const [slots,setSlots]=useState<{home:HTMLElement;page:HTMLElement;nav:HTMLElement}|null>(null);
  const [detail,setDetail]=useState<Anime|null>(null);
  const [notice,setNotice]=useState('');
  const previousFocus=useRef<HTMLElement|null>(null);
  const previousScroll=useRef(0);
  useEffect(()=>{
    window.AnimeExperienceMounted=true;
    let frame=0;
    const sync=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{setSnapshot(readSnapshot());setHash(location.hash.slice(1));const home=document.getElementById('experience-home-slot'),page=document.getElementById('experience-page-slot'),nav=document.getElementById('experience-nav-slot');if(home&&page&&nav)setSlots(previous=>previous||{home,page,nav});});};
    const showDetail=(event:Event)=>{const item=(event as CustomEvent<Anime>).detail;if(item?.id){previousFocus.current=document.activeElement as HTMLElement;previousScroll.current=window.scrollY;setDetail(item);window.scrollTo({top:0});}};
    const dismissDetail=()=>setDetail(null);
    const profile=()=>{setDetail(null);if(window.AnimeMembership?.isAdminOpen?.())window.AnimeMembership.closeAdmin();location.hash='profile';sync();};
    const profileClick=(event:MouseEvent)=>{if((event.target as Element).closest?.('#profile-button,[data-member-action="profile"]')){event.preventDefault();profile();}};
    const events=['anime:viewrender','anime:librarychange','anime:accountchange','anime:adminchange','anime:ready','hashchange'];events.forEach(event=>window.addEventListener(event,sync));
    window.addEventListener('anime:detail',showDetail);window.addEventListener('anime:profile',profile);
    window.addEventListener('anime:navigate',dismissDetail);window.addEventListener('anime:adminchange',dismissDetail);
    document.addEventListener('click',profileClick,true);sync();
    return()=>{cancelAnimationFrame(frame);events.forEach(event=>window.removeEventListener(event,sync));window.removeEventListener('anime:detail',showDetail);window.removeEventListener('anime:profile',profile);window.removeEventListener('anime:navigate',dismissDetail);window.removeEventListener('anime:adminchange',dismissDetail);document.removeEventListener('click',profileClick,true);window.AnimeExperienceMounted=false;delete document.body.dataset.experience;};
  },[]);
  const profile=hash==='profile'||hash.startsWith('profile=');
  const admin=typeof window!=='undefined'&&window.AnimeMembership?.isAdminOpen?.();
  const page=admin?'admin':detail?'detail':profile?'profile':snapshot.page;
  useEffect(()=>{document.body.dataset.experiencePage=page;if(snapshot.ready)document.body.dataset.experience='true';},[page,snapshot.ready]);
  useEffect(()=>{setDetail(null);},[hash,snapshot.accountScope]);
  useEffect(()=>{if(!detail)return;const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]'))closeDetail();};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[detail]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4500);return()=>clearTimeout(timer);},[notice]);
  const change=useCallback<LibraryChange>((patch)=>{
    const current=readSnapshot();
    if(!current.ready||current.libraryLoading||current.blocked||current.account?.registered&&current.account.user?.id!==current.accountScope){setNotice('Hesap listen hazır olduğunda düzenleyebilirsin.');return;}
    window.animeTakvimi?.replaceLibrarySnapshot({...current.library,...(typeof patch==='function'?patch(current.library):patch)},{emit:true});
  },[]);
  const openDetail=(item:Anime)=>{window.animeTakvimi?.registerItems([item]);previousFocus.current=document.activeElement as HTMLElement;previousScroll.current=window.scrollY;setDetail(item);window.scrollTo({top:0});};
  const closeDetail=()=>{setDetail(null);requestAnimationFrame(()=>{window.scrollTo({top:previousScroll.current});if(previousFocus.current?.isConnected)previousFocus.current.focus({preventScroll:true});else document.getElementById('main')?.focus({preventScroll:true});});};
  let publicUserId:string|undefined;
  if(hash.startsWith('profile=')){try{publicUserId=decodeURIComponent(hash.slice(8));}catch{publicUserId=hash.slice(8);}}
  return <>{slots&&snapshot.ready&&<>{page==='discover'&&createPortal(<PersonalHome snapshot={snapshot} onChange={change} onDetail={openDetail}/>,slots.home)}{page==='watchlist'&&createPortal(<Watchlist snapshot={snapshot} onChange={change} onDetail={openDetail}/>,slots.page)}{page==='profile'&&createPortal(<ProfileView key={hash+snapshot.accountScope} snapshot={snapshot} publicUserId={publicUserId} onClose={()=>{location.hash='discover';}} onChange={change} onOpenDetail={openDetail}/>,slots.page)}{page==='detail'&&detail&&createPortal(<AnimeDetail key={detail.id+snapshot.accountScope} item={detail} snapshot={snapshot} onClose={closeDetail} onChange={change}/>,slots.page)}{createPortal(<><NavigationSearch/><ExperienceControls snapshot={snapshot} onChange={change}/></>,slots.nav)}</>}
    {notice&&<div className="exp-feedback" role="status">{notice}</div>}
  </>;
}
