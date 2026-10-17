(() => {
  'use strict';
  const dateLabel = (date,options={}) => new Intl.DateTimeFormat('tr-TR',{timeZone:'UTC',day:'numeric',month:'short',...options}).format(date);
  const fold = value => String(value || '').normalize('NFC').toLocaleLowerCase('tr-TR');
  function filtered(state) {
    const query=fold(state.mapQuery).trim();
    return state.schedule.filter(window.AnimeScheduleMap.valid).filter(item=>
      (!state.mapSaved || state.saved.has(item.id)) && (!query || fold([item.title,item.original,item.studio,...item.synonyms].join(' ')).includes(query)));
  }
  function mount(target,{state,escape,icon,poster,days,shortDays,preview=false}) {
    if(!target)return 0;
    const active=document.activeElement, inside=target.contains(active);
    const searchFocus=inside && active.matches('[data-map-search]');
    const scrollFocus=inside && active.matches('.map-scroll');
    const selection=searchFocus?[active.selectionStart,active.selectionEnd]:null;
    const identity=inside && active.tagName==='BUTTON'?['data-map-week','data-map-filter','data-map-today','data-action','data-id','data-page','aria-label'].map(name=>[name,active.getAttribute(name)]).filter(([,value])=>value!==null):null;
    const previous=target.querySelector('.map-scroll');
    const oldScroll=previous?.scrollLeft, oldTop=previous?.scrollTop;
    const all=filtered(state), source=state.schedule.filter(window.AnimeScheduleMap.valid);
    const entries=preview?days.flatMap((_,day)=>all.filter(item=>item.day===day).sort((a,b)=>a.time.localeCompare(b.time)).slice(0,2)):all;
    const model=window.AnimeScheduleMap.layout(entries), today=window.AnimeScheduleMap.localNow();
    const week=window.AnimeScheduleMap.weekDates(new Date(),state.weekOffset);
    const next=state.weekOffset===0?window.AnimeScheduleMap.upcoming(all)?.item:null;
    const heading=preview?'h2':'h1';
    const kind=preview?'preview':'full';
    const feedback=state.scheduleLoading && !source.length?'Yayın akışı yükleniyor…':state.scheduleError && !source.length?'Yayın akışı alınamadı.':!all.length?state.mapSaved?'Listendeki animeler için yayın saati bulunamadı.':state.mapQuery?'Aramana uygun yayın bulunamadı.':'Türkiye saatine çevrilmiş bir yayın bilgisi henüz yok.':'';
    target.innerHTML=`<section class="broadcast-map${preview?' broadcast-preview':''}" aria-labelledby="${kind}-map-heading">
      <div class="map-heading"><small class="map-eyebrow">HAFTALIK YAYIN AKIŞI / HAFTA ${week.number}</small><${heading} id="${kind}-map-heading"><span>Haftanın</span> <strong>yayın haritası<span class="map-title-dot">.</span></strong></${heading}><p>Ne zaman, hangi anime? Hepsi burada.</p></div>
      <div class="map-week-nav"><button type="button" class="icon-button" data-map-week="-1" aria-label="Önceki hafta"${state.weekOffset<=-4?' disabled':''}>${icon('chevron-left')}</button><span class="map-range">${escape(dateLabel(week.dates[0]))} – ${escape(dateLabel(week.dates[6],{year:'numeric'}))}</span><button type="button" class="icon-button" data-map-week="1" aria-label="Sonraki hafta"${state.weekOffset>=4?' disabled':''}>${icon('chevron-right')}</button><button class="map-today" type="button" data-map-today>Bu hafta</button></div>
      <div class="map-toolbar"><div class="map-filters" role="group" aria-label="Takvim filtresi"><button type="button" data-map-filter="all" aria-pressed="${!state.mapSaved}">Tüm yayınlar</button><button type="button" data-map-filter="saved" aria-pressed="${state.mapSaved}">Listemdekiler</button></div><span class="map-zone">Türkiye saati · UTC+3</span><label class="map-search">${icon('search')}<input id="${kind}-map-search" data-map-search type="search" placeholder="Anime ara" aria-label="Yayın takviminde anime ara" value="${escape(state.mapQuery)}" autocomplete="off"></label></div>
      ${feedback?`<div class="map-feedback" role="status">${escape(feedback)}${state.scheduleError?'<button class="text-button" type="button" data-action="retry" data-resource="schedule">Yeniden dene</button>':''}</div>`:''}
      <div class="map-scroll" tabindex="0" role="region" aria-label="Haftalık yayın çizelgesi. Tüm saatleri görmek için yatay kaydırın."><div class="map-board" style="--map-plot-width:${model.plotWidth}px;--map-hour-width:${model.hourWidth}px;--map-label-width:88px">
      <div class="map-axis"><span class="map-day-spacer">GÜN / SAAT</span><div class="map-hours">${model.ticks.map(tick=>`<span style="left:${tick.left}px">${tick.label}</span>`).join('')}</div></div>
      ${model.rows.map(row=>{const isToday=state.weekOffset===0 && row.day===today.day;const count=all.filter(item=>item.day===row.day).length;return `<section class="map-row${isToday?' is-today':''}" aria-label="${days[row.day]}, ${escape(dateLabel(week.dates[row.day]))}"><div class="map-day"><small>${shortDays[row.day].toLocaleUpperCase('tr-TR')}</small><strong>${week.dates[row.day].getUTCDate()}</strong>${isToday?'<span class="map-today-badge">BUGÜN</span>':''}${preview && count>row.events.length?`<button type="button" class="map-more" data-page="schedule" aria-label="${days[row.day]} gününün tüm yayınlarını gör">+${count-row.events.length} yayın</button>`:''}</div><div class="map-track" style="height:${row.height}px">${row.events.map(({item,left,top})=>`<article class="map-event${next?.id===item.id?' is-next':''}" style="left:${left}px;top:${top}px"><button class="map-detail" type="button" data-action="detail" data-id="${item.id}" aria-label="${escape(item.title)}, ${item.time}, detayları gör"><span class="map-art remote-art">${poster(item)}</span><span class="map-copy"><strong>${escape(item.title)}</strong><small>${next?.id===item.id?'Sıradaki · ':''}${escape(item.format)} · Haftalık yayın</small><time>${item.time}</time></span></button><button class="map-save${state.saved.has(item.id)?' is-saved':''}" type="button" data-action="save" data-id="${item.id}" aria-pressed="${state.saved.has(item.id)}" aria-label="${escape(item.title)} ${state.saved.has(item.id)?'listemden çıkar':'listeme ekle'}">${icon(state.saved.has(item.id)?'check':'bookmark')}</button></article>`).join('')}${!row.events.length?`<span class="map-row-empty">${state.scheduleLoading?'—':'Planlı yayın yok'}</span>`:''}${isToday && today.minute>=model.start?`<span class="map-now" style="left:${model.position(today.minute)}px" aria-label="Şimdi"><span>Şimdi</span></span>`:''}</div></section>`;}).join('')}</div></div>
      ${next?`<div class="map-next"><span class="map-next-label">SIRADAKİ PLANLI YAYIN ${icon('chevron-right')}</span><span class="map-next-art remote-art">${poster(next)}</span><span class="map-next-copy"><strong>${escape(next.title)}</strong><small>Haftalık yayın · ${days[next.day]}</small></span><time>${next.time}</time><button class="map-next-action" type="button" data-action="detail" data-id="${next.id}">Detayları gör ${icon('arrow-right')}</button></div>`:''}
      <p class="map-note"><span>${state.weekOffset?'Seçili hafta güncel haftalık yayın düzenini tekrarlar; kesin bölüm tarihleri değildir.':'Kaynağın haftalık yayın düzeni gösterilir; bölüm gecikmeleri ve platform saatleri farklı olabilir.'}</span>${preview?'<button type="button" data-page="schedule">Tüm takvimi aç →</button>':'<span>Diğer saatler için çizelgeyi yatay kaydırabilirsin.</span>'}</p>
    </section>`;
    const scroll=target.querySelector('.map-scroll');
    scroll.scrollLeft=oldScroll??Math.max(0,model.position(Math.max(model.start,720))-60);
    scroll.scrollTop=oldTop??0;
    if(inside){
      const control=searchFocus?target.querySelector('[data-map-search]'):scrollFocus?scroll:identity?.length?[...target.querySelectorAll('button')].find(button=>identity.every(([name,value])=>button.getAttribute(name)===value)):null;
      if(control)(control.disabled?scroll:control).focus({preventScroll:true});
      if(searchFocus && selection && selection[0]!==null)control.setSelectionRange(...selection);
    }
    return all.length;
  }
  window.AnimeScheduleView={filtered,mount};
})();
