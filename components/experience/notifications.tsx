"use client";

import {useEffect, useMemo, useRef, useState} from "react";
import {Bell, BellOff, BellRing, Check, Download, Moon, Sun, X} from "lucide-react";
import type {ExperienceSnapshot, LibraryChange} from "./types";
import {broadcastMinute, dueReminders, notificationStorageKey, pruneDeliveryKeys, todayFollowed, turkeyClock} from "./reminder-logic";
import "./notifications.css";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{outcome: "accepted" | "dismissed"}>;
};
type Preference = {scope: string; enabled: boolean};
type Permission = NotificationPermission | "unsupported";
const THEME_KEY = "anime-takvimi-theme-v1";

function currentPermission(): Permission {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
}

function readPreference(scope: string) {
  try {
    const value = JSON.parse(localStorage.getItem(notificationStorageKey(scope)) || "{}");
    return {enabled: value?.enabled === true, sent: pruneDeliveryKeys(Array.isArray(value?.sent) ? value.sent.filter((item: unknown) => typeof item === "string") : [])};
  } catch {return null;}
}

export function ExperienceControls({snapshot, onChange}: {snapshot: ExperienceSnapshot; onChange: LibraryChange}) {
  const scope = snapshot.accountScope || "guest";
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const accountEpoch = useRef({scope, value: 0});
  if (accountEpoch.current.scope !== scope) accountEpoch.current = {scope, value: accountEpoch.current.value + 1};
  const latest = useRef(snapshot); latest.current = snapshot;
  const sent = useRef<string[]>([]);
  const busy = useRef(false);
  const permissionPending = useRef(false);
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const installPrompt = useRef<InstallPromptEvent | null>(null);
  const [permission, setPermission] = useState<Permission>("unsupported");
  const [preference, setPreference] = useState<Preference>({scope: "", enabled: false});
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [promptReady, setPromptReady] = useState(false);
  const [installHelp, setInstallHelp] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [now, setNow] = useState(() => new Date());
  const enabled = preference.scope === scope && preference.enabled;

  const items = useMemo(() => [
    ...snapshot.schedule, ...snapshot.catalog, ...Object.values(snapshot.library.savedAnime),
  ], [snapshot.schedule, snapshot.catalog, snapshot.library.savedAnime]);
  const followed = useMemo(() => [...new Set([...snapshot.library.saved, ...snapshot.library.reminders])],
    [snapshot.library.saved, snapshot.library.reminders]);
  const today = useMemo(() => todayFollowed(items, followed, now), [items, followed, now]);
  const clock = turkeyClock(now);

  function savePreference(value: boolean, accountScope = scope) {
    if (scopeRef.current !== accountScope) return;
    setPreference({scope: accountScope, enabled: value});
    try {
      localStorage.setItem(notificationStorageKey(accountScope), JSON.stringify({enabled: value, sent: pruneDeliveryKeys(sent.current)}));
    } catch { /* The current tab still retains the preference when storage is unavailable. */ }
  }

  useEffect(() => {
    const restore = () => {
      const value = readPreference(scope);
      sent.current = value?.sent || [];
      setPreference({scope, enabled: value?.enabled === true});
    };
    restore();
    setFeedback("");
    const sync = (event: StorageEvent) => {if (event.key === notificationStorageKey(scope)) restore();};
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [scope]);

  useEffect(() => {
    setPermission(currentPermission());
    let initial: "light" | "dark" = "light";
    try {
      const stored = localStorage.getItem(THEME_KEY);
      initial = stored === "dark" || (stored !== "light" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    } catch { /* Keep the readable default. */ }
    setTheme(initial); document.documentElement.dataset.theme = initial;
    const syncPermission = () => setPermission(currentPermission());
    window.addEventListener("focus", syncPermission);
    document.addEventListener("visibilitychange", syncPermission);
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/sw.js", {scope: "/"}).then(value => {registration.current = value;}).catch(() => {});
    }
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", syncPermission);
      document.removeEventListener("visibilitychange", syncPermission);
    };
  }, []);

  useEffect(() => {
    const media = matchMedia("(display-mode: standalone)");
    const isInstalled = () => setInstalled(media.matches || (navigator as Navigator & {standalone?: boolean}).standalone === true);
    isInstalled();
    const available = (event: Event) => {
      event.preventDefault(); installPrompt.current = event as InstallPromptEvent; setPromptReady(true);
    };
    const completed = () => {setInstalled(true); setPromptReady(false); installPrompt.current = null; setInstallHelp(false);};
    window.addEventListener("beforeinstallprompt", available);
    window.addEventListener("appinstalled", completed);
    media.addEventListener("change", isInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", available);
      window.removeEventListener("appinstalled", completed);
      media.removeEventListener("change", isInstalled);
    };
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) {
      element.showModal();
      // Load the real weekly data only when a user opens their reminders.
      window.animeTakvimi?.loadSchedule().catch(() => {});
    } else if (!open && element?.open) element.close();
  }, [open]);

  useEffect(() => {
    if (!enabled || permission !== "granted" || !snapshot.ready || snapshot.libraryLoading || snapshot.blocked) return;
    let disposed = false;
    const deliver = async () => {
      if (disposed || scopeRef.current !== scope || currentPermission() !== "granted") return;
      const current = latest.current;
      if (!current.ready || current.libraryLoading || current.blocked || (current.accountScope || "guest") !== scope) return;
      const stored = readPreference(scope);
      if (stored && !stored.enabled) {setPreference({scope, enabled: false}); return;}
      if (stored) sent.current = pruneDeliveryKeys([...sent.current, ...stored.sent]);
      const source = [...current.schedule, ...current.catalog, ...Object.values(current.library.savedAnime)];
      const eligible = dueReminders(source, current.library.reminders).filter(entry => !sent.current.includes(entry.key));
      if (!eligible.length) return;
      for (const entry of eligible) {
          if (disposed || scopeRef.current !== scope || currentPermission() !== "granted") break;
          const options: NotificationOptions = {
            body: `${entry.item.title || "Takip ettiğin anime"} için planlanan yayın saati: ${entry.item.time} (Türkiye).`,
            icon: "/icon-192.png", badge: "/favicon.svg", tag: `anime-${entry.key}`,
          };
          let delivered = false;
          try {
            if (registration.current?.active) {
              await registration.current.showNotification("Yayın saati geldi", options); delivered = true;
            } else {
              const notice = new Notification("Yayın saati geldi", options);
              notice.onclick = () => {window.focus(); window.animeTakvimi?.navigate("watchlist"); notice.close();};
              delivered = true;
            }
          } catch { /* A browser may revoke notification permission at any time. */ }
          if (delivered && scopeRef.current === scope) {
            sent.current = pruneDeliveryKeys([...sent.current, entry.key]);
            const currentSettings = readPreference(scope);
            try { localStorage.setItem(notificationStorageKey(scope), JSON.stringify({enabled: currentSettings?.enabled ?? true, sent: sent.current})); } catch {}
          }
      }
    };
    const check = async () => {
      if (disposed || busy.current) return;
      busy.current = true;
      try {
        // A tab that already delivered this occurrence wins. Other open tabs read its stored key.
        if ("locks" in navigator) await navigator.locks.request(notificationStorageKey(scope), {ifAvailable: true}, async lock => {if (lock) await deliver();});
        else await deliver();
      } finally {busy.current = false;}
    };
    void check();
    const timer = window.setInterval(() => {void check();}, 30_000);
    return () => {disposed = true; window.clearInterval(timer);};
  }, [enabled, permission, scope, snapshot.ready, snapshot.libraryLoading, snapshot.blocked, items, snapshot.library.reminders]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next); document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch {}
  }

  async function enableNotifications() {
    const requestedScope = scope, requestedEpoch = accountEpoch.current.value;
    if (enabled) {savePreference(false); setFeedback("Cihaz hatırlatmaları kapatıldı."); return;}
    if (permissionPending.current || permission === "unsupported" || permission === "denied") return;
    permissionPending.current = true;
    setRequesting(true); setFeedback("");
    try {
      const result = currentPermission() === "granted" ? "granted" : await Notification.requestPermission();
      // Browser permission is origin-wide; account opt-in only belongs to the session that requested it.
      setPermission(result);
      if (scopeRef.current !== requestedScope || accountEpoch.current.value !== requestedEpoch) return;
      if (result === "granted") {
        savePreference(true, requestedScope);
        setFeedback("Bu tarayıcıda, bu hesap için hatırlatmalar açıldı.");
      } else setFeedback(result === "denied" ? "Bildirim izni kapalı. Tarayıcının site ayarlarından değiştirebilirsin." : "Bildirim izni verilmedi. Tercihini daha sonra değiştirebilirsin.");
    } catch {
      if (scopeRef.current === requestedScope && accountEpoch.current.value === requestedEpoch) setFeedback("Bu tarayıcıda bildirim izni açılamadı.");
    }
    finally {permissionPending.current = false; setRequesting(false);}
  }

  async function install() {
    const prompt = installPrompt.current;
    if (!prompt) {setInstallHelp(value => !value); return;}
    installPrompt.current = null; setPromptReady(false);
    try {await prompt.prompt(); await prompt.userChoice;} catch {setInstallHelp(true);}
  }

  const close = () => {setOpen(false); trigger.current?.focus();};
  return <>
    <div className="experience-controls" aria-label="Görünüm ve hatırlatmalar">
      <button type="button" className="experience-control experience-theme-shortcut" onClick={toggleTheme} aria-label={theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç"} title={theme === "dark" ? "Açık tema" : "Koyu tema"}>{theme === "dark" ? <Sun size={18}/> : <Moon size={18}/>}</button>
      <button ref={trigger} type="button" className="experience-control experience-bell" onClick={() => setOpen(true)} aria-label={`Bildirimler${today.length ? `, bugün ${today.length} yayın` : ""}`} aria-haspopup="dialog" title="Bildirimler"><Bell size={19}/>{today.length > 0 && <span className="experience-notification-dot" aria-hidden="true"/>}</button>
    </div>
    <dialog ref={dialog} className="experience-reminders" aria-labelledby="experience-reminders-title" onCancel={close} onClose={() => setOpen(false)} onClick={event => {if (event.target === event.currentTarget) close();}}>
      <div className="experience-reminders-inner">
        <div className="experience-reminders-brandbar"><img className="brand-logo-on-dark" src="/site/assets/anime-takvimi-logo.png" width="2172" height="724" alt="Anime Takvimi"/><button type="button" className="experience-mobile-sheet-close" onClick={close} aria-label="Bildirimleri kapat"><X size={20}/></button></div>
        <header className="experience-reminders-header"><div><span className="experience-small-kicker">HİKÂYELERİ KAÇIRMA</span><h2 id="experience-reminders-title">Bildirimler</h2></div><button type="button" className="experience-sheet-close" onClick={close} aria-label="Bildirimleri kapat"><X size={20}/></button></header>
        <div className="experience-reminder-date"><span className="experience-live-dot"/><strong>Bugün takip ettiklerin</strong><span>{new Intl.DateTimeFormat("tr-TR", {timeZone: "Europe/Istanbul", day: "numeric", month: "long"}).format(now)}</span></div>
        <div className="experience-reminder-list">
          {today.length ? today.map(item => {
            const active = snapshot.library.reminders.includes(item.id);
            const elapsed = broadcastMinute(item)! < clock.minute;
            return <article key={item.id} className="experience-reminder-item">
              <button type="button" className="experience-reminder-anime" onClick={() => {close(); window.animeTakvimi?.openDetail(item.id);}}>
                {item.image ? <img src={item.image} alt="" loading="lazy" onError={event => {event.currentTarget.hidden = true;}}/> : <span className="experience-reminder-poster-fallback"><Bell size={20}/></span>}
                <span><strong>{item.title}</strong><small>{item.time} · {elapsed ? "Planlanan saat geçti" : "Türkiye saati"}</small></span>
              </button>
              <button type="button" className={`experience-reminder-toggle${active ? " is-active" : ""}`} aria-label={`${item.title} hatırlatmasını ${active ? "kapat" : "aç"}`} aria-pressed={active} disabled={snapshot.libraryLoading || snapshot.blocked} onClick={() => onChange(current => ({reminders: current.reminders.includes(item.id) ? current.reminders.filter(id => id !== item.id) : [...current.reminders, item.id]}))}>{active ? <BellRing size={17}/> : <Bell size={17}/>}</button>
            </article>;
          }) : <div className="experience-reminder-empty"><Bell size={29}/><h3>Bugün sakin bir gün.</h3><p>Listene eklediğin, yayın saati açıklanmış animeler burada görünür.</p><button type="button" onClick={() => {close(); window.animeTakvimi?.navigate("schedule");}}>Yayın takvimine göz at</button></div>}
        </div>
        <section className="experience-notification-optin" aria-labelledby="experience-notification-heading"><span className="experience-optin-icon">{enabled && permission === "granted" ? <BellRing size={21}/> : <BellOff size={21}/>}</span><div><h3 id="experience-notification-heading">Yayın zamanı haberin olsun</h3><p>Hatırlatmalar site açıkken çalışır. İşaretlediğin animenin planlanan yayın saatinde cihaz bildirimi gösterilir.</p></div>
          <button type="button" className="experience-optin-button" onClick={() => {void enableNotifications();}} disabled={requesting || permission === "unsupported" || (permission === "denied" && !enabled)}>{requesting ? "İzin bekleniyor…" : enabled ? "Hatırlatmaları kapat" : "Bildirimleri aç"}</button>
          {permission === "unsupported" && <p className="experience-notification-help">Bu tarayıcı cihaz bildirimlerini desteklemiyor. Yayınlarını bu panelden takip edebilirsin.</p>}
          {permission === "denied" && <p className="experience-notification-help">Bildirim izni kapalı. Açmak için tarayıcının bu siteye ait izin ayarlarını kullan.</p>}
          {feedback && <p className="experience-notification-help" role="status">{feedback}</p>}
          <small className="experience-notification-footnote">Saatler haftalık yayın planıdır; sonradan değişebilir. Site kapalıyken bildirim gönderilmez.</small>
        </section>
        <section className="experience-theme-setting"><Moon size={20}/><div><h3 id="experience-theme-label">Koyu tema</h3><p>Daha rahat bir gece deneyimi.</p></div><button type="button" role="switch" aria-checked={theme === "dark"} aria-labelledby="experience-theme-label" className="experience-theme-switch" onClick={toggleTheme}><span aria-hidden="true"/></button></section>
        <section className="experience-install"><span className="experience-install-icon">{installed ? <Check size={20}/> : <Download size={20}/>}</span><div><h3>{installed ? "Anime Takvimi hep yanında" : "Her zaman yanında."}</h3><p>{installed ? "Uygulama bu cihazda kullanıma hazır." : "Anime Takvimi’ni ana ekranına ekle."}</p></div>{!installed && <button type="button" onClick={() => {void install();}} aria-expanded={installHelp}>{promptReady ? "Uygulamayı ekle" : "Nasıl eklerim?"}</button>}
          {installHelp && <p className="experience-install-help">Telefonda tarayıcının <strong>Paylaş</strong> veya <strong>⋮</strong> menüsünden <strong>Ana ekrana ekle</strong> seçeneğini kullan. Bilgisayarda adres çubuğundaki yükleme simgesine veya tarayıcı menüsündeki uygulama yükleme seçeneğine bak. Seçenek görünmüyorsa siteyi yer imlerine ekleyebilirsin.</p>}
        </section>
      </div>
    </dialog>
  </>;
}
