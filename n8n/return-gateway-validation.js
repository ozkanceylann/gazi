// GAZI_KARGO_SURECLERI_CANLI / İade · İsteği Doğrula
// Yalnızca manuel iade çağrısı; zamanlayıcı yoktur.
const req=$('İade · Gazi İade Canlı').first().json,key=$input.first().json.key;
if(!key||req.headers?.['x-gazi-return-key']!==key)throw new Error('Yetkisiz iade isteği');
const b=req.body||{},p=b.body||{},o=p.order||{},s=p.shipper||{};
if(b.method!=='POST'||b.path!=='standardcmdapi/createReturnOrder'||!/^GZI-[0-9]+-R1$/.test(String(o.referenceId||''))||o.barcode!==o.referenceId||Number(o.isCOD)!==0||Number(o.codAmount)!==0||Number(o.paymentType)!==2||[o.smsPreference1,o.smsPreference2,o.smsPreference3].some(x=>Number(x)!==0)||s.customerId||!s.fullName||!s.address||!/^5[0-9]{9}$/.test(s.mobilePhoneNumber)||!Number.isSafeInteger(s.cityCode)||s.cityCode<1||!Number.isSafeInteger(s.districtCode)||s.districtCode<1||!Array.isArray(p.orderPieceList)||p.orderPieceList.length<1||p.orderPieceList.length>100||p.orderPieceList.some((x,i)=>x.barcode!==o.referenceId+'-'+(i+1)||!Number.isFinite(x.kg)||x.kg<=0))throw new Error('İade gönderisi alanları geçersiz');
return [{json:{body:p}}];
