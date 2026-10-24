(() => {
  'use strict';
  const minutes = time => typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : null;
  function localNow(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
    const p = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type,Number(part.value)]));
    const date = new Date(Date.UTC(p.year,p.month-1,p.day));
    return {date,day:(date.getUTCDay()+6)%7,minute:p.hour*60+p.minute,key:date.toISOString().slice(0,10)};
  }
  function weekDates(now = new Date(), offset = 0) {
    const today = localNow(now);
    const monday = new Date(today.date);
    monday.setUTCDate(monday.getUTCDate()-today.day+7*Math.trunc(offset));
    const dates = Array.from({length:7},(_,i)=>new Date(monday.getTime()+i*86400000));
    const thursday = dates[3], year = thursday.getUTCFullYear();
    const first = new Date(Date.UTC(year,0,4));
    first.setUTCDate(first.getUTCDate()-(first.getUTCDay()+6)%7);
    return {...today,dates,year,number:1+Math.round((monday-first)/604800000)};
  }
  function valid(item) {
    return item?.airing === true && item.broadcastLocal === true && Number.isInteger(item.day) && item.day>=0 && item.day<7 && minutes(item.time)!==null;
  }
  function layout(items, {currentMinute = null} = {}) {
    const seen = new Set();
    const entries = items.filter(valid).filter(item=>{if(seen.has(item.id))return false;seen.add(item.id);return true;});
    const firstBroadcast = entries.length ? Math.min(...entries.map(item=>minutes(item.time))) : 720;
    const focus = Number.isFinite(currentMinute) && currentMinute>=0 && currentMinute<1440 ? currentMinute : 720;
    const start = Math.floor(Math.min(720,firstBroadcast,focus)/120)*120;
    const axisWidth = Math.max(900,(1440-start)*1.15), cardWidth=210, gap=10;
    const position = minute => (minute-start)/(1440-start)*axisWidth;
    const rows=Array.from({length:7},(_,day)=>{
      const ends=[];
      const events=entries.filter(item=>item.day===day).sort((a,b)=>minutes(a.time)-minutes(b.time)||String(a.id).localeCompare(String(b.id))).map(item=>{
        const left=position(minutes(item.time));
        let lane=ends.findIndex(end=>end+gap<=left);
        if(lane<0)lane=ends.length;
        ends[lane]=left+cardWidth;
        return {item,left,top:8+lane*84,lane};
      });
      return {day,events,height:Math.max(92,ends.length*84+16)};
    });
    const ticks=[];
    for(let minute=start;minute<=1440;minute+=120)ticks.push({label:String(Math.floor(minute/60)).padStart(2,'0')+':00',left:position(minute)});
    return {rows,ticks,start,axisWidth,plotWidth:axisWidth+cardWidth+12,hourWidth:axisWidth/(1440-start)*120,position};
  }
  function upcoming(items, now = new Date()) {
    const today=localNow(now);
    return items.filter(valid).map(item=>({item,delta:(item.day-today.day)*1440+minutes(item.time)-today.minute}))
      .map(entry=>({...entry,delta:entry.delta<0?entry.delta+10080:entry.delta}))
      .sort((a,b)=>a.delta-b.delta||String(a.item.id).localeCompare(String(b.item.id)))[0] || null;
  }
  window.AnimeScheduleMap={minutes,localNow,weekDates,valid,layout,upcoming};
})();
