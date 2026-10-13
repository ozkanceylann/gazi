const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const ORIGIN = 'https://gazi.ozkanceylan.uk';
const headers = {'Content-Type':'application/json','Cache-Control':'no-store',
  'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};

async function rpc(operation:string,id:number,data:Record<string,unknown>={}) {
  const r=await fetch(SUPABASE_URL+'/rest/v1/rpc/gazi_iade_internal',{
    method:'POST',headers:{apikey:SERVICE,Authorization:'Bearer '+SERVICE,'Content-Type':'application/json'},
    body:JSON.stringify({p_operation:operation,p_id:id,p_data:data}),signal:AbortSignal.timeout(15000)});
  const v=await r.json();if(!r.ok)throw Error(v.message||'İade kaydı kaydedilemedi');return v;
}
export function returnPayload(o:any,reference:string) {
  const phone=String(o.musteri_tel||'').replace(/\D/g,'').replace(/^90/,'').replace(/^0/,'');
  if(!/^5\d{9}$/.test(phone))throw Error('Müşteri telefonu geçersiz');
  const city=Number(o.sehir_kodu),district=Number(o.ilce_kodu),count=Number(o.kargo_adet||1);
  if(!Number.isSafeInteger(city)||city<1||!Number.isSafeInteger(district)||district<1)throw Error('Şehir/ilçe kodları eksik veya geçersiz');
  if(!Number.isSafeInteger(count)||count<1||count>100)throw Error('Paket adedi geçersiz');
  const raw=String(o.kargo_kg||'').replace(/kg/gi,'').trim();
  const weights=(count===1?[raw.replace(',','.')]:raw.split(/[+,|\s/-]+/)).filter(Boolean).map(Number);
  if(weights.length===1&&count>1)while(weights.length<count)weights.push(weights[0]);
  if(weights.length!==count||weights.some(x=>!Number.isFinite(x)||x<=0))throw Error('Her paket için kilogram bilgisi gerekli');
  const content=String(o.urun_bilgisi||'').trim();if(!content)throw Error('Ürün bilgisi eksik');
  return {order:{referenceId:reference,barcode:reference,billOfLandingId:'',isCOD:0,codAmount:0,
    shipmentServiceType:1,packagingType:3,content,smsPreference1:0,smsPreference2:0,smsPreference3:0,
    paymentType:2,deliveryType:1,description:o.siparis_no+' siparişi iadesi',marketPlaceShortCode:'',marketPlaceSaleCode:'',pudoId:''},
    orderPieceList:weights.map((kg,i)=>({barcode:reference+'-'+(i+1),kg,desi:0,content})),
    shipper:{cityCode:city,districtCode:district,address:o.adres,fullName:o.ad_soyad,mobilePhoneNumber:phone}};
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{headers,status});
  let id:number|undefined,locked=false,submitted=false,definiteFailure=false;
  try {
    if(req.method!=='POST')return reply({message:'POST gerekli'},405);
    if(req.headers.get('origin')&&req.headers.get('origin')!==ORIGIN)return reply({message:'İstek kaynağı izinli değil'},403);
    const bearer=req.headers.get('authorization')||'';
    if(!bearer.startsWith('Bearer '))return reply({message:'Gazi yönetici oturumu gerekli'},401);
    const auth=await fetch(SUPABASE_URL+'/auth/v1/user',{headers:{apikey:ANON,Authorization:bearer},signal:AbortSignal.timeout(15000)});
    const user=await auth.json();
    if(!auth.ok||!user.id)return reply({message:'Oturum doğrulanamadı'},401);
    if(user.app_metadata?.firma!=='gazi'||user.app_metadata?.role==='seller')return reply({message:'Gazi yönetici yetkisi gerekli'},403);
    const input=await req.json();id=Number(input.siparis_no);
    if(!Number.isSafeInteger(id)||id<1)return reply({message:'Sipariş numarası geçersiz'},400);
    const c=await rpc('begin',id!);locked=!c.existing;
    if(c.existing)return reply({success:true,environment:'production',already_created:true,reference:c.reference,url:c.url});
    const payload=returnPayload(c.order,c.reference);
    if(c.gateway.url!=='https://n8n.ozkanceylan.uk/webhook/gazi_iade_olustur')throw Error('DHL geçit adresi geçersiz');
    submitted=true;
    const response=await fetch(c.gateway.url,{method:'POST',redirect:'error',
      headers:{'Content-Type':'application/json','x-gazi-return-key':c.gateway.key},
      body:JSON.stringify({path:'standardcmdapi/createReturnOrder',method:'POST',body:payload}),signal:AbortSignal.timeout(55000)});
    const result=await response.json(),dhl=Array.isArray(result.data)?result.data[0]:result.data;
    if(!response.ok||result.status!==200||!dhl?.orderInvoiceId||dhl.referenceId!==c.reference){
      const message=String(dhl?.error?.Description||dhl?.error?.Message||dhl?.message||dhl?.title||'DHL iade işlemi tamamlanamadı');
      definiteFailure=result.status>=400&&result.status<500&&!/mevcut|already|duplicate/i.test(message);
      throw Error(message);
    }
    const saved=await rpc('finish',id!,{reference:c.reference,url:dhl.returnOrderLabelURL,response:dhl});
    locked=false;return reply({success:true,environment:'production',reference:saved.reference,url:saved.url});
  } catch(e) {
    const message=e instanceof Error?e.message:'İade oluşturulamadı';
    if(locked&&id)try{await rpc(submitted&&!definiteFailure?'uncertain':'failed',id,{error:message});}catch{}
    return reply({success:false,message},400);
  }
});
