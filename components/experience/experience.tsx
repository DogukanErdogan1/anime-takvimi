'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowRight,Bell,Bookmark,Check,ChevronRight,Compass,Heart,Plus,Search,Star,X} from 'lucide-react';
import {AnimeDetail,ProfileView,ProfileLibraryEditor,AnimePoster} from './detail-profile';
import {ExperienceControls} from './notifications';
import CatalogFilters from './catalog-filters';
import ThemePicker from './theme-picker';
import AccountAvatarFrames from './account-avatar-frames';
import {advanceEpisode,recommendations,searchSuggestions,statuses,watchStatus} from './model';
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
  return <AnimePoster item={item} className={`exp-poster ${className}`} showTitle/>;
}
function useBanner(item:Anime|undefined){
  const [banner,setBanner]=useState<string|null>(null);
  useEffect(()=>{let alive=true,generation=0;const load=()=>{const token=++generation;setBanner(null);if(item)window.AnimeBanners?.resolve(item.malId).then(value=>{if(alive&&token===generation)setBanner(window.AnimeBanners?.safeBanner(value,item.malId)||null);});};const changed=(event:Event)=>{if((event as CustomEvent).detail?.malId===item?.malId)load();};load();window.addEventListener('anime:bannerchange',changed);return()=>{alive=false;window.removeEventListener('anime:bannerchange',changed);};},[item?.malId]);
  return banner;
}
export function PersonalHome({snapshot,onChange,onDetail}:{snapshot:ExperienceSnapshot;onChange:LibraryChange;onDetail:(i:Anime)=>void}){
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
  const name=snapshot.account?.user?.displayName;
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
          <div className="exp-recommendation-title"><small>{saved.length?'SANA ÖZEL ÖNERİLER':'SEZONDAN SEÇTİKLERİMİZ'}</small><h2>Bir sonraki<br/>favorin<span>.</span></h2><p>{saved.length?'Sevdiğin hikâyelerden yola çıktık.':'Listeni oluştur, sana uygun hikâyeleri birlikte bulalım.'}</p></div>
        </div>
        <div className="exp-recommendation-area"><div className="exp-recommendation-posters">{picks.length?picks.map(({item,reason})=><article key={item.id}><button className="exp-pick-cover" onClick={()=>onDetail(item)}><Poster item={item}/>{item.rating!==null&&<span className="exp-score"><Star size={12}/>{item.rating.toFixed(1)}</span>}</button><button className="exp-title-link" onClick={()=>onDetail(item)}>{item.title}</button><p>{reason?reason+' sevdiğin için':item.genres.slice(0,3).join(' · ')||item.format}</p></article>):<p className="exp-muted">{snapshot.loading?'Öneriler hazırlanıyor…':snapshot.error||'Bu sezon için henüz öneri bulunamadı.'}</p>}</div>{suggestions.length>4&&<button className="exp-recommendation-next" aria-label="Sonraki anime önerileri" onClick={()=>setOffset(start+4>=suggestions.length?0:start+4)}><ChevronRight size={19}/></button>}</div>
      </div>
    </div>
  </section>;
}

export function Watchlist({snapshot,onChange,onDetail}:{snapshot:ExperienceSnapshot;onChange:LibraryChange;onDetail:(i:Anime)=>void}){
  const [tab,setTab]=useState<WatchStatus|'all'|'favorites'>('all');
  const library=snapshot.library;
  const saved=library.saved.map(id=>library.savedAnime[id]).filter(Boolean);
  const favorites=saved.filter(item=>library.favorites.includes(item.id));
  const items=saved.filter(item=>tab==='all'||(tab==='favorites'?library.favorites.includes(item.id):watchStatus(item,library)===tab));
  const editable=snapshot.ready&&!snapshot.blocked&&!snapshot.libraryLoading&&snapshot.account?.user?.status!=='suspended';
  return <section className="exp-watchlist">
    <header className="exp-page-heading"><small>KİŞİSEL KÜTÜPHANEN</small><h1>Her hikâyenin<br/>bir yeri var<span>.</span></h1><p>İzlediklerin, beklettiklerin, yeniden döneceklerin.</p></header>
    <div className="exp-status-tabs" role="group" aria-label="Listeyi filtrele">
      <button type="button" className={tab==='all'?'active':''} aria-pressed={tab==='all'} onClick={()=>setTab('all')}>Tümü <span>{saved.length}</span></button>
      {statuses.map(status=><button type="button" key={status.id} className={tab===status.id?'active':''} aria-pressed={tab===status.id} onClick={()=>setTab(status.id)}>{status.label}</button>)}
      <button type="button" className={tab==='favorites'?'active':''} aria-pressed={tab==='favorites'} onClick={()=>setTab('favorites')}><Heart size={13} aria-hidden="true"/> Favoriler <span>{favorites.length}</span></button>
      <a href="#profile">Profilim <ArrowRight size={14}/></a>
    </div>
    {snapshot.libraryLoading?<p role="status">Hesap listen yükleniyor…</p>:items.length?<div className="exp-library-grid">
      {items.map(item=><article key={item.id} aria-label={item.title}>
        <button type="button" className="exp-pick-cover" onClick={()=>onDetail(item)}><Poster item={item}/>{library.favorites.includes(item.id)&&<span className="exp-favorite-badge" aria-label="Favori"><Heart size={17} fill="currentColor" aria-hidden="true"/></span>}</button>
        <button type="button" className="exp-title-link" onClick={()=>onDetail(item)}>{item.title}</button>
        <div className="exp-library-summary"><span>{statuses.find(status=>status.id===watchStatus(item,library))!.label}</span><small>{library.progress[item.id]||0} / {item.episodes||'?'} bölüm</small></div>
        <ProfileLibraryEditor item={item} library={library} canEdit={editable} onChange={onChange}/>
      </article>)}
    </div>:<div className="exp-empty"><Bookmark size={34}/><h2>{tab==='favorites'?'Favorilerin burada birikecek.':'Burada yeni hikâyelere yer var.'}</h2><p>{tab==='all'?'Keşfederken sevdiğin animeleri listene ekle.':tab==='favorites'?'Listendeki kalbe dokunarak sevdiğin animeleri buraya ekleyebilirsin.':'Bu durumda henüz bir anime yok.'}</p><a href="#discover" className="exp-primary">Anime keşfet <Compass size={16}/></a></div>}
  </section>;
}
function NavigationSearch({rail,snapshot,onDetail}:{rail:HTMLElement|null;snapshot:ExperienceSnapshot;onDetail:(item:Anime)=>void}){
  const [query,setQuery]=useState('');
  const [expanded,setExpanded]=useState(false);
  const [activeId,setActiveId]=useState<string|null>(null);
  const [remote,setRemote]=useState<{query:string;items:Anime[];status:'idle'|'loading'|'ready'|'error'}>({query:'',items:[],status:'idle'});
  const input=useRef<HTMLInputElement>(null);
  const toggle=useRef<HTMLButtonElement>(null);
  const list=useRef<HTMLUListElement>(null);
  const term=query.trim().slice(0,100);
  const local=searchSuggestions(term,[...snapshot.catalog,...snapshot.schedule,...Object.values(snapshot.library.savedAnime)]);
  const results=Array.from(new Map([...local,...(remote.query===term?remote.items:[])].map(item=>[item.id,item])).values()).slice(0,8);
  const activeIndex=results.findIndex(item=>item.id===activeId);
  const loading=term.length>=2&&(remote.query!==term||remote.status==='loading'||remote.status==='idle');
  const failed=remote.query===term&&remote.status==='error';
  useEffect(()=>{if(!expanded)return;const frame=requestAnimationFrame(()=>input.current?.focus());return()=>cancelAnimationFrame(frame);},[expanded]);
  useEffect(()=>{window.dispatchEvent(new Event('anime:navlayout'));},[expanded,term,results.length,remote.status]);
  useEffect(()=>{
    const viewport=list.current,option=viewport?.querySelector<HTMLElement>('[aria-selected="true"]');
    if(activeIndex<0||!viewport||!option)return;
    const top=option.offsetTop,bottom=top+option.offsetHeight;
    if(top<viewport.scrollTop)viewport.scrollTop=top;
    else if(bottom>viewport.scrollTop+viewport.clientHeight)viewport.scrollTop=bottom-viewport.clientHeight;
  },[activeId,activeIndex]);
  useEffect(()=>{
    if(!expanded||term.length<2){setRemote({query:term,items:[],status:'idle'});return;}
    let alive=true;const controller=new AbortController();
    setRemote({query:term,items:[],status:'loading'});
    const timer=setTimeout(async()=>{
      try{
        if(!window.AnimeData?.searchAnime)throw new Error('Search unavailable');
        const response=await window.AnimeData.searchAnime(term,{signal:controller.signal});
        if(alive&&!controller.signal.aborted)setRemote({query:term,items:response.anime,status:'ready'});
      }catch{
        if(alive&&!controller.signal.aborted)setRemote({query:term,items:[],status:'error'});
      }
    },350);
    return()=>{alive=false;clearTimeout(timer);controller.abort();};
  },[expanded,term]);
  const close=(restoreFocus=false)=>{setExpanded(false);if(restoreFocus)toggle.current?.focus();};
  const choose=(item:Anime)=>{close(true);onDetail(item);};
  const status=term.length<2?'Anime bulmak için en az 2 karakter yaz.':loading?'Animeler aranıyor…':failed?(results.length?'Çevrimiçi arama yapılamadı. Mevcut eşleşmeler gösteriliyor.':'Arama şu an kullanılamıyor. Biraz sonra tekrar dene.'):results.length?`${results.length} öneri`:`“${term}” için sonuç bulunamadı.`;
  return <div className="exp-nav-search-anchor">
    <button ref={toggle} type="button" className={'exp-search-toggle'+(expanded?' is-open':'')} onClick={()=>{if(rail){setExpanded(true);input.current?.focus();}}} aria-label="Aramayı aç" aria-expanded={expanded} aria-controls="nav-search-panel"><Search size={19}/></button>
    {expanded&&rail&&createPortal(<form id="nav-search-panel" className="exp-nav-search-panel" role="search" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))close();}} onKeyDown={event=>{
      if(event.nativeEvent.isComposing){if(event.key==='Enter')event.preventDefault();return;}
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}
      if(event.target===input.current&&(event.key==='ArrowDown'||event.key==='ArrowUp')&&results.length){event.preventDefault();const next=event.key==='ArrowDown'?(activeIndex+1)%results.length:activeIndex<=0?results.length-1:activeIndex-1;setActiveId(results[next].id);}
    }} onSubmit={event=>{event.preventDefault();const selected=results[activeIndex>=0?activeIndex:0];if(selected)choose(selected);else input.current?.focus();}}>
      <div className="exp-nav-search exp-nav-search-row is-open">
        <button type="submit" className="exp-search-trigger" aria-label="Seçili animeyi aç"><Search size={19}/></button>
        <input ref={input} id="nav-anime-search" type="search" role="combobox" value={query} maxLength={100} onChange={event=>{setQuery(event.target.value);setActiveId(null);}} placeholder="Anime, seri veya tür ara…" aria-label="Anime, seri veya tür ara" autoComplete="off" spellCheck={false} aria-autocomplete="list" aria-expanded={results.length>0} aria-controls="nav-search-results" aria-activedescendant={activeIndex>=0?`nav-result-${results[activeIndex].id}`:undefined} aria-describedby="nav-search-status"/>
        <button type="button" className="exp-search-close" onClick={()=>close(true)} aria-label="Aramayı kapat"><X size={16}/></button>
      </div>
      <div className="exp-search-suggestions">
        <div className="exp-search-status"><span id="nav-search-status" role="status" aria-live="polite">{status}</span>{results.length>0&&<small>↑ ↓ ile seç · Enter ile aç</small>}</div>
        <ul ref={list} id="nav-search-results" className="exp-search-results" role="listbox" aria-label="Anime önerileri" aria-busy={loading}>
          {results.map(item=><li id={`nav-result-${item.id}`} key={item.id} role="option" aria-selected={item.id===activeId} onMouseEnter={()=>setActiveId(item.id)} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(item)}>
            <span className="exp-search-poster" aria-hidden="true"><Poster item={item}/></span>
            <span className="exp-search-result-copy"><strong>{item.title}</strong>{item.original&&item.original!==item.title&&<span>{item.original}</span>}<small>{[item.format,item.year,item.episodes?`${item.episodes} bölüm`:null].filter(Boolean).join(' · ')}</small></span>
            {item.rating!==null&&<span className="exp-search-rating"><Star size={12}/>{item.rating.toFixed(1)}</span>}<ChevronRight size={15} aria-hidden="true"/>
          </li>)}
        </ul>
      </div>
    </form>,rail)}
  </div>;
}
function useNavigationEffects(page:string,ready:boolean){
  const currentPage=useRef(page);
  const refresh=useRef<(()=>void)|null>(null);
  currentPage.current=page;
  useEffect(()=>{
    if(!ready)return;
    const rail=document.querySelector<HTMLElement>('.site-masthead .rail');
    const nav=document.getElementById('nav-items');
    if(!rail||!nav)return;
    const spacer=document.createElement('div');
    spacer.className='exp-nav-spacer';spacer.setAttribute('aria-hidden','true');
    spacer.style.height=rail.getBoundingClientRect().height+'px';
    rail.parentNode?.insertBefore(spacer,rail);
    const indicator=document.createElement('span');
    indicator.className='exp-nav-indicator';indicator.setAttribute('aria-hidden','true');
    nav.appendChild(indicator);
    const previousOffset=document.documentElement.style.getPropertyValue('--navigation-offset');
    document.body.dataset.navEffects='true';
    let frame=0,positionFrame=0,needsSpace=true,disposed=false;
    const reserveSpace=()=>{
      // Measure the full navbar on viewport/font changes. Its reserved space
      // stays full-height while the fixed bar contracts, preventing scroll jumps.
      const compact=rail.dataset.compact==='true';
      rail.dataset.measuring='true';rail.dataset.compact='false';
      spacer.style.height=Math.ceil(rail.getBoundingClientRect().height)+'px';
      rail.dataset.compact=String(compact);
      void rail.offsetHeight;
      delete rail.dataset.measuring;
    };
    const measure=()=>{
      frame=0;if(disposed)return;
      const compact=rail.dataset.compact==='true';
      rail.dataset.compact=String(compact?window.scrollY>24:window.scrollY>72);
      if(needsSpace){reserveSpace();needsSpace=false;}
      document.documentElement.style.setProperty('--navigation-offset',Math.ceil(rail.getBoundingClientRect().height+16)+'px');
      const buttons=Array.from(nav.querySelectorAll<HTMLElement>('.nav-item'));
      const selected=buttons.find(button=>!button.hidden&&(currentPage.current==='admin'?button.id==='admin-nav':button.dataset.page===currentPage.current));
      for(const button of buttons){
        if(button===selected){if(button.getAttribute('aria-current')!=='page')button.setAttribute('aria-current','page');}
        else if(button.hasAttribute('aria-current'))button.removeAttribute('aria-current');
      }
      const target=selected?.getBoundingClientRect();
      if(!target?.width){indicator.dataset.visible='false';return;}
      const bounds=nav.getBoundingClientRect();
      indicator.style.width=target.width+'px';
      indicator.style.transform=`translateX(${target.left-bounds.left+nav.scrollLeft}px)`;
      indicator.dataset.visible='true';
      if(!indicator.dataset.positioned&&!positionFrame)positionFrame=requestAnimationFrame(()=>{positionFrame=0;if(!disposed)indicator.dataset.positioned='true';});
    };
    const schedule=(space=false)=>{needsSpace||=space;if(!frame&&!disposed)frame=requestAnimationFrame(measure);};
    const resize=()=>schedule(true),scroll=()=>schedule();
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>schedule()):null;
    observer?.observe(rail);observer?.observe(nav);
    nav.querySelectorAll('.nav-item').forEach(button=>observer?.observe(button));
    const mutations=new MutationObserver(records=>schedule(records.some(record=>record.type==='childList'||record.attributeName==='hidden')));
    mutations.observe(nav,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class','aria-current']});
    const account=rail.querySelector('.nav-account');
    const accountChanges=new MutationObserver(()=>schedule(true));
    if(account)accountChanges.observe(account,{childList:true,subtree:true});
    window.addEventListener('scroll',scroll,{passive:true});
    window.addEventListener('resize',resize);
    window.addEventListener('anime:navlayout',resize);
    nav.addEventListener('scroll',scroll,{passive:true});
    document.fonts?.addEventListener('loadingdone',resize);
    document.fonts?.ready.then(()=>{if(!disposed)schedule(true);});
    refresh.current=()=>schedule();schedule(true);
    return()=>{
      disposed=true;cancelAnimationFrame(frame);cancelAnimationFrame(positionFrame);
      observer?.disconnect();mutations.disconnect();accountChanges.disconnect();
      window.removeEventListener('scroll',scroll);window.removeEventListener('resize',resize);window.removeEventListener('anime:navlayout',resize);nav.removeEventListener('scroll',scroll);
      document.fonts?.removeEventListener('loadingdone',resize);
      refresh.current=null;indicator.remove();spacer.remove();
      delete rail.dataset.compact;delete rail.dataset.measuring;delete document.body.dataset.navEffects;
      if(previousOffset)document.documentElement.style.setProperty('--navigation-offset',previousOffset);else document.documentElement.style.removeProperty('--navigation-offset');
    };
  },[ready]);
  useEffect(()=>{refresh.current?.();},[page,ready]);
}
export default function AnimeExperience(){
  const [snapshot,setSnapshot]=useState(initial);
  const [hash,setHash]=useState('');
  const [slots,setSlots]=useState<{home:HTMLElement;page:HTMLElement;nav:HTMLElement;menu:HTMLElement}|null>(null);
  const [detail,setDetail]=useState<Anime|null>(null);
  const [notice,setNotice]=useState('');
  const previousFocus=useRef<HTMLElement|null>(null);
  const previousScroll=useRef(0);
  useEffect(()=>{
    window.AnimeExperienceMounted=true;
    let frame=0;
    const sync=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{setSnapshot(readSnapshot());setHash(location.hash.slice(1));const home=document.getElementById('experience-home-slot'),page=document.getElementById('experience-page-slot'),nav=document.getElementById('experience-nav-slot'),menu=document.getElementById('nav-items');if(home&&page&&nav&&menu)setSlots(previous=>previous||{home,page,nav,menu});});};
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
  useNavigationEffects(page,snapshot.ready);
  useEffect(()=>{setDetail(null);},[hash,snapshot.accountScope]);
  useEffect(()=>{if(!detail)return;const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&!document.querySelector('dialog[open]'))closeDetail();};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[detail]);
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
  return <>{slots&&snapshot.ready&&<>{page==='discover'&&createPortal(<PersonalHome snapshot={snapshot} onChange={change} onDetail={openDetail}/>,slots.home)}{page==='watchlist'&&createPortal(<Watchlist snapshot={snapshot} onChange={change} onDetail={openDetail}/>,slots.page)}{page==='profile'&&createPortal(<ProfileView key={hash+snapshot.accountScope} snapshot={snapshot} publicUserId={publicUserId} onClose={()=>{location.hash='discover';}} onChange={change} onOpenDetail={openDetail}/>,slots.page)}{page==='detail'&&detail&&createPortal(<AnimeDetail key={detail.id+snapshot.accountScope} item={detail} snapshot={snapshot} onClose={closeDetail} onChange={change}/>,slots.page)}{createPortal(<ThemePicker/>,slots.menu)}{createPortal(<><NavigationSearch rail={slots.nav.closest<HTMLElement>('.rail')} snapshot={snapshot} onDetail={openDetail}/><ExperienceControls snapshot={snapshot} onChange={change}/></>,slots.nav)}</>}
    {snapshot.ready&&<CatalogFilters page={page}/>}
    <AccountAvatarFrames ready={snapshot.ready} frameId={snapshot.account?.user?.avatarFrame}/>
    {notice&&<div className="exp-feedback" role="status">{notice}</div>}
  </>;
}
