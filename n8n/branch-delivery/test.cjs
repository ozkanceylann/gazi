const assert = require('node:assert/strict');
const fs = require('node:fs');
const intake = JSON.parse(fs.readFileSync(__dirname + '/intake-parameters.json'));
const shipping = JSON.parse(fs.readFileSync(__dirname + '/shipping-parameters.json'));
const code = (nodes, name) => nodes.find(n => n.nodeName === name).parameters.jsCode;
const parser = new Function('$input', '$', code(intake, 'Json_Kodla'));
function parse(message, fields = {}) {
  const data = {Siparis:'Evet',musteri_ad_soyad:'Test',musteri_telefon:'5551234567',adres:'Mahalle 1 sokak 2',Sehir:'İzmir',ilce:'Bornova',urunler:['5 kg kuru üzüm'],toplam:'500',kargo_adet:'1',kargo_kg:'5',subeden_teslim:false,teslim_subesi:'',teslim_sekli_kontrol:false,...fields};
  return parser({all:() => [{json:{output:JSON.stringify(data)}}]}, () => ({item:{json:{_message_text:message,_sender_phone:'905551234567'}}}))[0].json;
}
assert.equal(parse('Normal ev adresi').subeden_teslim, false);
assert.equal(parse('Kocatepe şubesi DHL kargo şube teslimatı', {subeden_teslim:true,teslim_subesi:'Kocatepe'}).subeden_teslim,true);
assert.equal(parse('Ev adresim var ama şubeden alacağım').subeden_teslim,true);
assert.equal(parse('Şubeden teslim değil eve gelsin',{subeden_teslim:true}).subeden_teslim,false);
assert.equal(parse('Şube yanı sokak no 2').subeden_teslim,false);
assert.equal(parse('Şubeden teslim veya eve gelsin').teslim_sekli_kontrol,true);
assert.equal(parse('Şube yanı sokak no 2',{subeden_teslim:true}).teslim_sekli_kontrol,true);
assert.equal(parse('Normal adres',{subeden_teslim:'false'}).subeden_teslim,false);
assert.equal(parse('Normal adres',{subeden_teslim:'belki'}).teslim_sekli_kontrol,true);
assert.equal(parse('Normal adres',{subeden_teslim:undefined}).teslim_sekli_kontrol,true);
assert.equal(parse('Şubeden alacağım',{adres:''}).adres,'Şubeden teslim');
assert.equal(parse('Toplam IBAN ile ödedi').toplam,'0');
assert.equal(parse('5 kg üzüm, 500 TL, kapıda nakit').toplam,'500');
const payload = new Function('$input','$', code(shipping,'Kargola · DHL İsteğini Hazırla'));
const order={siparis_no:1,ad_soyad:'Test',adres:'Şubeden teslim',sehir:'İzmir',ilce:'Bornova',musteri_tel:'5551234567',kargo_adet:'1',kargo_kg:'5',toplam_tutar:'0'};
const token={first:()=>({json:{jwt:'test',X_IBM_Client_Id:'test',X_IBM_Client_Secret:'test',Kullanici_adi:'test'}})};
for(const [value,type] of [[true,2],[false,1],[undefined,1]]){
 const result=payload(token,()=>({first:()=>({json:{...order,subeden_teslim:value}})}))[0];
 assert.equal(result.order.deliveryType,type);
 assert.equal(result.order.codAmount,0);
}
assert.throws(()=>payload(token,()=>({first:()=>({json:{...order,teslim_sekli_kontrol:true}})})),/Teslim şekli kontrol/);
for(const name of ['Kargola · Siparişi Kontrol Et','Kargola Etiket · Etiket Kontrol','Barkod Etiket · Etiket Kontrol']){
 const run = new Function('$input','$',code(shipping,name));
 assert.throws(()=>run({first:()=>({json:{...order,teslim_sekli_kontrol:true}})},()=>({})),/Teslim şekli kontrol/);
}
for(const name of ['tum_siparisler','GAZİ']){
 const fields=intake.find(n=>n.nodeName===name).parameters.fieldsUi.fieldValues;
 for(const f of ['subeden_teslim','teslim_subesi','teslim_sekli_kontrol'])assert(fields.some(x=>x.fieldId===f));
}
console.log('Delivery intent, boolean normalization, persistence mappings, prepaid amount, DHL routing and review guards passed.');
