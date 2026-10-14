const s=$('Kargola · Siparişi Kontrol Et').first().json;const row=$input.first().json;const key={jwt:row.jwt,Client_Id:row.X_IBM_Client_Id,Client_Secret:row.X_IBM_Client_Secret,customerNumber:row.Kullanici_adi};if(!key.jwt||!key.Client_Id||!key.Client_Secret||!key.customerNumber)throw new Error('Canlı token eksik. TOKEN_AL_CANLI çalıştırılmalı.');for (const k of ['siparis_no','ad_soyad','adres','sehir','ilce']) if(!s[k]) throw new Error("Sipariş alanı eksik: "+k);
if(!s.musteri_tel && !s.siparis_tel) throw new Error("Müşteri telefonu eksik");
if(!Number.isSafeInteger(Number(s.kargo_adet||1)) || Number(s.kargo_adet||1)<1 || Number(s.kargo_adet||1)>100) throw new Error("Kargo adedi geçersiz");



function safeArrayParse(val) {
  if (!val) return "";
  if (Array.isArray(val)) return val.join(", ");

  if (typeof val === "string") {
    try {
      const cleaned = val.replace(/^"|"$/g, "");
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) return parsed.join(", ");
    } catch (e) {}
  }
  return val;
}

let urunBilgisi = safeArrayParse(s.urun_bilgisi);
if (!urunBilgisi || urunBilgisi.trim() === "") urunBilgisi = "zeytin";


let temizUrun = urunBilgisi
  .toLowerCase()
  .replace(/(\d+)\s*kg/gi, "")
  .replace(/\s+/g, " ")
  .trim();

if (!temizUrun) temizUrun = "zeytin";
else if (!temizUrun.includes("zeytin")) temizUrun = temizUrun + " zeytin";


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
function parseKgList(raw, adet) { return parseCargoWeights(raw, adet); }

let adet = Number(s.kargo_adet || 1);
let kgList = parseKgList(String(s.kargo_kg||''), adet);if(kgList.some(x=>!Number.isFinite(x)||x<=0))throw new Error('Paket kilogramları geçersiz');



let realSiparisNo = 
  s.kargo_siparis_no ||
  s.siparis_no ||
  s.id ||
  s.order_id ||
  "SIPS-" + Date.now();


let orderPieceList = [];
for (let i = 1; i <= adet; i++) {
  const kg = kgList[i - 1];

  orderPieceList.push({
    barcode: `${realSiparisNo}-${i}`,
    desi: kg,
    kg: kg,
    content: temizUrun
  });
}



const rawAmount=s.toplam_tutar;
if(rawAmount===null||rawAmount===undefined||!String(rawAmount).trim())throw new Error('Fiyat boş. Kargolamadan önce Fiyat alanını doldurun. Tahsilatsız göndermek için açıkça 0 yazın.');
let amount=String(rawAmount).trim().replace(/(?:TL|TRY|₺)/gi,'').replace(/\s/g,'');
if(/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(amount))amount=amount.replace(/\./g,'').replace(',','.');
else if(!/^\d+(?:\.\d{1,2})?$/.test(amount))throw new Error('Fiyat geçersiz. 0 veya pozitif bir tutar girin.');
const toplamTutar=Number(amount);
if(!Number.isFinite(toplamTutar)||toplamTutar<0)throw new Error('Fiyat geçersiz.');
const isCOD=toplamTutar>0?1:0;
const codAmount=isCOD===1?toplamTutar:0;

const phone=String(s.musteri_tel||'').replace(/\D/g,'').replace(/^90/,'').replace(/^0/,'');if(!/^5\d{9}$/.test(phone))throw new Error('Müşteri telefonu geçersiz');
return [{
  order: {
    referenceId: realSiparisNo,
    barcode: realSiparisNo,
    billOfLandingId: "İrsaliye 1",
    isCOD: isCOD,
    codAmount: codAmount,
    shipmentServiceType: 1,
    marketPlaceShortCode: "",
    marketPlaceSaleCode: "",
    packagingType: 3,
    content: temizUrun,
    smsPreference1: 0,
    smsPreference2: 0,
    smsPreference3: 0,
    paymentType: 1,
    deliveryType: 1,
    description: temizUrun
  },

  orderPieceList,

  shipper: {
    customerId: key.customerNumber,
    refCustomerId: "",
    cityCode: 0,
    districtCode: 0,
    cityName: "",
    districtName: "",
    address: "",
    bussinessPhoneNumber: "",
    taxOffice: "",
    taxNumber: "",
    fullName: "",
    homePhoneNumber: "",
    mobilePhoneNumber: ""
  },

  recipient: {
    cityCode: Number(s.sehir_kodu || 0),
    districtCode: Number(s.ilce_kodu || 0),
    cityName: s.sehir || "",
    districtName: s.ilce || "",
    address: s.adres || "",
    fullName: s.ad_soyad || "",
    mobilePhoneNumber: phone
  }
}];
