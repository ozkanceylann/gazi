const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const GROUP = '120363408432692208@g.us';
const headers = {'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'https://gazi.ozkanceylan.uk','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
async function rpc(id:number,operation:string,user:string|null=null,messageId:string|null=null){
 const r=await fetch(URL+'/rest/v1/rpc/gazi_branch_label_internal',{method:'POST',headers:{apikey:SERVICE,Authorization:'Bearer '+SERVICE,'Content-Type':'application/json'},body:JSON.stringify({p_id:id,p_operation:operation,p_user:user,p_message_id:messageId}),signal:AbortSignal.timeout(15000)});
 const data=await r.json();if(!r.ok)throw Error(data.message||'Kayıt işlemi başarısız');return data;
}
export function branchMessage(o:any){
 return ['📦 ŞUBE BARKOD TALEBİ','Sistemden etiket oluşturulamadı. Mevcut kaydı kontrol edip barkodları kesebilir misiniz? Mükerrer gönderi açmayınız.',`Sipariş: ${o.siparis_no}`,`Referans: ${o.kargo_siparis_no||'—'}`,`Gönderi no: ${o.kargo_takip_kodu||o.orderinvoiceid||'—'}`,`Müşteri: ${o.ad_soyad||'—'}`,`Telefon: ${o.musteri_tel||'—'}`,`Adres: ${o.adres||'—'}`,`İl / İlçe: ${o.sehir||''} / ${o.ilce||''}`,`Teslim: ${o.subeden_teslim?'Şubeden teslim'+(o.teslim_subesi?' · '+o.teslim_subesi:''):'Adrese teslim'}`,`Paket: ${o.kargo_adet||'—'} · KG: ${o.kargo_kg||'—'}`,`Ürünler: ${o.urun_bilgisi||'—'}`,`Tahsilat: ${o.toplam_tutar??'—'} TL · ${o.odeme_sekli||'Belirtilmemiş'}`,`Not: ${o.notlar||'—'}`].join('\n');
}
Deno.serve(async(req:Request)=>{
 const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 let id=0,locked=false,submitted=false;
 try{
  if(req.method!=='POST')return reply({message:'POST gerekli'},405);
  const bearer=req.headers.get('authorization')||'';
  const auth=await fetch(URL+'/auth/v1/user',{headers:{apikey:ANON,Authorization:bearer},signal:AbortSignal.timeout(15000)});
  const user=await auth.json();if(!auth.ok||!user.id)return reply({message:'Oturum gerekli'},401);
  if(user.app_metadata?.firma!=='gazi'||user.app_metadata?.role==='seller')return reply({message:'Gazi yönetici yetkisi gerekli'},403);
  const input=await req.json();id=Number(input.siparis_no);if(!Number.isSafeInteger(id)||id<1)return reply({message:'Sipariş numarası geçersiz'},400);
  if(input.operation==='confirm')return reply(await rpc(id,'confirm',user.id));
  const base=Deno.env.get('EVOLUTION_API_URL')?.replace(/\/$/,'');const key=Deno.env.get('EVOLUTION_API_KEY');
  if(!base||!key)throw Error('WhatsApp bağlantısı yapılandırılmamış');
  const c=await rpc(id,'begin',user.id);
  if(c.existing)return reply({success:true,already_sent:true,status:c.status});
  locked=true;const text=branchMessage(c.order);
  submitted=true;
  const response=await fetch(base+'/message/sendText/Oto',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',apikey:key},body:JSON.stringify({number:GROUP,text}),signal:AbortSignal.timeout(25000)});
  // Any ambiguous provider response stays locked to prevent duplicate messages.
  if(!response.ok){if(response.status>=400&&response.status<500&&![408,429].includes(response.status)){submitted=false;}throw Error('WhatsApp gönderimi doğrulanamadı');}
  const result=await response.json();
  if(!result.key?.id||result.key.remoteJid!==GROUP)throw Error('WhatsApp mesaj kimliği doğrulanamadı');
  await rpc(id,'sent',user.id,result.key.id);locked=false;
  return reply({success:true,status:'sent'});
 }catch(e){
  if(locked)try{await rpc(id,submitted?'uncertain':'failed');}catch{}
  return reply({success:false,message:submitted?'Gönderim sonucu belirsiz. Tekrar gönderim kilitlendi; WhatsApp grubunu kontrol edin.':e instanceof Error?e.message:'İşlem başarısız'},400);
 }
});
