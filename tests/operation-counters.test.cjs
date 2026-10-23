const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'..','app.js'),'utf8');
const section=source.slice(source.indexOf('function applyTabFilter('),source.indexOf('// Orders needing'));
const keys=['prepare','label','handover','attention'];
const values=Object.fromEntries(keys.map(k=>[k,{textContent:'',closest:()=>({title:''})}]));
const parcels=Object.fromEntries(keys.map(k=>[k,{textContent:''}]));
const panel={setAttribute(){},querySelector:s=>(s.includes('parcels')?parcels:values)[s.match(/="(.+)"/)[1]]};
let calls=0,now=1000,fail=false,hold=false,releases=[];
const context={Date:{now:()=>now},window:{},document:{getElementById:()=>panel},db:{rpc:async name=>{assert.equal(name,'gazi_operation_counts');calls++;if(hold)await new Promise(r=>releases.push(r));return fail?{error:{message:'offline'}}:{data:Object.fromEntries(keys.flatMap((k,i)=>[[k,i?1234:0],[k+'_parcels',i?2468:0]]))}}}};
vm.createContext(context);vm.runInContext(section+'\nthis.run=refreshOperationCounts;',context);
(async()=>{
 await context.run();assert.equal(calls,1);assert.equal(values.prepare.textContent,'0');assert.equal(parcels.prepare.textContent,'0 parça');
 for(const k of keys.slice(1)){assert.equal(values[k].textContent,'1.234');assert.equal(parcels[k].textContent,'2.468 parça');}
 await context.run(false);assert.equal(calls,1);
 await context.run(true);assert.equal(calls,2);
 now+=60001;await context.run(false);assert.equal(calls,3);
 fail=true;await context.run();for(const k of keys){assert.equal(values[k].textContent,'—');assert.equal(parcels[k].textContent,'— parça');}
 await context.run(false);assert.equal(calls,5);
 fail=false;hold=true;const pending=context.run();await context.run(false);await context.run(true);assert.equal(calls,6);hold=false;releases.forEach(r=>r());await pending;await new Promise(r=>setImmediate(r));assert.equal(calls,7);
 console.log('PASS: one aggregate request, all parcel totals, zero/error states, caching and queued refresh');
})().catch(e=>{console.error(e);process.exitCode=1});
