const r=$input.first().json;
const b=Array.isArray(r.body)?r.body[0]:r.body;
if(Number(r.statusCode)!==200||!b||Number(b.shipmentStatusCode)!==1||b.isDelivered===true)
  throw new Error('DHL teslim alımı bekleyen durumunu doğrulamadı. Transfer aşamasına geçmiş gönderiler iptal edilemez.');
const expected=$('İptal · İptal · Sonuç').first().json.shipmentId;
if(String(b.shipmentId)!==String(expected))throw new Error('DHL gönderi numarası eşleşmedi. İptal edilmedi.');
return [{json:{verified:true}}];