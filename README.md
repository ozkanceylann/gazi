# gazi

Ana sipariş hazırlama ve kargo paneli: https://gazi.ozkanceylan.uk

## İade etiketi

Tamamlananlar ekranındaki **İADE Etiketi Oluştur** düğmesiyle, teslim edilmiş bir sipariş için iade fişi hazırlanır. Fiş bağlantısı kaydedilir; sonraki tıklamalar aynı fişi açar. İade listesinde **İade Fişini Aç** ve iade kodu gösterilir.

İşlem: Gazi paneli → `gazi-return-label` (yönetici oturumu ve tekrar kayıt kilidi) → `GAZI_KARGO_SURECLERI_CANLI` içindeki `gazi_iade_olustur` webhook'u → DHL. Yalnızca düğmeye basılınca çalışır. Kargo ücreti Gazi hesabına aittir; kapıda tahsilat ve SMS kapalıdır.

Sunucu anahtarı `gazi_carrier_private.return_connection` tablosunda tutulur ve n8n'deki İade · Sunucu Anahtarını Oku düğmesinin anahtarıyla eşleşmelidir. Anahtar tarayıcıya veya repoya yazılmaz. Yeni kurulumda bu bağlantı yetkili sunucu tarafından yapılandırılmalıdır.

`gazi-siparis` PL/pgSQL paneli beklemededir. Ona ait iki Supabase cron görevi, çift yönlü otomatik sipariş senkronizasyonu ve `GAZI_PLPGSQL_CANLI_GATEWAY` kapalıdır. Ana Gazi panelinin mevcut saatlik toplu kargo güncellemesi ve token yenilemesi devam eder.

Kontroller: `node tests/return-label.test.mjs`
