(() => {
  'use strict';
  const dateLabel = (date,options={}) => new Intl.DateTimeFormat('tr-TR',{timeZone:'UTC',day:'numeric',month:'short',...options}).format(date);
  const fold = value => String(value || '').normalize('NFC').toLocaleLowerCase('tr-TR');
  const viewports = new WeakMap();
  function waitLabel(delta) {
    if(delta===0)return 'Planlanan saat geldi';
    const days=Math.floor(delta/1440),hours=Math.floor(delta%1440/60),minutes=delta%60;
    return [days?`${days} gün`:'',hours?`${hours} sa`:'',minutes?`${minutes} dk`:''].filter(Boolean).join(' ')+' sonra';
  }
  function filtered(state) {
    const query=fold(state.mapQuery).trim();
    return state.schedule.filter(window.AnimeScheduleMap.valid).filter(item=>
      (!state.mapSaved || state.saved.has(item.id)) && (!query || fold([item.title,item.original,item.studio,...item.synonyms].join(' ')).includes(query)));
  }

  function agenda({state,escape,icon,poster,days,shortDays,model,week,today,current,next,nextInWeek,kind}) {
    const day=Number.isInteger(state.day) && state.day>=0 && state.day<7?state.day:today.day;
    const items=model.rows[day].events.map(entry=>entry.item);
    const elapsed=item=>current && day*1440+window.AnimeScheduleMap.minutes(item.time)<today.day*1440+today.minute;
    const past=current && day===today.day?items.filter(elapsed):[];
    const upcoming=past.length?items.filter(item=>!elapsed(item)):items;
    const card=item=>{
      const saved=state.saved.has(item.id), isNext=nextInWeek && next?.id===item.id;
      return `<article class="map-agenda-event${isNext?' is-next':''}${elapsed(item)?' is-past':''}"><time class="map-agenda-time" aria-label="${item.time} Türkiye saati">${item.time}<small>TR</small></time><button type="button" class="map-agenda-detail" data-map-mobile="true" data-action="detail" data-id="${item.id}" aria-label="${escape(item.title)}, ${item.time}, detayları gör"><span class="map-agenda-art remote-art">${poster(item)}</span><span class="map-agenda-copy">${isNext?'<span class="map-agenda-badge">Sıradaki</span>':''}<strong>${escape(item.title)}</strong><small>${escape(item.format)} · ${elapsed(item)?'Planlanan saat geçti':'Haftalık yayın'}</small></span></button><button class="map-agenda-save${saved?' is-saved':''}" type="button" data-map-mobile="true" data-action="save" data-id="${item.id}" aria-pressed="${saved}" aria-label="${escape(item.title)} ${saved?'listemden çıkar':'listeme ekle'}">${icon(saved?'check':'bookmark')}</button></article>`;
    };
    const empty=state.scheduleLoading?'Yayın saatleri yükleniyor…':state.scheduleError && !state.schedule.length?'Veriler yenilendiğinde bu günün yayınları burada görünecek.':past.length?'Bugün için sırada başka planlı yayın yok.':state.mapQuery || state.mapSaved?'Bu gün için filtreye uygun yayın bulunamadı.':'Bu gün için planlı yayın bulunmuyor.';
    return `<section class="map-mobile-agenda" aria-labelledby="${kind}-agenda-heading"><div class="map-day-tabs" role="group" aria-label="Yayın günü seç">${days.map((name,index)=>`<button type="button" class="map-day-tab${current && index===today.day?' is-today':''}" data-map-day="${index}" aria-pressed="${day===index}" aria-label="${name}, ${escape(dateLabel(week.dates[index],{month:'long'}))}"><span>${shortDays[index]}</span><strong>${week.dates[index].getUTCDate()}</strong><small>${model.rows[index].events.length} yayın</small></button>`).join('')}</div><header class="map-agenda-heading"><div><h2 id="${kind}-agenda-heading">${days[day]}</h2><p>${escape(dateLabel(week.dates[day],{month:'long'}))}${current && day===today.day?' · Bugün':''}</p></div><span>${items.length} yayın</span></header><div class="map-agenda-list">${upcoming.map(card).join('') || `<p class="map-agenda-empty">${empty}</p>`}</div>${past.length?`<button class="map-past-toggle" type="button" data-map-past aria-expanded="${state.mapPastOpen===true}" aria-controls="${kind}-past-broadcasts">${icon(state.mapPastOpen?'chevron-up':'chevron-down')}<span>${past.length} geçen yayını ${state.mapPastOpen?'gizle':'göster'}</span></button><div class="map-agenda-list map-past-list" id="${kind}-past-broadcasts"${state.mapPastOpen?'':' hidden'}>${state.mapPastOpen?past.map(card).join(''):''}</div>`:''}</section>`;
  }
  function mount(target,{state,escape,icon,poster,days,shortDays,preview=false,focusNow=false}) {
    if(!target)return 0;
    const active=document.activeElement, inside=target.contains(active);
    const searchFocus=inside && active.matches('[data-map-search]');
    const scrollFocus=inside && active.matches('.map-scroll');
    const selection=searchFocus?[active.selectionStart,active.selectionEnd]:null;
    const identity=inside && active.tagName==='BUTTON'?['data-map-week','data-map-filter','data-map-today','data-map-day','data-map-past','data-map-mobile','data-action','data-id','data-page','aria-label'].map(name=>[name,active.getAttribute(name)]).filter(([,value])=>value!==null):null;
    const previous=target.querySelector('.map-scroll');
    const oldScroll=previous?.scrollLeft, oldTop=previous?.scrollTop;
    const oldRailLeft=target.querySelector('.map-day-tabs')?.scrollLeft;
    const all=filtered(state), source=state.schedule.filter(window.AnimeScheduleMap.valid);
    const entries=preview?days.flatMap((_,day)=>all.filter(item=>item.day===day).sort((a,b)=>a.time.localeCompare(b.time)).slice(0,2)):all;
    const now=new Date(), today=window.AnimeScheduleMap.localNow(now), current=state.weekOffset===0;
    const model=window.AnimeScheduleMap.layout(entries,{currentMinute:current?today.minute:null});
    const week=window.AnimeScheduleMap.weekDates(now,state.weekOffset);
    const nextEntry=current?window.AnimeScheduleMap.upcoming(all,now):null;
    const next=nextEntry?.item;
    const nextInWeek=nextEntry && today.day*1440+today.minute+nextEntry.delta<10080;
    const clock=new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
    const selectedDay=Number.isInteger(state.day) && state.day>=0 && state.day<7?state.day:today.day;
    const heading=preview?'h2':'h1';
    const kind=preview?'preview':'full';
    const feedback=state.scheduleLoading && !source.length?'Yayın akışı yükleniyor…':state.scheduleError && !source.length?'Yayın akışı alınamadı.':!all.length?state.mapSaved?'Listendeki animeler için yayın saati bulunamadı.':state.mapQuery?'Aramana uygun yayın bulunamadı.':'Türkiye saatine çevrilmiş bir yayın bilgisi henüz yok.':'';
    target.innerHTML=`<section class="broadcast-map${preview?' broadcast-preview':''}" aria-labelledby="${kind}-map-heading">
      <div class="map-heading"><small class="map-eyebrow">HAFTALIK YAYIN AKIŞI / HAFTA ${week.number}</small><${heading} id="${kind}-map-heading"><span>Haftanın</span> <strong>yayın haritası<span class="map-title-dot">.</span></strong></${heading}><p>Ne zaman, hangi anime? Hepsi burada.</p></div>
      <div class="map-week-nav"><button type="button" class="icon-button" data-map-week="-1" aria-label="Önceki hafta"${state.weekOffset<=-4?' disabled':''}>${icon('chevron-left')}</button><span class="map-range">${escape(dateLabel(week.dates[0]))} – ${escape(dateLabel(week.dates[6],{year:'numeric'}))}</span><button type="button" class="icon-button" data-map-week="1" aria-label="Sonraki hafta"${state.weekOffset>=4?' disabled':''}>${icon('chevron-right')}</button><button class="map-today" type="button" data-map-today aria-label="Güncel haftaya ve saate git">Şimdiye git</button></div>
      <div class="map-toolbar"><div class="map-filters" role="group" aria-label="Takvim filtresi"><button type="button" data-map-filter="all" aria-pressed="${!state.mapSaved}">Tüm yayınlar</button><button type="button" data-map-filter="saved" aria-pressed="${state.mapSaved}">Listemdekiler</button></div><span class="map-zone"><time class="map-clock" datetime="${now.toISOString()}">Şimdi ${clock}</time><span>Türkiye saati · UTC+3</span></span><label class="map-search">${icon('search')}<input id="${kind}-map-search" data-map-search type="search" placeholder="Anime ara" aria-label="Yayın takviminde anime ara" value="${escape(state.mapQuery)}" autocomplete="off"></label></div>
      ${feedback?`<div class="map-feedback" role="status">${escape(feedback)}${state.scheduleError?'<button class="text-button" type="button" data-action="retry" data-resource="schedule">Yeniden dene</button>':''}</div>`:''}
      <div class="map-scroll" tabindex="0" role="region" aria-label="Haftalık yayın çizelgesi. Tüm saatleri görmek için yatay kaydırın."><div class="map-board" style="--map-plot-width:${model.plotWidth}px;--map-hour-width:${model.hourWidth}px;--map-label-width:88px">
      <div class="map-axis"><span class="map-day-spacer">GÜN / SAAT</span><div class="map-hours">${model.ticks.map(tick=>`<span style="left:${tick.left}px">${tick.label}</span>`).join('')}</div></div>
      ${model.rows.map(row=>{const isToday=state.weekOffset===0 && row.day===today.day;const count=all.filter(item=>item.day===row.day).length;return `<section class="map-row${isToday?' is-today':''}" aria-label="${days[row.day]}, ${escape(dateLabel(week.dates[row.day]))}"><div class="map-day"><small>${shortDays[row.day].toLocaleUpperCase('tr-TR')}</small><strong>${week.dates[row.day].getUTCDate()}</strong>${isToday?'<span class="map-today-badge">BUGÜN</span>':''}${preview && count>row.events.length?`<button type="button" class="map-more" data-page="schedule" aria-label="${days[row.day]} gününün tüm yayınlarını gör">+${count-row.events.length} yayın</button>`:''}</div><div class="map-track" style="height:${row.height}px">${row.events.map(({item,left,top})=>`<article class="map-event${nextInWeek && next?.id===item.id?' is-next':''}${current && row.day*1440+window.AnimeScheduleMap.minutes(item.time)<today.day*1440+today.minute?' is-past':''}" style="left:${left}px;top:${top}px"><button class="map-detail" type="button" data-action="detail" data-id="${item.id}" aria-label="${escape(item.title)}, ${item.time}, detayları gör"><span class="map-art remote-art">${poster(item)}</span><span class="map-copy"><strong>${escape(item.title)}</strong><small>${nextInWeek && next?.id===item.id?'Sıradaki · ':''}${escape(item.format)} · Haftalık yayın</small><time>${item.time}</time></span></button><button class="map-save${state.saved.has(item.id)?' is-saved':''}" type="button" data-action="save" data-id="${item.id}" aria-pressed="${state.saved.has(item.id)}" aria-label="${escape(item.title)} ${state.saved.has(item.id)?'listemden çıkar':'listeme ekle'}">${icon(state.saved.has(item.id)?'check':'bookmark')}</button></article>`).join('')}${!row.events.length?`<span class="map-row-empty">${state.scheduleLoading?'—':'Planlı yayın yok'}</span>`:''}${isToday && today.minute>=model.start?`<span class="map-now" style="left:${model.position(today.minute)}px" aria-label="Şimdi ${clock}"><span>Şimdi ${clock}</span></span>`:''}</div></section>`;}).join('')}</div></div>
      ${preview?'':agenda({state,escape,icon,poster,days,shortDays,model,week,today,current,next,nextInWeek,kind})}
      ${next?`<div class="map-next"><span class="map-next-label">SIRADAKİ PLANLI YAYIN ${icon('chevron-right')}</span><span class="map-next-art remote-art">${poster(next)}</span><span class="map-next-copy"><strong>${escape(next.title)}</strong><small>${nextInWeek?'Haftalık yayın':'Gelecek hafta'} · ${days[next.day]} · ${waitLabel(nextEntry.delta)}</small></span><time>${next.time}</time><button class="map-next-action" type="button" data-action="detail" data-id="${next.id}">Detayları gör ${icon('arrow-right')}</button></div>`:''}
      <p class="map-note"><span>${state.weekOffset?'Seçili hafta güncel haftalık yayın düzenini tekrarlar; kesin bölüm tarihleri değildir.':'Kaynağın haftalık yayın düzeni gösterilir; bölüm gecikmeleri ve platform saatleri farklı olabilir.'}</span>${preview?'<button type="button" data-page="schedule">Tüm takvimi aç →</button>':'<span class="map-desktop-hint">Diğer saatler için çizelgeyi yatay kaydırabilirsin.</span><span class="map-mobile-hint">Diğer yayınlar için günlerden birini seçebilirsin.</span>'}</p>
    </section>`;
    const scroll=target.querySelector('.map-scroll');
    const previousViewport=viewports.get(target), weekKey=week.dates[0].toISOString();
    const focusCurrent=!preview && current && (focusNow || oldScroll===undefined || !previousViewport || previousViewport.week!==weekKey || previousViewport.today!==today.key || (previousViewport.awaitingData && source.length>0));
    const scale=model.axisWidth/(1440-model.start);
    if(focusCurrent) {
      scroll.scrollLeft=Math.max(0,model.position(today.minute)-Math.max(80,(scroll.clientWidth || 720)*0.3));
      const todayRow=target.querySelector('.map-row.is-today');
      scroll.scrollTop=Math.max(0,(todayRow?.offsetTop || 41)-41);
    } else {
      // Keep the visible hour stable when loading/filtering changes the axis range.
      const moved=previousViewport && (previousViewport.start!==model.start || previousViewport.scale!==scale);
      scroll.scrollLeft=oldScroll===undefined?0:moved?Math.max(0,model.position(previousViewport.start+oldScroll/previousViewport.scale)):oldScroll;
      scroll.scrollTop=oldTop??0;
    }
    const rail=target.querySelector('.map-day-tabs');
    if(rail) {
      const selected=rail.querySelector('[aria-pressed="true"]');
      if(selected && rail.clientWidth>0 && (focusNow || oldRailLeft===undefined || previousViewport?.day!==selectedDay || previousViewport?.week!==weekKey)) {
        rail.scrollLeft=Math.max(0,selected.offsetLeft-(rail.clientWidth-selected.offsetWidth)/2);
      } else rail.scrollLeft=oldRailLeft??0;
    }
    viewports.set(target,{week:weekKey,today:today.key,day:selectedDay,start:model.start,scale,awaitingData:state.scheduleLoading && source.length===0});
    if(inside){
      const control=searchFocus?target.querySelector('[data-map-search]'):scrollFocus?scroll:identity?.length?[...target.querySelectorAll('button')].find(button=>identity.every(([name,value])=>button.getAttribute(name)===value)):null;
      if(control)(control.disabled?scroll:control).focus({preventScroll:true});
      if(searchFocus && selection && selection[0]!==null)control.setSelectionRange(...selection);
    }
    return all.length;
  }
  window.AnimeScheduleView={filtered,mount};
})();
