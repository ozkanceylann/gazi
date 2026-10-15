const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'..','app.js'),'utf8');
const queue=source.slice(source.indexOf('async function loadCargoLabelQueue('),source.indexOf('\nasync function loadOrders'));
let pending=[],saved=[],calls=[];
class Query {
 constructor(){this.saved=false;this.head=false;this.span=null;}
 select(_,{head}){this.head=head;return this;}
 or(expr){if(expr.startsWith('and(kargo_zpl.'))this.saved=true;return this;}
 order(){return this;}
 range(a,b){assert(a<=b);this.span=[a,b];return this;}
 then(resolve,reject){const rows=this.saved?saved:pending;calls.push({saved:this.saved,head:this.head,span:this.span});
 if(this.span&&this.span[0]>=rows.length)throw Error('Invalid range requested');
 return Promise.resolve({count:rows.length,data:this.head?null:rows.slice(this.span?.[0]||0,(this.span?.[1]??rows.length-1)+1)}).then(resolve,reject);}
}
const context={db:{from:()=>new Query()},TABLE:'orders',applyCargoFilter:q=>q,applyTabFilter:q=>q};vm.createContext(context);vm.runInContext(queue+'\nthis.run=loadCargoLabelQueue;',context);
(async()=>{
 for(let p=0;p<=25;p++)for(let s=0;s<=25;s++){
 pending=Array.from({length:p},(_,i)=>'pending'+i);saved=Array.from({length:s},(_,i)=>'saved'+i);
 let rows=[];for(let start=0;start<p+s+10;start+=10){let r=await context.run(start,start+9);assert(!r.error);assert.equal(r.count,p+s);rows.push(...r.data);}
 assert.deepEqual(rows,[...pending,...saved]);
 }
 const a=source.slice(source.indexOf('function isCargoAwaitingHandover('),source.indexOf('function cargoStateFilter('));
 vm.runInContext(a+'\nthis.waits=isCargoAwaitingHandover;this.prints=canPrintCargoLabel;',context);
 const base={kargo_durumu:'Kargolandı',orderinvoiceid:'123'};
 for(const code of [null,1])assert(context.prints({...base,shipmentStatusCode:code}));
 for(const code of [2,3,4,5,6,7,8])assert(!context.prints({...base,shipmentStatusCode:code}));
 for(const kargo_durumu of ['Bekliyor','Hazırlandı','Tamamlandı','İptal','İade'])assert(!context.prints({...base,kargo_durumu}));
 assert(!context.prints({...base,isDelivered:true}));assert(!context.prints({...base,shipmentStatus:'Transfer_Aşamasında'}));
 assert(source.includes('cargoFilter = tab === "kargolandi" ? "created" : "all"'));
 console.log('PASS: 676 queue combinations, exhausted/empty/mixed pages; label guards and default cargo filter.');
})().catch(e=>{console.error(e);process.exitCode=1});
