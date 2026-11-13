'use client';
import {useEffect, useRef, useState} from 'react';
import {BellRing} from 'lucide-react';

type Config = {available: boolean; publicKey: string | null; active: boolean; bindingId: string | null};
class PushError extends Error {constructor(message: string, readonly status: number) {super(message);}}
async function request<T>(options: RequestInit = {}): Promise<T> {
  const controller = new AbortController(), abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', abort, {once: true});
  const timeout = window.setTimeout(abort, 15000);
  try {
    const response = await fetch('/api/push', {credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal, headers: {'Content-Type': 'application/json', Accept: 'application/json'}});
    const data = await response.json() as {error?: {message?: string}};
    if (!response.ok) throw new PushError(data.error?.message || 'Bildirim ayarı kaydedilemedi.', response.status);
    return data as T;
  } finally {window.clearTimeout(timeout); options.signal?.removeEventListener('abort', abort);}
}
function decodeKey(value: string) {return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));}
async function readyWorker() {
  let timeout = 0;
  try {return await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => {timeout = window.setTimeout(() => reject(new Error('Bildirim hizmeti hazırlanamadı. Biraz sonra yeniden dene.')), 15000);})]);}
  finally {window.clearTimeout(timeout);}
}

export default function BackgroundPush({scope, onActive}: {scope: string; onActive: (active: boolean) => void}) {
  const [config, setConfig] = useState<Config | null>(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [supported, setSupported] = useState(false);
  const lifecycle = useRef({alive: true, controller: null as AbortController | null});
  useEffect(() => {const current = lifecycle.current; current.alive = true; return () => {current.alive = false; current.controller?.abort();};}, []);
  useEffect(() => {
    let alive = true, sequence = 0, controller: AbortController | null = null;
    setSupported(window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
    const refresh = async () => {
      const current = ++sequence; controller?.abort(); controller = new AbortController();
      try {const data = await request<Config>({signal: controller.signal}); if (alive && current === sequence) {setConfig(data); onActive(data.active);}}
      catch {if (alive && current === sequence) {setConfig(null); onActive(false);}}
    };
    const changed = (event: StorageEvent) => {if (event.key === 'anime-push-change') void refresh();};
    const visible = () => {if (!document.hidden) void refresh();};
    window.addEventListener('storage', changed); window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible);
    void refresh();
    return () => {alive = false; controller?.abort(); window.removeEventListener('storage', changed); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible);};
  }, [scope, onActive]);

  function changed(active: boolean) {
    onActive(active);
    try {localStorage.setItem('anime-push-change', `${Date.now()}:${active}`);} catch { /* The current tab still updates. */ }
  }
  async function toggle() {
    if (busy || !config) return;
    const current = lifecycle.current;
    if (current.controller) return;
    const controller = new AbortController(); current.controller = controller;
    setBusy(true); setMessage('');
    try {
      if (config.active) {
        await request({method: 'POST', signal: controller.signal, body: JSON.stringify({action: 'unsubscribe'})});
        if (!current.alive) return;
        setConfig({...config, active: false, bindingId: null}); changed(false); setMessage('Bu cihazda arka plan bildirimleri kapatıldı.');
      } else {
        if (!supported || !config.available || !config.publicKey) throw new Error('Bu tarayıcıda arka plan bildirimleri kullanılamıyor.');
        if (await Notification.requestPermission() !== 'granted') throw new Error('Bildirim izni verilmedi. Tarayıcının site izinlerini kontrol et.');
        if (!current.alive) return;
        await navigator.serviceWorker.register('/sw.js', {scope: '/'});
        if (!current.alive) return;
        const worker = await readyWorker(), key = decodeKey(config.publicKey);
        if (!current.alive) return;
        let subscription = await worker.pushManager.getSubscription();
        if (!current.alive) return;
        if (subscription) {
          const oldKey = subscription.options.applicationServerKey;
          if (!oldKey || [...new Uint8Array(oldKey)].join(',') !== [...key].join(',')) {await subscription.unsubscribe(); subscription = null;}
        }
        if (!current.alive) return;
        if (!subscription) subscription = await worker.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: key});
        if (!current.alive) return;
        let data: {bindingId: string};
        try {data = await request({method: 'POST', signal: controller.signal, body: JSON.stringify(subscription.toJSON())});}
        catch (error) {
          if (!current.alive) return;
          if (!(error instanceof PushError) || error.status !== 409) throw error;
          // A cleared device cookie or replaced key can leave an old provider
          // subscription. Renew it once, only from this explicit button action.
          await subscription.unsubscribe();
          subscription = await worker.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: key});
          if (!current.alive) return;
          data = await request({method: 'POST', signal: controller.signal, body: JSON.stringify(subscription.toJSON())});
        }
        if (!current.alive) return;
        setConfig({...config, active: true, bindingId: data.bindingId}); changed(true);
        setMessage('İşaretlediğin animeleri site kapalıyken de hatırlatacağız.');
      }
    } catch (error) {if (current.alive) setMessage(error instanceof DOMException ? 'Bildirim bağlantısı kurulamadı. İnternet bağlantını ve tarayıcının site bildirim izinlerini kontrol edip yeniden dene.' : error instanceof Error ? error.message : 'Bildirim ayarı kaydedilemedi.');}
    finally {current.controller = null; if (current.alive) setBusy(false);}
  }
  return <section className="at-enhancement-panel" aria-label="Arka plan bildirimleri"><h3><BellRing size={18}/>Site kapalıyken de hatırlat</h3><p>Hatırlatma işareti koyduğun animeler için bu cihazda bildirim al. Anime adı ve planlanan saat, tarayıcının bildirim servisine şifreli gönderilir.</p><button type="button" className="at-outline-button" disabled={busy || !config || (!config.active && (!config.available || !supported))} onClick={() => void toggle()}>{busy ? 'Kaydediliyor…' : config?.active ? 'Arka plan bildirimlerini kapat' : 'Arka plan bildirimlerini aç'}</button>{config && !config.available && <p>Arka plan bildirimi sunucuda henüz hazır değil.</p>}{!supported && <p>Destekleyen bir tarayıcı ve HTTPS bağlantısı gerekir. iPhone/iPad’de siteyi ana ekrana ekleyerek aç.</p>}{!config && !message && <p>Bildirim ayarı yükleniyor veya hizmete ulaşılamıyor. Siteye döndüğünde yeniden kontrol edilir.</p>}{message && <p role="status">{message}</p>}<small>Tarayıcı izni, internet bağlantısı ve açık oturum gerekir. Çıkış yaptığında bu cihazın gönderimi durur. Saatler haftalık yayın planıdır ve değişebilir.</small></section>;
}
