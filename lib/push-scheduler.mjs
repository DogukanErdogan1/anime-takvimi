import * as webpush from 'web-push';
import {createPushService} from './push.mjs';

const weekdays = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const dateParts = (date, timeZone) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(date).map(part => [part.type, part.value]));
export function pushScheduleItem(raw, now = new Date()) {
  const sourceDay = weekdays.indexOf(String(raw?.broadcast?.day || '').toLowerCase().replace(/s$/, ''));
  const time = raw?.broadcast?.time, zone = raw?.broadcast?.timezone;
  if (raw?.airing !== true || !Number.isInteger(raw.mal_id) || raw.mal_id < 1 || typeof raw.title !== 'string' || !raw.title.trim() || sourceDay < 0 || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || !zone) return null;
  try {
    const local = dateParts(now, zone), day = +local.day + sourceDay - weekdays.indexOf(local.weekday.toLowerCase());
    const desired = Date.UTC(+local.year, +local.month - 1, day, +time.slice(0, 2), +time.slice(3));
    let instant = desired;
    for (let index = 0; index < 3; index++) {const p = dateParts(new Date(instant), zone); instant = desired - (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - instant);}
    const tr = dateParts(new Date(instant), 'Europe/Istanbul');
    return {id: `mal-${raw.mal_id}`, title: raw.title.slice(0, 500), airing: true, broadcastLocal: true, day: weekdays.indexOf(tr.weekday.toLowerCase()), time: `${tr.hour}:${tr.minute}`};
  } catch {return null;}
}

export function createPushScheduleLoader({fetcher = fetch, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  let cached = null, fetchedAt = 0;
  return async signal => {
    if (cached && now() - fetchedAt < 30 * 60000) return cached;
    const result = [];
    for (let page = 1; page <= 30; page++) {
      signal?.throwIfAborted();
      const timeout = AbortSignal.timeout(20000);
      const response = await fetcher(`https://api.tenrai.org/v1/schedules?sfw&limit=25&page=${page}`, {signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: {Accept: 'application/json'}});
      if (!response.ok) throw new Error('schedule_unavailable');
      const data = await response.json();
      if (!Array.isArray(data.data)) throw new Error('invalid_schedule');
      result.push(...data.data.map(raw => pushScheduleItem(raw, new Date(now()))).filter(Boolean));
      if (!data.pagination?.has_next_page) {signal?.throwIfAborted(); cached = result; fetchedAt = now(); return cached;}
      await pause(400);
    }
    throw new Error('incomplete_schedule');
  };
}

export function startPushScheduler(database, config, options = {}) {
  const load = options.load || createPushScheduleLoader(options);
  const sender = options.send || ((subscription, payload) => webpush.sendNotification(subscription, JSON.stringify(payload), {vapidDetails: config, TTL: 300, timeout: 10000}));
  let busy = false, stopped = false, controller = null;
  const tick = async () => {
    if (busy || stopped || !config.publicKey || !config.privateKey) return;
    busy = true; controller = new AbortController();
    try {
      const db = typeof database === 'function' ? database() : database;
      if (!db) return;
      const count = await db.prepare('SELECT COUNT(*) AS total FROM push_subscriptions').first();
      if (!count.total) return;
      const items = await load(controller.signal);
      if (!stopped) await createPushService(db, config, {now: options.now, send: async (...args) => {if (stopped) throw new DOMException('Stopped', 'AbortError'); return sender(...args);}}).dispatch(items);
    } catch (error) {
      if (!stopped) (options.onError || (() => console.error('Arka plan bildirimi: yayın planı veya gönderim geçici olarak kullanılamıyor; yeniden denenecek.')))(error);
    } finally {busy = false; controller = null;}
  };
  const timer = options.intervalMs === 0 ? null : setInterval(() => void tick(), options.intervalMs || 60000);
  timer?.unref?.();
  if (options.intervalMs !== 0) void tick();
  return {tick, stop() {stopped = true; if (timer) clearInterval(timer); controller?.abort();}};
}
