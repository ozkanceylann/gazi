const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const nodes=JSON.parse(fs.readFileSync('n8n/branch-handoff-parameters.json','utf8'));
const code=name=>nodes.find(n=>n.nodeName===name).parameters.jsCode;
function run(name,input,others={}){return new Function('$input','$',code(name))({first:()=>({json:input})},n=>({first:()=>({json:others[n]||{}})}));}
const auth='Hareket · Gazi Yetkisi',guard='Hareket · Kargo hareketleri · Canlı Gönderisini Doğrula',validate='Hareket · Kargo hareketleri · Durumu Doğrula';
const id='123456789012',base={siparis_no:9672,sube_etiket_durumu:'historical',kargo_siparis_no:'AKH452009672-R2',orderinvoiceid:'old'};
assert.equal(run(guard,base,{[auth]:{branchShipmentId:id}})[0].json.queryReference,null);
assert.equal(run(guard,{...base,kargo_takip_kodu:id})[0].json.queryReference,null);
assert.throws(()=>run(guard,{...base,sube_etiket_durumu:null},{[auth]:{branchShipmentId:id}}),/devredilmemiş/);
assert.throws(()=>run(guard,{...base,kargo_takip_kodu:'999999999999'},{[auth]:{branchShipmentId:id}}),/Farklı/);
assert.throws(()=>run(validate,{statusCode:200,body:{shipmentStatusCode:2,shipmentId:'999999999999'}},{[guard]:{...base,kargo_takip_kodu:id}}),/farklı gönderi/);
assert.equal(run(validate,{statusCode:200,body:{shipmentStatusCode:2,shipmentId:id}},{[guard]:{...base,kargo_takip_kodu:id}})[0].json.shipmentStatusCode,2);
for(const name of ['Barkod Etiket · Etiket Kontrol','Kargola Etiket · Etiket Kontrol'])for(const status of ['sending','sent','uncertain','historical'])assert.throws(()=>run(name,{...base,sube_etiket_durumu:status}),/şubeye devredildi/);
const app=fs.readFileSync('app.js','utf8'),ctx={};vm.createContext(ctx);vm.runInContext(app.slice(app.indexOf('function isCargoAwaitingHandover('),app.indexOf('function cargoStateFilter(')),ctx);
for(const status of ['sending','sent','uncertain','historical'])assert(!ctx.canPrintCargoLabel({...base,kargo_durumu:'Kargolandı',sube_etiket_durumu:status}));
console.log('PASS: branch label UI/server suppression, shipment-ID routing, wrong ID protection, and repeated link protection.');
