// Pure functions shared by the n8n Code nodes and offline regression tests.
function authorize(response, body) {
  const user = response.body;
  if (response.statusCode !== 200 || !user?.id || String(user.app_metadata?.firma || '').toLowerCase() !== 'gazi' || user.app_metadata?.role === 'seller')
    throw Error('Gazi yönetici oturumu gerekli.');
  const identifier = String(body.identifier || '').trim().toUpperCase();
  const kind = String(body.kind || 'auto');
  if (!['auto', 'reference', 'shipment'].includes(kind)) throw Error('Geçersiz sorgu türü.');
  const isShipment = kind === 'shipment' || (kind === 'auto' && /^\d{12}$/.test(identifier));
  if (isShipment ? !/^\d{12}$/.test(identifier) : !/^[A-Z0-9][A-Z0-9._-]{1,99}$/.test(identifier))
    throw Error('Geçerli referans veya 12 haneli gönderi numarası girin.');
  const operation = String(body.operation || 'query');
  if (!['query', 'cancel'].includes(operation)) throw Error('Geçersiz işlem.');
  if (operation === 'cancel' && body.confirmed !== 'true') throw Error('Önce gönderiyi sorgulayın ve iptali onaylayın.');
  return {identifier, isShipment, operation, userId:user.id,
    expectedReference:String(body.expectedReference || ''), expectedShipment:String(body.expectedShipment || ''),
    expectedOrder:String(body.expectedOrder || '')};
}
function unwrap(response) {
  if (!response || response.error || response.statusCode < 200 || response.statusCode >= 300) return null;
  const body = response.body;
  if (Array.isArray(body) && body.length !== 1) return null;
  const value = Array.isArray(body) ? body[0] : body;
  return value && typeof value === 'object' && !value.error && value.success !== false ? value : null;
}
function detailTarget(response, request) {
  const status = unwrap(response);
  if (status?.shipmentId && /^\d{12}$/.test(String(status.shipmentId))) {
    if (request.isShipment && String(status.shipmentId) !== request.identifier) throw Error('DHL gönderi numarası eşleşmedi.');
    if (!request.isShipment && String(status.referenceId || '').toUpperCase() !== request.identifier) throw Error('DHL referansı eşleşmedi.');
    return 'getshipmentByShipmentId/' + encodeURIComponent(status.shipmentId);
  }
  // A reference may exist as a DHL order before a shipment barcode is created.
  if (!request.isShipment && [200,400,404].includes(Number(response.statusCode)))
    return 'getorder/' + encodeURIComponent(request.identifier);
  throw Error('DHL gönderisi sorgulanamadı veya bulunamadı. İptal yapılmadı.');
}
function resolveShipment(statusResponse, detailResponse, request) {
  const status = unwrap(statusResponse);
  const detail = unwrap(detailResponse);
  if (!detail) throw Error('DHL kayıt bilgisi alınamadı. İptal yapılmadı.');
  const data = detail.shipment || detail.order || detail;
  const referenceId = String(data.referenceId || detail.referenceId || status?.referenceId || '').trim();
  const shipmentId = String(data.shipmentId || detail.shipmentId || status?.shipmentId || '').trim();
  if (!/^[A-Z0-9][A-Z0-9._-]{1,99}$/i.test(referenceId)) throw Error('DHL geçerli referans döndürmedi.');
  if (request.isShipment ? shipmentId !== request.identifier : referenceId.toUpperCase() !== request.identifier)
    throw Error('DHL sonucu girilen numarayla eşleşmedi.');
  if (status?.shipmentId && shipmentId !== String(status.shipmentId)) throw Error('DHL yanıtları farklı gönderilere ait.');
  if (status?.referenceId && referenceId !== String(status.referenceId)) throw Error('DHL yanıtlarında referans uyuşmazlığı var.');
  if (shipmentId && !/^\d{12}$/.test(shipmentId)) throw Error('DHL gönderi numarası doğrulanamadı.');
  if (shipmentId && (!status?.shipmentId || String(status.shipmentId) !== shipmentId)) throw Error('Gönderinin güncel durumu doğrulanamadı.');
  const statusCode = shipmentId ? Number(status.shipmentStatusCode) : 0;
  const delivered = status?.isDelivered === true || status?.isDelivered === 1 || statusCode === 5;
  const canCancel = !delivered && (shipmentId ? statusCode === 1 && (data.shipmentStatusCode == null || Number(data.shipmentStatusCode) === 1) && ![true,1,'1'].includes(data.isDelivered) : Number(data.isTransformedToShipment) === 0);
  const recipient = data.recipient || detail.recipient || {};
  return {referenceId, shipmentId, statusCode, canCancel,
    status: String(status?.shipmentStatus || status?.shipmentStatusExplanation || 'DHL sipariş kaydı; gönderi barkodu yok'),
    recipient: String(recipient.fullName || recipient.name || data.recipientName || status?.recipientName || ''),
    destination: String(data.receivingBranch || status?.deliveryUnitName || status?.destinationBranchName || [recipient.city,recipient.district].filter(Boolean).join(' / ')),
    pieceCount: data.pieceCount ?? data.pieceTotal ?? status?.pieceTotal ?? (Array.isArray(detail.orderPieceList) ? detail.orderPieceList.reduce((sum,p)=>sum+Number(p.numberOfPieces||0),0) : null),
    reason: canCancel ? 'İptal sonucu DHL tarafından onaylandıktan sonra uygulanır.' : 'DHL güncel durumuna göre gönderi teslim alımını beklemiyor; bu ekrandan iptal edilemez.',
    checkedAt:new Date().toISOString(), carrierStatus:status || {}, carrierDetail:detail};
}
function matchOrder(response, shipment) {
  if (response.statusCode !== 200 || !Array.isArray(response.body)) throw Error('Panel siparişi sorgulanamadı.');
  const rows=response.body;
  if (rows.length > 1) throw Error('Referans/gönderi birden fazla siparişle eşleşti. İptal yapılmadı.');
  const order=rows[0] || null;
  if (!order) return null;
  let meta={};try{meta=JSON.parse(order.kargo_api_yanit || '{}');}catch{}
  if (meta.environment === 'test' || order.kargo_durumu === 'Silindi') throw Error('Bu panel kaydı canlı iptal için uygun değil.');
  const byShipment=!!shipment.shipmentId && order.kargo_takip_kodu === shipment.shipmentId;
  const byReference=order.kargo_siparis_no === shipment.referenceId;
  if (!byShipment && !byReference) throw Error('Sipariş eşleşmesi doğrulanamadı.');
  if (!byShipment && order.kargo_takip_kodu) throw Error('Sipariş başka bir gönderiye bağlı. İptal yapılmadı.');
  return order;
}
function preview(shipment, order, request) {
  if (request.operation === 'cancel') {
    if (!shipment.canCancel) throw Error(shipment.reason);
    if (request.expectedReference !== shipment.referenceId || request.expectedShipment !== shipment.shipmentId || request.expectedOrder !== String(order?.siparis_no || ''))
      throw Error('Gönderi/sipariş bilgisi değişti. Yeniden sorgulayıp kontrol edin.');
  }
  return {success:true,environment:'production',operation:'query',shipment,
    order:order ? {siparis_no:order.siparis_no,ad_soyad:order.ad_soyad,kargo_durumu:order.kargo_durumu} : null};
}
function verifyCancellation(response, label) {
  const body=Array.isArray(response.body)?response.body[0]:response.body;
  if (!Number.isInteger(Number(response.statusCode)) || response.statusCode<200 || response.statusCode>=300 || response.error || body?.error || body?.success===false)
    throw Error('DHL '+label+' iptalini onaylamadı. '+String(body?.error?.message || body?.error?.Message || body?.message || '').slice(0,300));
  return true;
}
function prepareRecord(order, shipment, request, response) {
  verifyCancellation(response,'sipariş');
  const result={success:true,environment:'production',cancelled:true,referenceId:shipment.referenceId,shipmentId:shipment.shipmentId,
    siparis_no:order?.siparis_no || null,message:order ? 'DHL iptali tamamlandı; sipariş Bekleyen aşamasına alındı.' : 'DHL iptali tamamlandı. Eşleşen panel siparişi bulunmadı.'};
  if (!order) return {order:null,patch:null,response:result};
  const previous=String(order.kargo_siparis_no || shipment.referenceId),revision=previous.match(/-R(\d+)$/i);
  let meta={};try{meta=JSON.parse(order.kargo_api_yanit || '{}');}catch{}
  // Do not retain active tracking/labels from the cancelled shipment.
  const patch={kargo_durumu:'Bekliyor',kargo_siparis_no:previous.replace(/-R\d+$/i,'')+'-R'+(revision?Number(revision[1])+1:1),
    orderinvoiceid:null,orderinvoicedetailid:null,shipperbranchcode:null,kargo_takip_kodu:null,kargo_qr_kod:null,invoiceid:null,
    kargo_zpl:null,zpl_base64:null,shipmentStatus:null,shipmentStatusCode:null,isDelivered:false,kargo_takip_url:null,kargo_gunc_saat:null,
    teslimat_aciklama:null,print:false,etiket_olusturma_tarihi:null,etiket_son_yazdirma:null,etiket_yazdirma_sayisi:0,
    sube_etiket_durumu:null,sube_etiket_tarihi:null,iptal_nedeni:null,iptal_tarihi:null,gonder_hata_bilgisi:null,
    kargo_api_yanit:JSON.stringify({environment:'production',activeShipmentCancelled:true,cancellation:{operation:'manuel_iptal',
      referenceId:shipment.referenceId,shipmentId:shipment.shipmentId,cancelledAt:new Date().toISOString(),actor:request.userId,
      previousReference:previous,previousShipment:meta,response:response.body}})};
  return {order,patch,response:result};
}
function verifyRecord(response, expected) {
  const rows=response.body;
  if (response.statusCode!==200 || !Array.isArray(rows) || rows.length!==1 || Number(rows[0].siparis_no)!==Number(expected.order.siparis_no) ||
      rows[0].kargo_durumu!=='Bekliyor' || rows[0].kargo_siparis_no!==expected.patch.kargo_siparis_no || rows[0].kargo_takip_kodu!==null || rows[0].orderinvoiceid!==null)
    throw Error('DHL iptali tamamlandı ancak panel kaydı güncellenemedi veya işlem sırasında değişti. Yeniden kargolamadan önce kontrol edin.');
  return {...expected.response,recordVerified:true};
}
module.exports={authorize,unwrap,detailTarget,resolveShipment,matchOrder,preview,verifyCancellation,prepareRecord,verifyRecord};
