import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const context = {window:{}};
runInNewContext(readFileSync(new URL('../public/site/schedule-map.js',import.meta.url),'utf8'),context);
const schedule = context.window.AnimeScheduleMap;
const at = value => new Date(value);
const dates = week => Array.from(week.dates,date=>date.toISOString().slice(0,10));
const event = (id,day,time,extra={}) => ({id,day,time,airing:true,broadcastLocal:true,...extra});
const ids = entries => Array.from(entries,entry=>entry.item.id);

test('Istanbul midnight changes the day and week while the UTC date is still Sunday',()=>{
  const before = schedule.localNow(at('2026-10-18T20:59:00Z'));
  const after = schedule.localNow(at('2026-10-18T21:00:00Z'));
  assert.equal(before.key,'2026-10-18'); assert.equal(before.day,6); assert.equal(before.minute,1439);
  assert.equal(after.key,'2026-10-19'); assert.equal(after.day,0); assert.equal(after.minute,0);
  assert.deepEqual(dates(schedule.weekDates(at('2026-10-18T20:59:00Z'))),[
    '2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18',
  ]);
  assert.equal(dates(schedule.weekDates(at('2026-10-18T21:00:00Z')))[0],'2026-10-19');
});

test('ISO week numbers use the Thursday year across calendar-year boundaries',()=>{
  const january = schedule.weekDates(at('2027-01-01T09:00:00Z'));
  assert.equal(january.year,2026); assert.equal(january.number,53);
  assert.equal(dates(january)[0],'2026-12-28'); assert.equal(dates(january)[6],'2027-01-03');
  const december = schedule.weekDates(at('2025-12-29T09:00:00Z'));
  assert.equal(december.year,2026); assert.equal(december.number,1);
  assert.equal(dates(december)[0],'2025-12-29'); assert.equal(dates(december)[6],'2026-01-04');
});

test('week offsets and leap-day dates preserve the actual current-day identity',()=>{
  const now = at('2024-02-29T12:30:00Z');
  const current = schedule.weekDates(now);
  const previous = schedule.weekDates(now,-1);
  const next = schedule.weekDates(now,1);
  assert.equal(current.number,9);
  assert.deepEqual(dates(current),['2024-02-26','2024-02-27','2024-02-28','2024-02-29','2024-03-01','2024-03-02','2024-03-03']);
  assert.equal(dates(previous)[0],'2024-02-19'); assert.equal(dates(next)[0],'2024-03-04');
  for(const week of [previous,current,next]) {
    assert.equal(week.key,'2024-02-29'); assert.equal(week.day,3); assert.equal(week.minute,930);
  }
  assert.deepEqual(dates(schedule.weekDates(now,2.9)),dates(schedule.weekDates(now,2)));
});

test('only canonical 24-hour times and converted active broadcasts enter the map',()=>{
  assert.equal(schedule.minutes('00:00'),0); assert.equal(schedule.minutes('23:59'),1439);
  for(const value of ['24:00','12:60','9:00','09:0',' 09:00','09:00 ',null,undefined,900])assert.equal(schedule.minutes(value),null);
  const good=event('valid',0,'09:00');
  assert.equal(schedule.valid(good),true);
  for(const item of [null,{},event('paused',0,'09:00',{airing:false}),event('source',0,'09:00',{broadcastLocal:false}),event('missing-zone',0,'09:00',{broadcastLocal:undefined}),event('low',-1,'09:00'),event('high',7,'09:00'),event('fraction',1.5,'09:00'),event('string','1','09:00'),event('bad',0,'24:00')])assert.equal(schedule.valid(item),false);
  const result=schedule.layout([good,event('nonlocal',0,'09:00',{broadcastLocal:false}),event('unknown',null,null)]);
  assert.deepEqual(ids(result.rows[0].events),['valid']);
  assert.equal(result.rows.reduce((sum,row)=>sum+row.events.length,0),1);
});

test('same-time events occupy separate lanes and each weekday has independent lanes',()=>{
  const result=schedule.layout([event('c',0,'10:00'),event('a',0,'10:00'),event('b',0,'10:00'),event('next-day',1,'10:00')]);
  assert.deepEqual(ids(result.rows[0].events),['a','b','c']);
  assert.deepEqual(Array.from(result.rows[0].events,entry=>entry.lane),[0,1,2]);
  assert.equal(result.rows[1].events[0].lane,0);
  for(const row of result.rows)for(const entry of row.events)assert.ok(entry.top>=0 && entry.top+76<=row.height);
});

test('chained collisions stay disjoint and a free lane is reused once the card fits',()=>{
  const result=schedule.layout(['10:00','11:00','12:00','14:00','15:00','23:59'].map((time,i)=>event(String(i),2,time)));
  const events=result.rows[2].events;
  assert.deepEqual(Array.from(events.slice(0,4),entry=>entry.lane),[0,1,2,0]);
  for(let i=0;i<events.length;i++)for(let j=i+1;j<events.length;j++) {
    if(events[i].lane===events[j].lane)assert.ok(events[j].left>=events[i].left+220,'cards in one lane need their full width plus a gap');
  }
});

test('midnight and late-night cards stay within the horizontal plot',()=>{
  for(const items of [[event('late',6,'23:59')],[event('midnight',0,'00:00'),event('late',6,'23:59')]]) {
    const result=schedule.layout(items);
    for(const row of result.rows)for(const entry of row.events) {
      assert.ok(Number.isFinite(entry.left)); assert.ok(entry.left>=0);
      assert.ok(entry.left+210<=result.plotWidth);
    }
    assert.ok(result.position(1440)<=result.plotWidth);
    assert.equal(result.ticks.at(-1).label,'24:00');
  }
  const midnight=schedule.layout([event('midnight',0,'00:00')]);
  assert.equal(midnight.start,0); assert.equal(midnight.rows[0].events[0].left,0);
});

test('layout deduplicates and sorts without changing the array or event records',()=>{
  const items=Object.freeze([
    Object.freeze(event('later',0,'20:00')),
    Object.freeze(event('first',0,'10:00')),
    Object.freeze(event('first',0,'11:00')),
    Object.freeze(event('other-day',6,'00:00')),
  ]);
  const before=JSON.stringify(items),result=schedule.layout(items);
  assert.equal(JSON.stringify(items),before);
  assert.deepEqual(ids(result.rows[0].events),['first','later']);
  assert.equal(result.rows[0].events[0].item,items[1]);
  assert.equal(result.rows.reduce((sum,row)=>sum+row.events.length,0),3);
});

test('empty layout supplies seven finite rows and usable axis geometry',()=>{
  const result=schedule.layout([]);
  assert.equal(result.rows.length,7); assert.equal(result.start,720);
  assert.ok(result.plotWidth>result.axisWidth); assert.ok(Number.isFinite(result.hourWidth));
  assert.deepEqual(Array.from(result.rows,row=>row.day),[0,1,2,3,4,5,6]);
  assert.ok(result.rows.every(row=>row.events.length===0 && row.height>=92));
  assert.equal(schedule.upcoming([],at('2026-10-18T20:55:00Z')),null);
});

test('upcoming recurrence crosses Sunday midnight and skips already elapsed times',()=>{
  const items=[event('elapsed',6,'23:50'),event('next-monday',0,'00:05'),event('later-monday',0,'12:00')];
  const before=JSON.stringify(items);
  const next=schedule.upcoming(items,at('2026-10-18T20:55:00Z'));
  assert.equal(next.item.id,'next-monday'); assert.equal(next.delta,10);
  assert.equal(schedule.upcoming([items[0]],at('2026-10-18T20:55:00Z')).delta,10075);
  assert.equal(JSON.stringify(items),before);
});

test('upcoming keeps an event at the current minute and resolves ties deterministically',()=>{
  const now=at('2026-10-19T07:00:00Z');
  const next=schedule.upcoming([event('b',0,'10:00'),event('z',0,'09:59'),event('a',0,'10:00'),event('not-local',0,'10:00',{broadcastLocal:false})],now);
  assert.equal(next.item.id,'a'); assert.equal(next.delta,0);
  assert.equal(schedule.upcoming([event('old-minute',0,'09:59')],now).delta,10079);
});
