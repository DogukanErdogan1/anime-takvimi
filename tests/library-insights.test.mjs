import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLibrary,MembershipError} from '../lib/membership.mjs';
import {normalizeHomeLayout,weekActivity} from '../lib/library-insights.mjs';
import {calendarEvents,libraryCalendar} from '../lib/calendar-export.mjs';
const base=()=>({saved:[],reminders:[],progress:{},savedAnime:{},view:'grid'});
const entry=patch=>({id:'change-one',animeId:'mal-21',title:'Anime',at:Date.parse('2026-11-14T12:00:00Z'),from:0,to:1,...patch});
test('activity and layout round-trip while old libraries keep their original shape',()=>{
 assert.deepEqual(validateLibrary({library:base()}),base());const extras={activity:[entry()],homeLayout:normalizeHomeLayout()};assert.deepEqual(validateLibrary({library:{...base(),...extras}}),{...base(),...extras});
});
test('insights reject extra privileges, invalid deltas, duplicate keys and malformed layouts',()=>{
 for(const patch of [{activity:[entry({owner:'someone'})]},{activity:[entry({at:NaN})]},{activity:[entry({at:-1})]},{activity:[entry({animeId:'mal-0'})]},{activity:[entry({from:1,to:1})]},{activity:[entry({to:10000})]},{activity:[entry(),entry()]},{activity:Array.from({length:501},(_,i)=>entry({id:'entry-'+i}))},{homeLayout:{...normalizeHomeLayout(),order:['continue','continue','today','history']}},{homeLayout:{...normalizeHomeLayout(),hidden:['unknown']}},{homeLayout:{...normalizeHomeLayout(),weeklyGoal:301}},{homeLayout:{...normalizeHomeLayout(),admin:true}}])assert.throws(()=>validateLibrary({library:{...base(),...patch}}),MembershipError);
});
test('home normalization retains chosen order, bounds goals and never invents widget IDs',()=>{
 assert.deepEqual(normalizeHomeLayout({order:['today','bogus','today'],hidden:['history','bogus'],weeklyGoal:999}),{order:['today','continue','recommendations','history'],hidden:['history'],weeklyGoal:300});
});
test('weekly activity uses Monday Istanbul midnight, excludes future/old data and nets corrections per anime',()=>{
 const now=new Date('2026-11-15T21:15:00Z'),start=Date.parse('2026-11-15T21:00:00Z');
 const activity=[entry({id:'before',at:start-1,to:20}),entry({id:'one',at:start,from:0,to:3}),entry({id:'two',at:start+1,from:3,to:2}),entry({id:'correction',animeId:'mal-22',at:start+2,from:9,to:0}),entry({id:'future',at:now.getTime()+1,to:100})];
 const week=weekActivity(activity,now);assert.equal(week.start,start);assert.equal(week.episodes,2);assert.equal(week.series,1);assert.equal(weekActivity([],now).episodes,0);
});
const anime=(patch={})=>({id:'mal-21',malId:21,title:'Test anime',airing:true,broadcastLocal:true,day:5,time:'16:00',duration:24,...patch});
test('calendar exports only followed confirmed schedules and converts Turkey times to UTC',()=>{
 const now=new Date('2026-11-14T12:00:00Z');const items=[anime(),anime(),anime({id:'mal-22',day:6,time:'00:15'}),anime({id:'mal-23',broadcastLocal:false}),anime({id:'mal-24',airing:false}),anime({id:'mal-25',time:'24:00'}),anime({id:'mal-26',day:-1})];
 const followed=items.map(a=>a.id),events=calendarEvents(items,followed,now);assert.equal(events.length,2);assert.equal(events[0].start.toISOString(),'2026-11-14T13:00:00.000Z');assert.equal(events[1].start.toISOString(),'2026-11-14T21:15:00.000Z');
 const {content,count}=libraryCalendar(items,followed,{now});assert.equal(count,2);assert.match(content,/DTSTART:20261114T130000Z/);assert.match(content,/DURATION:PT24M/);assert.equal((content.match(/BEGIN:VEVENT/g)||[]).length,2);assert.equal(calendarEvents(items,[],now).length,0);
});
test('an elapsed broadcast exports its next occurrence rather than an event in the past',()=>{
 const events=calendarEvents([anime()],['mal-21'],new Date('2026-11-14T13:01:00Z'));assert.equal(events[0].start.toISOString(),'2026-11-21T13:00:00.000Z');
});
test('calendar TEXT cannot inject properties and long UTF-8 lines fold without splitting characters',()=>{
 const title='語🔥'.repeat(80)+',;\\\nBEGIN:VEVENT\r\nATTENDEE:evil';const {content}=libraryCalendar([anime({title,duration:null})],['mal-21'],{now:new Date('2026-11-14T12:00:00Z')});
 assert.equal((content.match(/\r\nBEGIN:VEVENT/g)||[]).length,1);assert.doesNotMatch(content,/\r\nATTENDEE:/);assert.doesNotMatch(content,/DURATION/);for(const line of content.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);assert.ok(!content.includes('\ufffd'));assert.match(content,/\\,\\;/);
 assert.throws(()=>libraryCalendar([],[],{origin:'javascript:alert(1)'}));assert.throws(()=>libraryCalendar([],[],{origin:'https://secret@example.test'}));
});
