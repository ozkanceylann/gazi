// The page only requests a query until the user explicitly clicks Cancel.
export function bindShipmentQuery({db, publicKey, endpoint, document, confirmCancel}) {
  const form=document.getElementById('shipmentQueryForm'),input=document.getElementById('shipmentIdentifier');
  const kind=document.getElementById('queryKind'),queryButton=document.getElementById('queryButton');
  const cancelButton=document.getElementById('cancelShipmentButton'),result=document.getElementById('shipmentResult');
  const status=document.getElementById('queryStatus');
  let latest=null,busy=false;
  function message(text,error=false){status.textContent=text;status.dataset.error=String(error);}
  function clear(){latest=null;result.hidden=true;cancelButton.hidden=true;}
  function lock(value){busy=value;queryButton.disabled=value;cancelButton.disabled=value;input.disabled=value;kind.disabled=value;}
  async function request(body){
    const {data}=await db.auth.getSession();
    if(!data.session?.access_token)throw Error('Oturum süresi doldu. Yeniden giriş yapın.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
    try{
      const response=await fetch(endpoint,{method:'POST',body:new URLSearchParams({...body,accessToken:data.session.access_token,publicKey}),signal:controller.signal});
      let payload;try{payload=await response.json();}catch{throw Error('Kargo servisi geçerli yanıt döndürmedi. İşlem sonucunu yeniden sorgulayın.');}
      if(!response.ok||payload.success!==true||payload.environment!=='production')throw Error(payload.message||'İşlem tamamlanamadı.');
      return payload;
    }catch(error){if(error.name==='AbortError')throw Error('İstek zaman aşımına uğradı. İşlem sonucunu yeniden sorgulayın.');throw error;}
    finally{clearTimeout(timer);}
  }
  function show(payload){
    const s=payload.shipment;latest={...payload,identifier:input.value.trim().toUpperCase(),kind:kind.value};
    document.getElementById('shipmentState').textContent=s.status;
    const fields=document.getElementById('shipmentFields');fields.replaceChildren();
    for(const [label,value] of [['Referans numarası',s.referenceId],['Gönderi numarası',s.shipmentId||'Henüz oluşturulmamış'],['Alıcı',s.recipient||payload.order?.ad_soyad||'—'],['Varış birimi',s.destination||'—'],['Parça sayısı',s.pieceCount??'—'],['Sorgulama zamanı',new Date(s.checkedAt).toLocaleString('tr-TR')]]){
      const box=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;box.append(dt,dd);fields.append(box);
    }
    document.getElementById('matchedOrder').textContent=payload.order?`Eşleşen sipariş: #${payload.order.siparis_no} · ${payload.order.ad_soyad||''} · ${payload.order.kargo_durumu||''}. İptal onaylanırsa Bekleyen aşamasına alınacak.`:'Eşleşen panel siparişi yok. İptal yalnızca DHL kaydına uygulanacak.';
    document.getElementById('cancellationInfo').textContent=s.reason;
    document.getElementById('carrierResponse').textContent=JSON.stringify({durum:s.carrierStatus,kayit:s.carrierDetail},null,2);
    cancelButton.hidden=!s.canCancel;result.hidden=false;
  }
  input.addEventListener('input',clear);kind.addEventListener('change',clear);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;clear();lock(true);message('DHL gönderisi sorgulanıyor…');
    try{const payload=await request({operation:'query',identifier:input.value.trim(),kind:kind.value});show(payload);message('DHL sorgusu tamamlandı.');}
    catch(error){message(error.message,true);}finally{lock(false);}
  });
  cancelButton.addEventListener('click',async()=>{
    if(busy||!latest?.shipment.canCancel)return;
    const selected=latest;lock(true);
    try{
      const ok=await confirmCancel(`Referans: ${selected.shipment.referenceId}\nGönderi: ${selected.shipment.shipmentId||'Barkod yok'}\n${selected.order?'Sipariş #'+selected.order.siparis_no+' Bekleyen aşamasına alınacak.':'Eşleşen panel siparişi yok.'}\nDHL gönderi ve sipariş kaydı iptal edilsin mi?`);
      if(!ok)return;
      message('Gönderi yeniden doğrulanıyor ve DHL iptali uygulanıyor…');
      const response=await request({operation:'cancel',confirmed:'true',identifier:selected.identifier,kind:selected.kind,expectedReference:selected.shipment.referenceId,expectedShipment:selected.shipment.shipmentId,expectedOrder:String(selected.order?.siparis_no||'')});
      clear();message(response.message);
    }catch(error){clear();message(error.message,true);}finally{lock(false);}
  });
  queryButton.disabled=false;message('Sorgulamak istediğiniz numarayı girin.');
}

async function start(){
  await window.waitConfig();
  const db=window.supabase.createClient('https://jarsxtpqzqzhlshpmgot.supabase.co',PUBLIC_KEY);
  const user=await window.requireSession(db);
  if(user.app_metadata?.role==='seller')throw Error('Gönderi sorgulama için yönetici oturumu gerekli.');
  bindShipmentQuery({db,publicKey:PUBLIC_KEY,endpoint:CONFIG.webhooks.gonderi_sorgula,document,confirmCancel:text=>window.confirm(text)});
}
const PUBLIC_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphcnN4dHBxenF6aGxzaHBtZ290Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyODExMTcsImV4cCI6MjA3Nzg1NzExN30.98oYONSkb8XSDrfGW2FxhFmt2BLB5ZRo3Ho50GhZYgE';
if(typeof window!=='undefined'&&!window.__SHIPMENT_QUERY_TEST__)start().catch(error=>{const el=document.getElementById('queryStatus');el.textContent=error.message;el.dataset.error='true';});
