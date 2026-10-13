# DHL iade etiketleri

Tamamlananlar listesindeki **İADE Etiketi Oluştur** işlemi, teslim edilmiş sipariş için DHL `createReturnOrder` servisini çağırır. Mevcut etiket varsa aynı fiş açılır. Fiş linki ve iade kodu siparişte saklanır; çıkış gönderisinin teslim durumu ve takip numarası korunur.

- **İade** sekmesi: iade etiketi açılan siparişler ve DHL durumu 7 / Geri Geliyor olan gönderiler.
- **Kargolandı → Geri Geliyor** filtresi: geri dönen gönderiler. Sorun filtresi 6 ve 8 durumlarını içerir.
- İade gönderisi tahsilatsız, alıcı (Gazi) ödemelidir. SMS tercihleri kapalıdır.
- Etiket oluşturulması fiziksel teslim alma veya para iadesi anlamına gelmez.

## Canlı bileşenler

`supabase/migrations/20261013001000_gazi_return_labels.sql` kayıt alanlarını ve yalnızca service_role tarafından çağrılabilen kilitli işlemi kurar. `supabase/functions/gazi-return-label/index.ts`, JWT ve Gazi yönetici yetkisini doğrular. Müşteri/satıcı hesaplarına etiket oluşturma yetkisi verilmez.

Sunucu, mevcut `gazi_live.settings` içindeki `gateway` bağlantısını kullanır. n8n `GAZI_PLPGSQL_CANLI_GATEWAY` akışındaki iade yolu yalnızca tanımlı iade referanslarına, kapıda tahsilat sıfır ve Gazi ödemesi koşullarıyla izin verir. Anahtar ve DHL kimlik bilgileri istemciye aktarılmaz.

İşlem kilidi tekrar isteği engeller. DHL yanıtı belirsiz kaldığında yeni kayıt açılmaz; `gazi_iade_islemleri` kaydı ve DHL tarafı kontrol edilmelidir. Kalıcı etiket bağlantısı olmayan belirsiz işlemler otomatik tekrar gönderilmez.

## Doğrulama

Node.js 24 ile `node tests/return-label.test.mjs`: müşteri telefonu/paket doğrulaması, mevcut etiketin yeniden kullanılması, zaman aşımının belirsiz kayda dönüşmesi ve yönetici erişim kontrolü.
