# gazi

Ana sipariş hazırlama ve kargo paneli: https://gazi.ozkanceylan.uk

## Etiket okutma

Ana ekrandaki **Etiket Okut** düğmesi arka kamerayı açar. DHL paket barkodu, gönderi takip numarası, sipariş referansı veya elle girilen sipariş numarası mevcut oturumun erişebildiği kayıtlarla eşleştirilir. Tek eşleşmede sipariş detayı açılır; birden fazla eşleşmede seçim gösterilir. Okutma sipariş durumunu değiştirmez. Kamera kapanışta, arka plana geçişte veya bir barkod okunduğunda durur.

Kamera HTTPS ve kullanıcı izni gerektirir. Kamera kullanılamadığında elle numara girişi çalışır. Görüntü cihazda ZXing ile çözülür; sunucuya yalnızca arama kodu gönderilir. Sabitlenmiş `@zxing/browser` 0.1.5 dosyası ve lisansları `vendor/` altında bulunur.

Kontroller: `node tests/label-scanner.test.mjs`. Playwright kuruluyken `node tests/label-scanner-browser.cjs` kamera izin hatası, eşleşme, mobil taşma ve kamera kapanışını sahte kamera ile doğrular. Test dosyaları tarayıcıya bellekten sunulur; sunucu gerekmez.

## İade etiketi

Tamamlananlar ekranındaki **İADE Etiketi Oluştur** düğmesiyle, teslim edilmiş bir sipariş için iade fişi hazırlanır. Fiş bağlantısı kaydedilir; sonraki tıklamalar aynı fişi açar. İade listesinde **İade Fişini Aç** ve iade kodu gösterilir.

İşlem: Gazi paneli → `gazi-return-label` (yönetici oturumu ve tekrar kayıt kilidi) → `GAZI_KARGO_SURECLERI_CANLI` içindeki `gazi_iade_olustur` webhook'u → DHL. Yalnızca düğmeye basılınca çalışır. Kargo ücreti Gazi hesabına aittir; kapıda tahsilat ve SMS kapalıdır.

Sunucu anahtarı `gazi_carrier_private.return_connection` tablosunda tutulur ve n8n'deki İade · Sunucu Anahtarını Oku düğmesinin anahtarıyla eşleşmelidir. Anahtar tarayıcıya veya repoya yazılmaz. Yeni kurulumda bu bağlantı yetkili sunucu tarafından yapılandırılmalıdır.

`gazi-siparis` PL/pgSQL paneli beklemededir. Ona ait iki Supabase cron görevi, çift yönlü otomatik sipariş senkronizasyonu ve `GAZI_PLPGSQL_CANLI_GATEWAY` kapalıdır. Ana Gazi panelinin mevcut saatlik toplu kargo güncellemesi ve token yenilemesi devam eder.

Kontroller: `node tests/return-label.test.mjs`

## 15.000 TL üzeri siparişi bölme

Gazi yönetici panelinde 15.000 TL üzerindeki kayıtlar farklı renkle ve **Siparişi böl** düğmesiyle gösterilir. Ekranda her ürün satırı iki kayıttan birine atanır; iki tahsilat, paket adedi ve paket kilogramları girilir. Her kayıt en fazla 15.000 TL olabilir. Tutar toplamı ve toplam kilogram korunur; yeni paket adedi kullanıcı tarafından belirlenir. Tek ürün satırı varsa önce ürünleri ayrı satırlara düzenleyin. 30.000 TL üzerindeki siparişler ikiden fazla gönderi gerektirir; bu sürüm iki kayıt oluşturur.

Bölme atomiktir: mevcut kayıt birinci bölüm olarak kalır, ikinci kayıt ortak `tum_siparisler` kimlik sırasından oluşturulur. Her ikisi Bekleyen durumundadır ve panelde ana numara ile 1/2 veya 2/2 bağlantısı görünür. Ana siparişin özgün hali `gazi_order_splits` denetim kaydında korunur; raporlardaki toplam tahsilat değişmez. Bölme DHL çağrısı yapmaz. Çift tıklama/yanıt kaybı aynı işlem kimliğiyle tekrar kayıt oluşturmaz. Aktif DHL kaydı, etiket veya şubeye devretme varsa önce iptal gerekir.

Kurulum: `supabase/migrations/20261022194329_gazi_order_split.sql` (eşdeğer kaynak: `supabase/gazi-order-split.sql`) panel dosyalarından önce uygulanmalıdır. RPC mevcut Gazi yönetici yetkisini ve RLS'yi kullanır; satıcı hesaplarına bölme yetkisi verilmez.

Doğrulama: `node tests/order-split.test.cjs`, `node tests/order-split-db.cjs` (geliştirme bağımlılığı `@electric-sql/pglite@0.5.11`), `node tests/order-split-browser.cjs` (Playwright Chromium/WebKit). Veritabanı testi gerçek siparişlere dokunmadan yerel Postgres üzerinde çalışır.
