const s=$input.first().json;const body=$('İptal · Gazi Kargo Canlı').first().json.body||{};const request=$('İptal · Gazi Yetkisi').first().json;
let meta;try{meta=JSON.parse(s.kargo_api_yanit||'{}');}catch{}
if(!s.siparis_no||meta?.environment==='test')throw new Error('Test siparişi canlıda iptal edilemez');
if(!String(body.reason||'').trim()||String(body.reason).length>2000)throw new Error('İptal nedeni gerekli');
if(!s.kargo_siparis_no)throw new Error('Kargo referansı bulunamadı');
if(s.isDelivered===true||Number(s.shipmentStatusCode)===5)throw new Error('Teslim edilmiş gönderi iptal edilemez');
if(request.operation==='gonderi_iptal'&&(!['Kargolandı','Hazırlandı'].includes(s.kargo_durumu)||(!s.orderinvoiceid&&!s.kargo_takip_kodu)))throw new Error('İptal edilebilecek aktif kargo kaydı bulunamadı');

// Only registered shipments which DHL has not collected can be cancelled.
const statusCode=Number(s.shipmentStatusCode);
const shipmentStatus=String(s.shipmentStatus||'').replace(/_/g,' ').trim();
const tracking=meta?.tracking||{},trackedStatus=tracking.status||{};
const collected=trackedStatus.isDelivered===true || Number(trackedStatus.shipmentStatusCode)>1
  || (Array.isArray(tracking.movements)&&tracking.movements.some(m=>Number(m.eventSequence)>=2));
if(s.kargo_durumu!=='Kargolandı' || (statusCode!==0&&statusCode!==1)
  || !['','Gönderi Hazırlandı','DHL sipariş kaydı oluşturuldu; barkod bekleniyor'].includes(shipmentStatus) || collected)
  throw new Error('Yalnızca DHL teslim alımı bekleyen gönderiler iptal edilebilir. Transfer aşamasına geçmiş gönderiler iptal edilemez.');

return [{json:{referenceId:s.kargo_siparis_no,shipmentId:s.kargo_takip_kodu||null,hasShipment:!!s.kargo_takip_kodu}}];