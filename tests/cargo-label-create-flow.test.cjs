const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const src=fs.readFileSync('app.js','utf8');const fn=src.slice(src.indexOf('async function retryCargoLabel('),src.indexOf('\nconst referenceLabelBusy'));
async function test({mode='create',saved=false,fail=false,noSave=false,pdf=false,blocked=false,defer=false}={}){
 let row={siparis_no:1,kargo_zpl:saved?'label':null};let requests=[],windows=0,opened=0,reads=0,release;const messages=[];
 const gate=defer?new Promise(r=>release=r):Promise.resolve();
 const button={disabled:false,textContent:mode==='create'?'Etiket Oluştur':'Etiket Yazdır',dataset:{labelOperation:mode}};
 const w={closed:false,document:{body:{}},close(){this.closed=true;}};
 const ctx={Number,console,WH_BARKOD:'x',TABLE:'x',selectedOrder:null,busy:{kargola:new Set(),barkod:new Set()},window:{open(){windows++;return blocked?null:w;}},document:{getElementById:()=>null},toast:x=>messages.push(x),hasCargoLabel:o=>!!o.kargo_zpl,canPrintCargoLabel:()=>true,needsCargoLabelRetry:o=>!o.kargo_zpl,updateCargoLabelButton:(b,o)=>{b.dataset.labelOperation=o.kargo_zpl?'print':'create';b.textContent=o.kargo_zpl?'Etiket Yazdır':'Etiket Oluştur';},loadOrders:async()=>{},openCargoPdf:async()=>opened++,db:{from:()=>({select(){return this},eq(){return this},single:async()=>{reads++;return{data:{...row},error:null}}})},cargoRequest:async(_,{operation})=>{requests.push(operation);await gate;if(fail)throw Error('DHL error');if(operation==='create'){if(!noSave)row.kargo_zpl='label';return{label_saved:true,...(pdf?{pdf_base64:'JVBER'}:{})};}return{pdf_base64:'JVBER'};}};
 vm.createContext(ctx);vm.runInContext(fn,ctx);
 const running=ctx.retryCargoLabel(1,button);
 if(defer){await new Promise(setImmediate);assert(button.disabled);await ctx.retryCargoLabel(1,button);assert.equal(requests.length,1);release();}
 await running;assert(!button.disabled);assert.equal(ctx.busy.barkod.size,0);
 return{requests,windows,opened,button,messages};
}
(async()=>{
 for(const pdf of [false,true]){const r=await test({pdf,defer:true});assert.deepEqual(r.requests,['create']);assert.equal(r.windows,0);assert.equal(r.opened,0);assert.equal(r.button.dataset.labelOperation,'print');}
 let r=await test({mode:'print',saved:true});assert.deepEqual(r.requests,['print']);assert.equal(r.windows,1);assert.equal(r.opened,1);
 r=await test({saved:true});assert.equal(r.requests.length,0);assert.equal(r.windows,0);assert.equal(r.button.dataset.labelOperation,'print');
 r=await test({mode:'print'});assert.equal(r.requests.length,0);assert.equal(r.opened,0);
 r=await test({fail:true});assert.equal(r.windows,0);assert.equal(r.button.dataset.labelOperation,'create');
 r=await test({noSave:true});assert.equal(r.opened,0);assert(r.messages.some(x=>x.includes('doğrulanamadı')));
 r=await test({mode:'print',saved:true,blocked:true});assert.equal(r.requests.length,0);
 console.log('PASS: create never opens PDF or auto-prints, locks repeated clicks, verifies saved labels, separate explicit print, stale states/failures/blocked popups.');
})().catch(e=>{console.error(e);process.exitCode=1});
