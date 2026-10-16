import { AuthForm } from './auth-form';
import { BrandFilter } from './brand-filter';

export function AuthScreen({mode, returnTo}: {mode:'login'|'register'|'logout';returnTo:string}) {
  const register = mode === 'register', logout = mode === 'logout';
  const other = `${register ? '/giris' : '/uye-ol'}?return_to=${encodeURIComponent(returnTo)}`;
  return <main className="auth-page">
    <BrandFilter/>
    <section className="auth-story" aria-label="Anime Takvimi">
      <a href="/" className="auth-brand" aria-label="Anime Takvimi ana sayfa"><img className="brand-logo brand-logo-on-dark" src="/site/assets/anime-takvimi-logo.png" alt="Anime Takvimi" width="2172" height="724"/></a>
      <div className="auth-story-content"><span className="auth-eyebrow">HER HİKÂYENİN BİR TAKİPÇİSİ VAR</span><h2>Bir sonraki<br/>favorin burada.</h2><p>Yeni seriler keşfet. Bölümlerini takip et.<br/>Kendi anime dünyanı oluştur.</p><div className="auth-preview" aria-hidden="true"><span>İZLEME LİSTEM</span><div><i>01</i><b>Yeni hikâyelere yer aç<small>Keşfet · Kaydet · İzle</small></b><em>✦</em></div><div><i>02</i><b>Kaldığın yeri hatırla<small>Her bölümde bir adım daha</small></b><em>✓</em></div><div><i>03</i><b>Favorilerini yanında tut<small>Sana ait bir koleksiyon</small></b><em>♡</em></div></div></div>
      <p className="auth-story-footer">Yeni hikâyeler, yeni favoriler.</p>
    </section>
    <section className="auth-main"><a href="/" className="auth-back">← Keşfetmeye dön</a><div className="auth-card"><span className="auth-eyebrow">{logout ? 'GÖRÜŞMEK ÜZERE' : register ? 'HİKÂYENE BAŞLA' : 'TEKRAR HOŞ GELDİN'}</span><h1>{logout ? 'Çıkış yap' : register ? 'Aramıza katıl.' : 'Kaldığın yerden devam.'}</h1><p className="auth-description">{logout ? 'Hesabından çıkmak istediğine emin misin? Listen hesabında saklanmaya devam eder.' : register ? 'Kendi listeni oluşturmak için birkaç bilgi yeterli.' : 'Anime listene ve takip ettiğin serilere ulaş.'}</p><AuthForm mode={mode} returnTo={returnTo}/>{!logout && <p className="auth-switch">{register ? 'Zaten bir hesabın var mı?' : 'Henüz hesabın yok mu?'} <a href={other}>{register ? 'Giriş yap' : 'Üye ol'}</a></p>}{logout && <a className="auth-cancel" href="/">Vazgeç, sitede kal</a>}</div><p className="auth-bottom">Anime Takvimi · Kendi ritminde keşfet.</p></section>
  </main>;
}
