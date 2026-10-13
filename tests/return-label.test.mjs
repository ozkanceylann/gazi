import assert from 'node:assert/strict';

let handler;
globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'anon'})[key]},serve:fn=>handler=fn};
const {returnPayload}=await import('../supabase/functions/gazi-return-label/index.ts');
const order={siparis_no:9319,musteri_tel:'+90 539 483 54 47',sehir_kodu:'34',ilce_kodu:'67',kargo_adet:'1',kargo_kg:'5',urun_bilgisi:'5 kg kuru üzüm',ad_soyad:'Test Müşteri',adres:'Test Adres'};
const payload=returnPayload(order,'GZI-9319-R1');
assert.equal(payload.shipper.mobilePhoneNumber,'5394835447');
assert.equal(payload.order.paymentType,2);
assert.equal(payload.order.isCOD,0);
assert.equal(payload.order.smsPreference1,0);
assert.equal(payload.orderPieceList.length,1);
assert.throws(()=>returnPayload({...order,musteri_tel:'123'},'REF'));
assert.throws(()=>returnPayload({...order,kargo_kg:''},'REF'));
assert.equal(returnPayload({...order,kargo_adet:'2',kargo_kg:'5+10'},'REF').orderPieceList[1].kg,10);

const request=()=>new Request('https://edge.example',{method:'POST',headers:{authorization:'Bearer user','Content-Type':'application/json'},body:JSON.stringify({siparis_no:9319})});
let externalCalls=0,operations=[];
globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'admin',app_metadata:{firma:'gazi'}});
  if(url.endsWith('/rpc/gazi_iade_internal')){
    const b=JSON.parse(options.body);operations.push(b.p_operation);
    return Response.json({existing:true,reference:'AKH452009319-R1',url:'https://mn.tc?rtnid=EXISTING'});
  }
  externalCalls++;throw Error('Existing return must not call DHL');
};
let response=await handler(request());
assert.equal(response.status,200);
assert.equal((await response.json()).already_created,true);
assert.equal(externalCalls,0);

operations=[];
globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'admin',app_metadata:{firma:'gazi'}});
  if(url.endsWith('/rpc/gazi_iade_internal')){
    const b=JSON.parse(options.body);operations.push(b.p_operation);
    if(b.p_operation==='begin')return Response.json({order,reference:'GZI-9319-R1',gateway:{url:'https://n8n.ozkanceylan.uk/webhook/gazi_iade_olustur',key:'mock'}});
    return Response.json({ok:true});
  }
  externalCalls++;throw new DOMException('Timeout','TimeoutError');
};
response=await handler(request());
assert.equal(response.status,400);
assert.deepEqual(operations,['begin','uncertain']);

globalThis.fetch=async()=>Response.json({id:'seller',app_metadata:{firma:'gazi',role:'seller'}});
assert.equal((await handler(request())).status,403);
assert.equal((await handler(new Request('https://edge.example',{method:'POST'}))).status,401);
operations=[];externalCalls=0;
globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'admin',app_metadata:{firma:'gazi'}});
  if(url.endsWith('/rpc/gazi_iade_internal')){
    const b=JSON.parse(options.body);operations.push(b.p_operation);
    if(b.p_operation==='begin')return Response.json({order,reference:'GZI-9319-R1',gateway:{url:'https://n8n.ozkanceylan.uk/webhook/gazi_iade_olustur',key:'mock'}});
    assert.equal(b.p_operation,'finish');
    return Response.json({reference:b.p_data.reference,url:b.p_data.url});
  }
  assert.equal(url,'https://n8n.ozkanceylan.uk/webhook/gazi_iade_olustur');
  assert.equal(options.headers['x-gazi-return-key'],'mock');
  externalCalls++;
  return Response.json({status:200,data:{orderInvoiceId:'mock-invoice',referenceId:'GZI-9319-R1',returnOrderLabelURL:'https://mn.tc?rtnid=MOCK'}});
};
response=await handler(request());
assert.equal(response.status,200);
assert.equal((await response.json()).url,'https://mn.tc?rtnid=MOCK');
assert.deepEqual(operations,['begin','finish']);
assert.equal(externalCalls,1);

const {readFile}=await import('node:fs/promises');
const validate=new Function('$','$input',await readFile(new URL('../n8n/return-gateway-validation.js',import.meta.url),'utf8'));
const validatePayload=(p,key='mock',path='standardcmdapi/createReturnOrder')=>validate(()=>({first:()=>({json:{headers:{'x-gazi-return-key':key},body:{path,method:'POST',body:p}}})}),{first:()=>({json:{key:'mock'}})});
assert.deepEqual(validatePayload(payload)[0].json.body,payload);
assert.throws(()=>validatePayload(payload,'wrong'));
assert.throws(()=>validatePayload(payload,'mock','standardcmdapi/createOrder'));
assert.throws(()=>validatePayload({...payload,order:{...payload.order,isCOD:1}}));
assert.throws(()=>validatePayload({...payload,orderPieceList:[{...payload.orderPieceList[0],kg:-1}]}));
console.log('Main Gazi workflow, saved-label reuse, uncertain-request protection, authorization and payload safety passed.');
