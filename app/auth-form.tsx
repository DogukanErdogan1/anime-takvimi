'use client';

import { FormEvent, useState } from 'react';

export function AuthForm({mode, returnTo}: {mode: 'login' | 'register' | 'logout'; returnTo: string}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const password = String(fields.get('password') || '');
    if (mode === 'register' && password !== String(fields.get('confirmation') || '')) {
      setError('Şifreler eşleşmiyor. İki alana da aynı şifreyi yaz.'); return;
    }
    setBusy(true); setError('');
    const payload = mode === 'logout' ? {} : {
      email: String(fields.get('email') || '').trim(), password,
      ...(mode === 'register' ? {displayName: String(fields.get('displayName') || '').trim()} : {})
    };
    try {
      const response = await fetch(`/api/auth/${mode}`, {method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify(payload)});
      const data = await response.json() as {error?: {message?: string}};
      if (!response.ok) { setError(data?.error?.message || 'İşlem tamamlanamadı. Yeniden dene.'); return; }
      form.reset();
      window.location.assign(returnTo);
    } catch { setError('Sunucuya bağlanılamadı. Bağlantını kontrol edip yeniden dene.'); }
    finally { setBusy(false); }
  }
  const register = mode === 'register';
  return <form className="auth-form" onSubmit={submit} aria-busy={busy}>
    {mode !== 'logout' && <>
      {register && <label>Görünen adın<input name="displayName" type="text" autoComplete="nickname" minLength={2} maxLength={40} placeholder="Seni nasıl tanıyalım?" required disabled={busy}/></label>}
      <label>E-posta adresin<input name="email" type="email" autoComplete="email" maxLength={254} placeholder="ornek@eposta.com" required disabled={busy}/></label>
      <label>Şifren<span className="auth-password"><input name="password" type={visible ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 12 : undefined} maxLength={128} placeholder={register ? 'En az 12 karakter' : 'Şifreni yaz'} required disabled={busy}/><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Şifreyi gizle' : 'Şifreyi göster'} aria-pressed={visible}>{visible ? 'Gizle' : 'Göster'}</button></span></label>
      {register && <label>Şifreni tekrar yaz<input name="confirmation" type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={128} placeholder="Şifreni doğrula" required disabled={busy}/></label>}
    </>}
    <p className="auth-error" role="alert" aria-live="polite">{error}</p>
    <button type="submit" className="primary-button auth-submit" disabled={busy}>{busy ? 'Biraz bekle…' : mode === 'logout' ? 'Çıkış yap' : register ? 'Hesabımı oluştur' : 'Giriş yap'}<span aria-hidden="true">→</span></button>
    {register && <p className="auth-note">Şifreni başka bir sitedeki hesabından farklı seçmeni öneririz.</p>}
    <noscript><p>Hesap işlemleri için tarayıcında JavaScript açık olmalı.</p></noscript>
  </form>;
}
