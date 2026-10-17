const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const code=fs.readFileSync('branch-selector.js','utf8').replaceAll('export function','function');
class El{
 constructor(value=''){this.value=value;this.children=[];this.listeners={};this.isConnected=true;this.hidden=false;this.textContent='';this.disabled=false;}
 get selectedOptions(){return this.optionsOverride||this.children.filter(x=>x.value===this.value)}
 addEventListener(e,fn){(this.listeners[e]??=[]).push(fn)}
 replaceChildren(...children){this.children=children;this.value=children[0]?.value||''}
 appendChild(c){this.children.push(c)}
 change(){for(const fn of this.listeners.change||[])fn({target:this})}
}
function fixture(order={},locked=false,request=async()=>({branches:[{code:'04500400',name:'AKHİSAR',address:'Şube adresi',phone:'0236 414 13 50'}]})){
 const ids=['delivery_select','sehir_select','ilce_select','delivery_branch_select','delivery_branch','delivery_branch_info','adres','delivery_branch_retry'];
 const els=Object.fromEntries(ids.map(id=>[id,new El()]));
 els.delivery_select.value='true';els.sehir_select.value='45';els.ilce_select.value='A';els.ilce_select.optionsOverride=[{textContent:'AKHİSAR'}];els.adres.value='Müşteri adresi';els.delivery_branch.value=order.teslim_subesi||'';
 const root={getElementById:id=>els[id],createElement:()=>new El()};const context={Date,document:root};vm.createContext(context);vm.runInContext(code+'\nthis.bind=bindBranchSelector;',context);
 const binding=context.bind({order,locked,request,root});return {els,binding};
}
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 let calls=0;const x=fixture({},false,async body=>{calls++;assert.equal(body.city_code,'45');assert.equal(body.district_name,'AKHİSAR');return {branches:[{code:'04500400',name:'AKHİSAR',address:'Şube adresi',phone:'0236 414 13 50'}]}});
 await tick();assert.equal(calls,1);assert(!x.binding.valid());x.els.delivery_branch_select.value='04500400';x.els.delivery_branch_select.change();assert(x.binding.valid());assert.equal(x.els.delivery_branch.value,'AKHİSAR');assert.equal(x.els.adres.value,'Şube adresi');assert(x.els.delivery_branch_info.textContent.includes('0236'));
 x.els.delivery_select.value='false';x.els.delivery_select.change();assert.equal(x.els.adres.value,'Müşteri adresi');
 let resolveOld;const y=fixture({},false,()=>new Promise(r=>resolveOld=r));y.els.ilce_select.value='';y.els.ilce_select.change();resolveOld({branches:[{code:'old',name:'Wrong district',address:'Wrong address'}]});await tick();assert(!y.binding.valid());assert.equal(y.els.adres.value,'Müşteri adresi');
 let lockedCalls=0;const z=fixture({teslim_subesi:'Kayıtlı şube'},true,()=>{lockedCalls++;});await tick();assert.equal(lockedCalls,0);assert(z.els.delivery_branch_select.disabled);assert(z.binding.valid());
 const failed=fixture({},false,async()=>{throw Error('Unavailable')});await tick();assert(!failed.els.delivery_branch_retry.hidden);assert(!failed.binding.valid());
 const normalize=new Function('$input','$',fs.readFileSync('n8n/branch-directory-normalize.js','utf8'));
 const normalized=normalize({first:()=>({json:{statusCode:200,body:[{BranchCode:'04500400',BranchName:'AKHİSAR',Address:'Cumhuriyet Mah. Akhisar/Manisa'},{BranchCode:'04501200',BranchName:'MERKEZ',Address:'Yunusemre/Manisa'},{BranchCode:'03500100',BranchName:'DİĞER',Address:'Akhisar/İzmir'}]}})},()=>({first:()=>({json:{city_code:45,district_name:'AKHİSAR'}})}));assert.equal(normalized[0].json.branches.length,1);
 const auth=new Function('$input','$',fs.readFileSync('n8n/branch-directory-auth.js','utf8'));assert.throws(()=>auth({first:()=>({json:{statusCode:200,body:{id:'seller',app_metadata:{firma:'gazi',role:'seller'}}}})},()=>({first:()=>({json:{}})})),/yönetici/);
 console.log('PASS: branch selection/address, restoration, stale request exclusion, locked shipments, retry, city/district filtering and seller rejection.');
})().catch(e=>{console.error(e);process.exitCode=1});
