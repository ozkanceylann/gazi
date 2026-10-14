function parseCargoWeights(value, count, repeatSingle = true) {
  count = Number(count);
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error("Paket adedi 1–100 olmalı.");
  let raw = String(value ?? "").replace(/kg/gi, "").trim();
  if (raw.startsWith("[")) {
    let items; try { items = JSON.parse(raw); } catch { throw new Error("KG listesi geçersiz."); }
    if (!Array.isArray(items) || !items.length || items.some(x => !["string","number"].includes(typeof x))) throw new Error("KG listesi geçersiz.");
    raw = items.join("+");
  }
  if (!raw) throw new Error("Her paket için KG yazın. Örnek: 5+10+5+6");
  const plus = raw.includes("+");
  let parts = plus ? raw.split("+") : count === 1 ? [raw] : raw.split(/[,|/;\s]+|(?<=\d)-(?=\d)/);
  parts = parts.map(part => part.trim());
  if (parts.some(part => !/^\d+(?:[.,]\d+)?$/.test(part))) throw new Error("KG bilgisi geçersiz. Paketleri + ile ayırın.");
  let weights = parts.map(part => Number(part.replace(",", ".")));
  if (weights.some(kg => !Number.isFinite(kg) || kg <= 0)) throw new Error("Paket kilogramları sıfırdan büyük olmalı.");
  // A historical single weight applied to every parcel. Keep that interpretation on reads.
  if (!plus && repeatSingle && weights.length === 1 && count > 1) weights = Array(count).fill(weights[0]);
  if (weights.length !== count) throw new Error("KG sayısı paket adediyle aynı olmalı. Örnek: 5+10");
  return weights;
}
return $input.all().map((item, index) => {
  const defaults = {
    siparis_alan_isim:"", siparis_alan_numara:"", musteri_ad_soyad:"",
    musteri_telefon:"", adres:"", Sehir:"", ilce:"", urunler:[],
    toplam:"", odeme_yontemi:"Belirtilmemiş", notlar:"",
    Siparis:"Hayır", firma:"", kargo_adet:"", kargo_kg:""
  };
  const raw = item.json.output ?? item.json.data ?? item.json.text ?? item.json.message ?? item.json;
  let parsed;
  let parseError = "";
  try {
    parsed = typeof raw === "string"
      ? JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""))
      : raw;
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON bir nesne olmalı");
    if (!["Siparis","siparis","musteri_ad_soyad","musteri_ad_soyadi","musteri_telefon","urunler","ürünler"].some(k => k in parsed)) {
      throw new Error("Beklenen sipariş alanları yok");
    }
  } catch (error) {
    parseError = error.message;
    parsed = {};
  }
  const aliases = {musteri_ad_soyadi:"musteri_ad_soyad",sehir:"Sehir","şehir":"Sehir",il:"Sehir","ürünler":"urunler",urun:"urunler",siparis:"Siparis"};
  for (const [from,to] of Object.entries(aliases)) {
    if (parsed[from] != null && (parsed[to] == null || parsed[to] === "")) parsed[to] = parsed[from];
  }
  const data = {...defaults,...parsed};
  for (const field of Object.keys(defaults).filter(k => k !== "urunler")) {
    data[field] = data[field] == null ? defaults[field] : String(data[field]).trim();
  }
  const phone = value => {
    const s = String(value ?? "");
    if (s.includes("@") && !s.endsWith("@s.whatsapp.net")) return "";
    let digits = s.split("@")[0].replace(/\D/g,"");
    if (digits.length === 12 && digits.startsWith("90")) digits=digits.slice(2);
    if (digits.length === 11 && digits.startsWith("0")) digits=digits.slice(1);
    return /^5\d{9}$/.test(digits) ? digits : "";
  };
  const inputPhone = data.musteri_telefon;
  data.musteri_telefon = phone(inputPhone);
  const webhook = $("MESAJ_HAZIRLA").item.json;
  const sender = phone(webhook._sender_phone);
  data.siparis_alan_numara = sender ? "0"+sender : "";
  data.Sehir = data.Sehir.toLocaleUpperCase("tr-TR");
  data.ilce = data.ilce.toLocaleUpperCase("tr-TR");
  const productInput = data.urunler;
  if (Array.isArray(productInput)) {
    if (productInput.some(p => p != null && typeof p === "object")) parseError ||= "Ürünler metin dizisi olmalı";
    data.urunler = productInput.filter(p => typeof p === "string" || typeof p === "number").map(p => String(p).trim()).filter(Boolean);
  } else if (typeof productInput === "string") {
    data.urunler = productInput.split(/\r?\n|[•●]/).map(p=>p.trim()).filter(Boolean);
  } else {
    parseError ||= "Ürünler metin veya metin dizisi olmalı";
    data.urunler = [];
  }
  // Explicit payment instructions override only the collection amount.
  const paymentText=String(webhook._message_text||"").toLocaleLowerCase("tr-TR");
  const freeExchange=/(?:ücretsiz|ucretsiz|bedelsiz|ödemesiz|odemesiz)\s+(?:değişim|degisim)/i.test(paymentText) || /(?:^|[^a-zçğıöşü])(?:değişim|degisim)(?=$|[^a-zçğıöşü])/i.test(paymentText) && !/(?:ücretli|ucretli|fiyat farkı|fiyat farki|ek ödeme|ek odeme)/i.test(paymentText);
  const freeProduct=/(?:^|[^a-zçğıöşü])(?:bedelsiz|ödemesiz|odemesiz)(?=$|[^a-zçğıöşü])/i.test(paymentText);
  const noCollection=freeExchange || freeProduct || /(?:^|[^a-zçğıöşü])eft(?=$|[^a-zçğıöşü])/i.test(paymentText);
  if(noCollection){
    data.toplam="0";
    data.odeme_yontemi=/(?:^|[^a-z])eft(?=$|[^a-z])/i.test(paymentText) ? "EFT" : "Bedelsiz";
    const originalNotes=data.notlar;
    const priceMissing=/Eksik bilgi\s*[–-]\s*fiyat(?:\s*\([^)]*\))?(?=\s*(?:[.\n]|$))/i.test(originalNotes);
    data.notlar=originalNotes.replace(/Eksik bilgi\s*[–-]\s*fiyat(?:\s*\([^)]*\))?\s*\.?\s*/gi,"").trim();
    const priceOnly=priceMissing && !/Eksik bilgi\s*[–-]/i.test(data.notlar);
    if(data.Siparis.toLocaleLowerCase("tr-TR")==="hayır"&&(priceOnly||freeExchange)&&!parseError&&data.musteri_ad_soyad&&data.musteri_telefon&&data.urunler.length&&data.adres&&data.Sehir&&data.ilce&&!/Eksik bilgi\s*[–-]\s*(?!fiyat)/i.test(data.notlar)){
      data.Siparis="Evet";
    }
  }
  if (data.kargo_kg) {
    try { data.kargo_kg = parseCargoWeights(data.kargo_kg, data.kargo_adet, false).join("+"); }
    catch (error) { parseError ||= error.message; }
  }
  const status = data.Siparis.toLocaleLowerCase("tr-TR");
  const missing = [];
  if (status === "evet") data.Siparis = "Evet";
  else if (status === "hayır" || status === "hayir") data.Siparis = "Hayır";
  else { data.Siparis = "Hayır"; parseError ||= "Siparis alanı Evet veya Hayır olmalı"; }
  if (!data.musteri_ad_soyad) missing.push("müşteri adı");
  if (!data.musteri_telefon) missing.push(inputPhone ? "geçersiz müşteri telefonu" : "müşteri telefonu");
  if (!data.urunler.length) missing.push("ürün bilgisi");
  if (!data.toplam) missing.push("fiyat");
  if (missing.length) {
    data.Siparis = "Hayır";
    const reason = "Eksik bilgi – " + missing.join(", ");
    data.notlar = [data.notlar,reason].filter(Boolean).join("\n");
  }
  if (!data.odeme_yontemi) data.odeme_yontemi = "Belirtilmemiş";
  data.teknik_hata = Boolean(parseError);
  data.teknik_hata_detay = parseError;
  if (parseError) {
    data.Siparis = "Hayır";
    data.notlar = "AI çıktısı işlenemedi – " + parseError;
  }
  return {json:data,pairedItem:{item:index}};
});
