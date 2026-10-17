export type BroadcastAnime = {
  id: string;
  title?: string;
  image?: string | null;
  airing?: boolean;
  broadcastLocal?: boolean;
  day?: number | null;
  time?: string | null;
};

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function turkeyClock(now: Date = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map(part => [part.type, part.value]));
  return {
    key: `${values.year}-${values.month}-${values.day}`,
    day: weekdays.indexOf(values.weekday),
    minute: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function broadcastMinute(item: BroadcastAnime) {
  if (!item || !/^mal-[1-9]\d*$/.test(item.id) || !item.airing || item.broadcastLocal !== true ||
      !Number.isInteger(item.day) || item.day! < 0 || item.day! > 6 ||
      typeof item.time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.time)) return null;
  const [hour, minute] = item.time.split(":").map(Number);
  return hour * 60 + minute;
}

function uniqueBroadcasts<T extends BroadcastAnime>(items: T[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    if (!item || !/^mal-[1-9]\d*$/.test(item.id) || seen.has(item.id)) return false;
    seen.add(item.id);
    return broadcastMinute(item) !== null;
  });
}

export function todayFollowed<T extends BroadcastAnime>(items: T[], followedIds: string[], now = new Date()) {
  const today = turkeyClock(now), followed = new Set(followedIds);
  return uniqueBroadcasts(items).filter(item => followed.has(item.id) && item.day === today.day)
    .sort((a, b) => broadcastMinute(a)! - broadcastMinute(b)! || a.id.localeCompare(b.id));
}

function previousDate(key: string) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

// The source provides a recurring broadcast time, not a confirmed episode date.
// Only a five-minute arrival window is eligible, including across local midnight.
export function dueReminders<T extends BroadcastAnime>(items: T[], reminderIds: string[], now = new Date()) {
  const today = turkeyClock(now), reminders = new Set(reminderIds);
  return uniqueBroadcasts(items).flatMap(item => {
    if (!reminders.has(item.id)) return [];
    const minute = broadcastMinute(item)!;
    const elapsed = item.day === today.day ? today.minute - minute :
      item.day === (today.day + 6) % 7 ? today.minute + 1440 - minute : Infinity;
    if (elapsed < 0 || elapsed >= 5) return [];
    const dateKey = item.day === today.day ? today.key : previousDate(today.key);
    return [{item, dateKey, key: `${dateKey}:${item.id}`}];
  });
}

export function notificationStorageKey(scope: string | null | undefined) {
  return `anime-takvimi-notifications-v1:${encodeURIComponent(scope || "guest")}`;
}

export function pruneDeliveryKeys(keys: string[], now = new Date()) {
  const today = turkeyClock(now).key, yesterday = previousDate(today);
  return [...new Set(keys.filter(key => /^(?:\d{4}-\d{2}-\d{2}):mal-[1-9]\d*$/.test(key) &&
    (key.startsWith(`${today}:`) || key.startsWith(`${yesterday}:`))))].slice(-1000);
}
