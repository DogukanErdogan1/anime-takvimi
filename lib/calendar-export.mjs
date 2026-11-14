const encoder=new TextEncoder();
const text=value=>String(value??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
function fold(line){const lines=[];let current='',size=0;for(const char of line){const bytes=encoder.encode(char).length;if(size+bytes>75){lines.push(current);current=' ';size=1;}current+=char;size+=bytes;}return [...lines,current].join('\r\n');}
const stamp=date=>date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
export function calendarEvents(items,followedIds,now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 const midnight=new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00+03:00`),weekday=(new Date(Date.UTC(+parts.year,+parts.month-1,+parts.day)).getUTCDay()+6)%7;
 const seen=new Set(),followed=new Set(followedIds);
 return items.flatMap(item=>{
  if(!item||!/^mal-[1-9]\d{0,9}$/.test(item.id)||!followed.has(item.id)||seen.has(item.id)||item.airing!==true||item.broadcastLocal!==true||!Number.isInteger(item.day)||item.day<0||item.day>6||!/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time||''))return [];
  seen.add(item.id);const [hour,minute]=item.time.split(':').map(Number);let start=new Date(midnight.getTime()+((item.day-weekday+7)%7)*86400000+hour*3600000+minute*60000);if(start.getTime()<now.getTime())start=new Date(start.getTime()+7*86400000);
  return [{item,start,key:new Date(start.getTime()+3*3600000).toISOString().slice(0,10)}];
 }).sort((a,b)=>a.start-b.start);
}
// RFC 5545: escaped TEXT, CRLF endings and UTF-8-safe 75-octet folding.
export function libraryCalendar(items,followedIds,{now=new Date(),origin='https://anime-takvimi-production.up.railway.app'}={}){
 const events=calendarEvents(items,followedIds,now);let base;
 try{const u=new URL(origin);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error();base=u.origin;}catch{throw new Error('Geçerli bir site adresi gerekiyor.');}
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Anime Takvimi//Yayin Plani//TR','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:Anime Takvimi'];
 for(const {item,start,key} of events){lines.push('BEGIN:VEVENT',`UID:anime-${item.id.slice(4)}-${key}@anime-takvimi`,`DTSTAMP:${stamp(now)}`,`DTSTART:${stamp(start)}`,`SUMMARY:${text(item.title)}`,`DESCRIPTION:${text('Haftalık yayın planıdır; bölüm gecikmeleri ve platform saatleri farklı olabilir.')}`,`URL:${base}/anime/${item.id.slice(4)}`);if(Number.isInteger(item.duration)&&item.duration>0&&item.duration<=10000)lines.push(`DURATION:PT${item.duration}M`);lines.push('END:VEVENT');}
 lines.push('END:VCALENDAR');return {content:lines.map(fold).join('\r\n')+'\r\n',count:events.length};
}
