export const HOME_WIDGETS=['continue','recommendations','today','history'];
export function normalizeHomeLayout(value={}) {
 const order=Array.isArray(value?.order)?[...new Set(value.order.filter(id=>HOME_WIDGETS.includes(id)))]:[];
 return {order:[...order,...HOME_WIDGETS.filter(id=>!order.includes(id))],hidden:Array.isArray(value?.hidden)?[...new Set(value.hidden.filter(id=>HOME_WIDGETS.includes(id)))]:[],weeklyGoal:Number.isInteger(value?.weeklyGoal)?Math.max(0,Math.min(300,value.weeklyGoal)):0};
}
export function validateInsights(value,bad){
 const object=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
 const keys=(v,allowed)=>object(v)&&Object.keys(v).every(k=>allowed.includes(k));
 const result={};
 if('activity' in value){
  if(!Array.isArray(value.activity)||value.activity.length>500)bad();const ids=new Set();
  result.activity=value.activity.map(entry=>{
   if(!keys(entry,['id','animeId','title','at','from','to'])||typeof entry.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(entry.id)||ids.has(entry.id)||typeof entry.animeId!=='string'||!/^mal-[1-9]\d{0,9}$/.test(entry.animeId)||typeof entry.title!=='string'||!entry.title.trim()||entry.title.length>500||/[\x00-\x1f]/.test(entry.title)||!Number.isSafeInteger(entry.at)||entry.at<0||entry.at>8640000000000000||![entry.from,entry.to].every(n=>Number.isInteger(n)&&n>=0&&n<=9999)||entry.from===entry.to)bad();
   ids.add(entry.id);return {...entry};
  }).sort((a,b)=>b.at-a.at);
 }
 if('homeLayout' in value){
  const layout=value.homeLayout;
  if(!keys(layout,['order','hidden','weeklyGoal'])||!Array.isArray(layout.order)||layout.order.length!==HOME_WIDGETS.length||new Set(layout.order).size!==HOME_WIDGETS.length||!layout.order.every(id=>HOME_WIDGETS.includes(id))||!Array.isArray(layout.hidden)||layout.hidden.length>HOME_WIDGETS.length||new Set(layout.hidden).size!==layout.hidden.length||!layout.hidden.every(id=>HOME_WIDGETS.includes(id))||!Number.isInteger(layout.weeklyGoal)||layout.weeklyGoal<0||layout.weeklyGoal>300)bad();
  result.homeLayout=normalizeHomeLayout(layout);
 }
 return result;
}
export function weekActivity(activity=[],now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 const today=new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00+03:00`);
 const weekday=(new Date(Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day))).getUTCDay()+6)%7;
 const start=today.getTime()-weekday*86400000,end=now.getTime(),entries=activity.filter(e=>e.at>=start&&e.at<=end);
 const totals=new Map();for(const e of entries)totals.set(e.animeId,(totals.get(e.animeId)||0)+e.to-e.from);
 return {episodes:[...totals.values()].reduce((sum,n)=>sum+Math.max(0,n),0),series:[...totals.values()].filter(n=>n>0).length,start,end};
}
