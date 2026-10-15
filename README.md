# Anime Takvimi

Türkçe anime keşif sitesi: MyAnimeList sezon kataloğu, haftalık yayın saatleri, kişisel izleme listesi, ChatGPT ile üyelik ve yönetici paneli. Next/React arayüzü Vinext üzerinden Cloudflare Worker üzerinde çalışır; üyelik ve kişisel listeler Cloudflare D1'de, profil fotoğrafları özel R2 alanında tutulur.

**Yayımlama durumu:** Bu üyelikli sürüm başarıyla derlendi. Kaynak aktarımı, oturumdaki terminal onayı kısıtı ve desteklenen alternatif bağlantıdaki DNS sorunu nedeniyle tamamlanamadı; site henüz yayında değildir. Bu paket kaynak projeyi ve gerçek SQL migrationlarını içerir.

**Tamamlanan doğrulamalar:** Bu sürümün TypeScript kontrolü, production build'i ve gerçek migrationlar üzerinde 42 üyelik/fotoğraf güvenlik testi geçti. Kayıtlı 100 gerçek anime verisinin provider → istemci liste kaydı → sunucu doğrulaması zinciri de geçti. Yerel D1 başlatılırken Windows Workers runtime'ı çöktüğü için çalışan site üzerindeki giriş ve tarayıcı kontrolleri doğrulanamadı. Gerçek ChatGPT oturumuyla canlı üyelik kurulumu henüz yapılmadı.

## Siteyi kullanma

- **Keşfet / Sezonlar:** Sezon seçimi, başlık arama, tür ve format filtresi, sıralama, kart/liste görünümü.
- **Yayın Takvimi:** Yayınını sürdüren ve saat bilgisi bulunan animelerin haftalık akışı. Bilinen saat dilimleri Türkiye saatine çevrilir; gün ve tarih `Europe/Istanbul` üzerinden hesaplanır. Kaynak kesin bölüm numarası vermediği için takvim haftalık yayın saatini gösterir.
- **Listem:** Kaydetme, izlenen bölüm sayısı ve takip işaretleri. Toplam bölüm sayısı bilinmiyorsa ilerleme yüzdesi gösterilmez. Takip işaretleri cihaz bildirimi göndermez.
- **Hesap:** ChatGPT ile giriş, üyelik tamamlama, profil ve hesaba bağlı liste.
- **Admin Paneli:** Yöneticiye özel üye arama, sayfalama, etkinleştirme ve askıya alma. Yönetici kendi hesabını veya başka bir yönetici hesabını askıya alamaz.

Anime adları, posterler, puanlar ve sezon bilgileri `public/site/data-provider.js` tarafından **MyAnimeList / Tenrai** kaynağından alınır. Bu veri kaynağı, ziyaretçinin MyAnimeList hesabına bağlanmaz; bu sitedeki liste MyAnimeList hesabındaki listeyle eşitlenmez. Katalog önbelleği altı saattir. Bağlantı sorunu olduğunda yalnızca istenen sezona ait önbellek kullanılabilir ve arayüz bunu belirtir.

## Gereksinimler ve yerel çalıştırma

- Node.js **22.13.0 veya üzeri**.
- Node.js ile gelen **npm**; bağımlılık sürümleri `package-lock.json` ile sabitlenir.
- Bağımlılık kurulumu için paket kayıt sunucusuna ağ erişimi.
- Üyelik için Worker ortamına bağlı bir **D1 veritabanı**, `DB` bağlantısı ve uygulanmış migrationlar.

Proje kökünde:

```sh
npm --version
npm ci
npm run dev
```

Kaynakla birlikte gelen `package-lock.json` dosyasını koru. `npm ci` bu kilit dosyasındaki sürümlerle tekrarlanabilir kurulum yapar. Kurulum sırasında farklı paket yöneticilerini aynı anda çalıştırma.

Portable geliştirme profili Windows, macOS ve Linux'ta çalışır. Geliştirme sunucusu varsayılan olarak loopback üzerinde 5173 portunu kullanır; erişim adresi terminalde gösterilir. Farklı bir port gerektiğinde:

```sh
npm run dev -- --port 5174
```

Portable profilde `/signin-with-chatgpt?return_to=/` yolu yalnızca yerel geliştirmeye özel sabit bir test kimliği sağlar. Bu kimlik gerçek bir ChatGPT oturumu veya üretim yöneticisi değildir. Mock kimlik üretim build'ine dahil edilmez; yönetilen Linux profilinde de kapalıdır.

Siteyi dosyaya çift tıklayarak açmak üyelik işlevlerini çalıştırmaz. Bu önizlemede Giriş yap ve Üye ol düğmeleri, çevrimiçi bağlantının gerektiğini açıklayan pencereyi açar. Üyelik ve admin işlemleri aynı origin üzerinde çalışan `/api/...` sunucu yollarına ihtiyaç duyar.

## Profil fotoğrafı

Profilim alanı oturum doğrulanana kadar gizlidir. Giriş yapan üyede yüklenmiş fotoğraf görünür; fotoğraf yoksa veya yüklenemiyorsa adının baş harfleri gösterilir. Üyeliği henüz tamamlanmamış doğrulanmış kullanıcı bu düğmeyle kayıt adımını açar. Mobilde fotoğraf üst hesap alanında gösterilir.

Aktif üye Profilim penceresinden PNG, JPEG veya WebP fotoğrafı seçip kaydedebilir; sınır 2 MiB'dır. ChatGPT'nin profil fotoğrafı kimlik yanıtında sağlanmadığından otomatik olarak alınmaz. Fotoğraf dosyaları `BUCKET` R2 bağlantısında, sahiplik ve sürüm kaydı `member_avatars` tablosunda saklanır. Fotoğraf okuma ve yazma işlemleri yalnızca aktif hesabın kendi kimliğine izin verir; harici e-posta/avatar hizmeti kullanılmaz.

## ChatGPT girişi ve yönetici hesabı

Giriş ve çıkış Sites platformunun `/signin-with-chatgpt` ve `/signout-with-chatgpt` yollarıyla, normal üst seviye sayfa geçişi üzerinden yapılır. Uygulama şifre toplamaz ve bu yolları `fetch` ile çağırmaz. Platformun doğruladığı kullanıcı kimliği kalıcı hesap anahtarıdır; e-posta ve görünen ad kimlik hizmetinden alınır.

Üyelik formu yalnızca **2–40 karakterlik görünen adı** gönderir. E-posta giriş yapılan hesaptan gelir; tarayıcıdan e-posta veya rol göndererek yetki kazanılamaz. Yeni üyeler otomatik olarak `member` rolüyle oluşturulur.

Yönetici kurulumu:

1. Sites'in **RuntimeEnv** sunucu ortamında `ADMIN_EMAIL` değerini yönetici olacak hesabın doğrulanmış e-posta adresine ayarla. Bu değer sunucu sırrı olmalıdır; `NEXT_PUBLIC_` ile başlayan bir değişken kullanma.
2. Yönetici olacak kişi aynı doğrulanmış ChatGPT hesabıyla giriş yapıp **Üyeliği tamamla** adımını bitirsin.
3. Yapılandırılan e-postayla eşleşen ilk hesap, D1 içindeki `admin_owner` kaydını alır ve yönetici olur. Yönetici paneli bu sunucu kaydına göre açılır.

Yapılandırma örneği yalnızca yer tutucudur:

```dotenv
ADMIN_EMAIL=yonetici@example.invalid
```

Gerçek adresi kaynak dosyalarına, istemci JavaScript'ine, SQL migrationlarına veya Git'e yazma. `.env.example` boş bir anahtar şablonudur. Yerel Worker ortamında kullanılacak gerçek değer de Git dışında tutulmalıdır.

`ADMIN_EMAIL` sonradan değiştirilse bile mevcut `admin_owner` kaydı otomatik olarak başka bir hesaba aktarılmaz. Yönetici sahipliğini değiştirmek ayrı, yetkili bir veritabanı işlemi gerektirir.

## Kişisel liste ve hesap kapsamı

Misafir listesi tarayıcıda `anime-takvimi-mal-v1` anahtarında tutulur. Giriş yapmış bir üyenin cihaz önbelleği `anime-takvimi-mal-v1:<kullanıcı-id>` anahtarına ayrılır; sunucu listesi D1'de o kullanıcının kimliğine bağlıdır.

- Giriş yapmak misafir listesini hesaba otomatik eklemez. Başka bir kullanıcının cihaz önbelleği de yeni hesaba taşınmaz.
- Hesap listesi yüklenemediğinde yalnızca o hesaba ait cihaz önbelleği gösterilir.
- Kişisel değişiklikler 700 ms gecikmeyle ve sırayla sunucuya yazılır. Kaydetme başarısızsa cihaz kopyası korunur ve yeniden deneme düğmesi gösterilir.
- Kaydedilenler, takip işaretleri, ilerleme kayıtları ve anime metaverilerindeki **farklı anime kimliklerinin birleşimi en fazla 500** olabilir. Liste isteğinin toplam boyut sınırı **1 MiB**'dır.
- Askıya alınan üyeler hesap listesinde değişiklik yapamaz. Üyelik ve admin yetkisi sunucu tarafında kontrol edilir; menüyü gizlemek tek başına yetki kontrolü olarak kullanılmaz.

## D1 ve migration kurulumu

`vite.config.ts` Worker bağlantılarını doğrudan tanımlar: D1 veritabanı `DB`, profil fotoğraflarının R2 alanı `BUCKET` adıyla kullanılır. Ayrı bir hosting manifesti gerekmez. Şema `db/schema.ts` içindedir; üyeler, yönetici sahipliği, kişisel listeler ve admin işlem kayıtlarını kapsar. Üretimde bu kaynaklar gerçekten oluşturulmalı ve Worker ortamına bağlanmalıdır. Bu yapılandırma, Sites'in sağladığı ChatGPT giriş altyapısının yerini almaz.

İlk SQL migration pakette hazırdır: `drizzle/0000_worried_anita_blake.sql`. Şemayı değiştirdiğinde yeni migration üret:

```sh
npm run db:generate
```

Ardından build al. Bu adım Worker yapılandırmasını `dist/server/wrangler.json` altında üretir:

```sh
npm run build
```

Yerel D1'e, `drizzle/` altındaki her bekleyen SQL dosyasını sırasıyla uygula. Aşağıdaki `<MIGRATION_DOSYASI>` bölümünü gerçek dosya adıyla değiştir:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/<MIGRATION_DOSYASI>.sql
```

Yerel veritabanı yolu `.wrangler/state` olmalıdır; Wrangler sürümlü alt dizinleri kendisi oluşturur. Uygulanmış migrationları yeniden çalıştırma. `--local` komutu yalnızca önizleme veritabanını değiştirir. Üretim SQL migrationları ayrıca Sites'in D1 migration adımıyla uygulanmalıdır. Bağlantı tanımı değişirse Worker yapılandırmasını yeniden build et.

## Kontroller ve build önizlemesi

Üyelik ve yönetici kurallarının testleri:

```sh
node --test tests/membership.test.mjs tests/avatar.test.mjs
```

Projede `npm test` betiği tanımlı değildir. Test dosyası Node'un yerleşik test çalıştırıcısıyla açılır; hesap kaydı, yönetici sahipliği, yetki kontrolleri, liste doğrulaması, boyut sınırları ve admin işlemlerini kapsar.

Diğer kontroller:

```sh
npm run lint
npm run build
npm run start
```

`npm run start` build edilmiş Worker'ı yerel Wrangler üzerinden çalıştırır; üretime yayımlamaz ve gerçek ChatGPT girişini simüle etmez. Önce build ve yerel migration adımlarını tamamla. Farklı bir build önizleme portu için `npm run start -- --port 8788` kullanılabilir.

Sites eklentisiyle çalışırken onun kurulum, önizleme, build ve yayımlama adımlarını kullan. Yerel profil seçimi `.sites-runtime/` altında tutulur. Yönetilen Linux profili build için Bash ve yardımcı araçlar kullanır; portable profil doğrudan Vinext'i çalıştırır. `.sites-runtime/`, `.wrangler/`, `node_modules/` ve geçici önizleme dosyaları kaynak pakete veya Git'e eklenmemelidir.

## Üretime çıkış için tamamlanacaklar

1. Bağımlılıklar kurulmalı; üyelik testleri ve production build başarılı olmalı.
2. Sites projesinde `DB` D1 ve `BUCKET` R2 bağlantıları, `vite.config.ts` içindeki adlarla oluşturulup Worker ortamına bağlanmalı; `0000` ve `0001` dahil bütün bekleyen SQL migrationları sırayla uygulanmalı.
3. `ADMIN_EMAIL` Sites RuntimeEnv içinde sunucu sırrı olarak ayarlanmalı.
4. ChatGPT kimliğini doğrulayan Sites giriş altyapısı etkin olmalı. Uygulamanın kullandığı kimlik üstbilgilerini platform sağlamalı.
5. Projenin mevcut **private** erişim politikası korunmalı. Uygulama üyeliği, Sites'in ziyaretçi erişim izninden ayrıdır. Daha geniş bir kullanıcı kitlesi için Sites audience/erişim ayarı ayrıca düzenlenmelidir; üyelik formunun bulunması siteyi herkese açmaz.
6. Kaynak aktarımı ve Sites yayımlama işlemi tamamlanmalı; GitHub'a kaynak göndermek siteyi canlı yayına almaz. Gerçek oturumla üyelik, yönetici sahipliği, liste kaydı, askıya alma ve çıkış akışları yayında doğrulanmalı.

## Dosya düzeni

- `app/page.tsx`, `app/anime-markup.ts`: Site sayfası ve arayüz yapısı.
- `app/api/`: Hesap, kayıt, kişisel liste ve admin HTTP yolları.
- `app/chatgpt-auth.ts`: Platformun doğruladığı ChatGPT kimliği ve giriş/çıkış bağlantıları.
- `public/site/app.js`: Anime kataloğu, takvim, kişisel liste ve hesap kapsamı.
- `public/site/membership.js`: Üyelik arayüzü, hesap listesi eşitlemesi ve admin paneli.
- `public/site/data-provider.js`: MyAnimeList / Tenrai verileri ve sezon önbelleği.
- `lib/membership.mjs`, `lib/account-route.ts`: Sunucu üyelik kuralları ve HTTP yardımcıları.
- `db/schema.ts`, `drizzle/`: D1 şeması ve migrationlar.
- `tests/membership.test.mjs`: Sunucu kurallarının testleri.
