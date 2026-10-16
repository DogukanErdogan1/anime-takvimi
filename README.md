# Anime Takvimi

Türkçe anime keşif sitesi. Sezon kataloğu MyAnimeList/Tenrai, yatay ana sayfa görselleri AniList üzerinden alınır. Next/React arayüzü Vinext ve Cloudflare Workers kullanır. E-posta/şifre hesapları, oturumlar ve kişisel listeler D1'de; profil fotoğrafları ve yönetici banner yüklemeleri R2'de saklanır.

Bu sürüm yerel geliştirme içindir; bu değişiklikler canlı bir adrese yayımlanmamıştır.

## Localhostta açma

Windows'ta **Siteyi-Ac.cmd** dosyasına çift tıklayabilirsin. Yanıt veren site varsa onu kullanır; yoksa sunucuyu başlatır ve hazır olunca tarayıcıyı açar. Bağlantı kontrolü süre sınırlıdır ve bekleme durumu ekranda gösterilir. Eski sunucu yanıt vermiyorsa kısa bir beklemenin ardından boş bir portta yeni oturum açar. 5173 portu kullanımda olduğunda başka bir boş yerel port seçer ve doğru adresi gösterir. Yeni başlatılan sunucunun penceresini site açıkken açık tut.

Node.js 22.13 veya üzeri ile proje klasöründe:

```sh
npm ci
npm run db:migrate
npm run dev
```

Ardından [http://localhost:5173](http://localhost:5173) adresini aç. Kurulumdan sonra tekrar açarken yalnız `npm run dev` yeterli. Yeni migration eklenen güncellemelerden sonra `npm run db:migrate` çalıştır.

Yerel D1 ve R2 verileri `.wrangler/state` içinde tutulur. Bu klasörü silme ve Git'e gönderme. Yerel yapılandırmanın veritabanı adı/kimliği, `vite.config.ts` ile `wrangler.local.jsonc` arasında aynı kalmalıdır. Gerçek sunucuya taşıma sırasında D1/R2 bağlantıları ayrıca yapılandırılır ve SQL migrationları hedef veritabanına uygulanır.

## Hesaplar

- [Giriş yap](http://localhost:5173/giris): E-posta ve şifre.
- [Üye ol](http://localhost:5173/uye-ol): Görünen ad, e-posta, 12–128 karakter şifre ve şifre tekrarı. Kayıt sonrasında otomatik giriş yapılır.
- Oturum 7 gün sürer. Çıkış işlemi sunucudaki oturumu iptal eder. Şifre tarayıcı depolamasına veya düz metin olarak veritabanına yazılmaz; rastgele salt ile scrypt kullanılır.
- Oturum çerezi HttpOnly ve SameSite=Lax'tır; HTTPS'te Secure kullanılır. Canlı kullanım HTTPS üzerinden yapılmalıdır.
- Formlar aynı origin ve JSON kontrolleriyle korunur. Giriş ve kayıt deneme limitleri D1'de kalıcıdır. Hesap anahtarı rastgele oluşturulur; e-posta başka eski hesaba veya yönetici rolüne bağlanmaz.
- E-posta doğrulama ve şifre sıfırlama e-postaları bu sürümde yoktur; henüz bir e-posta gönderim hizmeti bağlanmamıştır.

Profil düğmesi yalnız girişten sonra görünür. Fotoğraf yoksa baş harfler kullanılır. Profilim ekranından PNG/JPEG/WebP fotoğrafı yüklenebilir (en fazla 2 MiB). Fotoğraf okuma/yazma yalnız aktif hesabın kendi kimliğine izin verir.

## Kendi hesabını yönetici yapma

1. Site üzerinden kendi hesabını oluştur ve giriş yap.
2. Profilim → Hesap ayarları bölümündeki **Hesap kimliği** değerini kopyala.
3. Proje klasöründe kendi terminalinden `npm run admin:local` çalıştır. Kopyaladığın kimliği gir; gösterilen hesabın sana ait olduğunu kontrol edip `EVET` yaz.
4. Siteyi yenile. Yönetim menüsü açılır.

Bu işlem yalnız yerel veritabanını değiştirir ve terminal erişimi gerektirir. E-posta adresiyle yönetici atamaz. Başka bir yönetici zaten atanmışsa sahipliği değiştirmez. Gerçek sunucuda yönetici ataması yetkili veritabanı yöneticisi tarafından aynı hesap kimliği ve sahiplik kuralıyla yapılmalıdır.

## Yatay anime görselleri

Ana sayfadaki öne çıkan anime, MAL numarasıyla AniList'teki `bannerImage` alanına eşleştirilir. Banner bulunduğunda yüklenip gösterilir; bulunamazsa mevcut poster korunur. Katalog ve takvim posterleri değiştirilmez. Başarılı sonuçlar 24 saat, bulunamayanlar 6 saat, bağlantı hataları 5 dakika önbelleğe alınır.

Yönetim → **Anime banner görseli** bölümünde MAL anime numarasını girip PNG/JPEG/WebP yükleyebilirsin (en fazla 2 MiB; önerilen boyut 1920 × 720). Özel yükleme otomatik görselden önceliklidir. **Otomatik görsele dön** özel görseli kaldırır. Bu görseller herkese açık ana sayfa için kullanılır; kişisel fotoğraflarını bu alana yükleme.

## Listeler ve takvim

Misafir listesi cihazda, üyelerin listeleri hesap kimliğine göre D1'de saklanır. Misafir listesi girişte otomatik hesaba aktarılmaz. Hesaplar birbirlerinin listelerini okuyamaz veya değiştiremez. Askıya alma oturum ve yazma erişimini sunucuda durdurur.

Sezon/tür/format filtreleri, arama, sıralama ve kart/liste görünümü bulunur. Yayın saatleri biliniyorsa Türkiye saatine çevrilir. Takip işaretleri cihaz bildirimi göndermez. Sitedeki liste MyAnimeList hesabıyla eşitlenmez.

## Kontroller

```sh
npm test
npx tsc --noEmit
npm run build
```

Testler gerçek SQL migrationlarıyla üyelik, oturum, liste, yetki, profil fotoğrafı ve banner kurallarını; başlatıcı testleri de mevcut sunucuyu kullanma, yanıt vermeyen bağlantıdan kurtulma, gecikmeli başlangıç ve dolu port davranışlarını sınar. Localhost üzerinde gerçek Workers scrypt, kayıt/giriş/çıkış, çerez ve kişisel liste akışı ayrıca doğrulanmıştır.

Kaynak pakete `.env`, `.dev.vars`, `.wrangler`, `node_modules`, yerel hesaplar veya parolalar eklenmemelidir. GitHub'a yalnız kaynak dosyalarını gönder.
