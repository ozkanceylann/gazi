const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'..','app.js'),'utf8');
const section=source.slice(source.indexOf('function applyTabFilter('),source.indexOf('// Orders needing'));
const states=source.slice(source.indexOf('const CARGO_STATES ='),source.indexOf('function cargoStatusInfo('));
const stateFilter=source.slice(source.indexOf('function cargoStateFilter('),source.indexOf('function cargoBranchPhones('));
const buttons=Object.fromEntries(['prepare','label','handover','attention'].map(key=>[key,{title:'',setAttribute(){}}]));
const values=Object.fromEntries(Object.entries(buttons).map(([key,b])=>[key,{textContent:'',closest:()=>b}]));
const panel={setAttribute(){},querySelector:s=>values[s.match(/="(.+)"/)[1]]};
let calls=[],fail=false,now=1000,hold=false,releases=[];
class Query{
 constructor(){this.ops=[]}
 select(...args){this.ops.push(['select',...args]);return this}
 or(...args){this.ops.push(['or',...args]);return this}
 eq(...args){this.ops.push(['eq',...args]);return this}
 in(...args){this.ops.push(['in',...args]);return this}
 then(resolve,reject){calls.push(this.ops);if(hold)return new Promise(r=>releases.push(()=>r({count:1234,error:null}))).then(resolve,reject);return Promise.resolve(fail?{error:{message:'offline'}}:{count:1234,error:null}).then(resolve,reject)}
}
const context={Date:{now:()=>now},window:{},document:{getElementById:()=>panel},db:{from:()=>new Query()},TABLE:'gazi_siparisler',currentTab:'iade',operationFilter:'handover'};
vm.createContext(context);vm.runInContext(states+stateFilter+section+'\nthis.run=refreshOperationCounts; this.tab=applyTabFilter;this.op=applyOperationFilter;',context);
(async()=>{
 await context.run();assert.equal(calls.length,4);
 for(const value of Object.values(values))assert.equal(value.textContent,'1.234');
 for(const [i,[key,tab]] of [['prepare','bekleyen'],['label','kargolandi'],['handover','kargolandi'],['attention','sorunlu']].entries()){
  const q=new Query().select('siparis_no',{count:'exact',head:true}).or('kargo_durumu.is.null,kargo_durumu.neq.Silindi');
  context.tab(q,tab,key);
  assert.equal(JSON.stringify(q.ops),JSON.stringify(calls[i]),`${key}: list and count predicates must match, independent of active tab`);
 }
 assert(calls[1].some(o=>o[0]==='or' && o[1].includes('kargo_zpl.is.null,kargo_zpl.eq.')));
 assert(calls[2].some(o=>o.includes('and(kargo_zpl.not.is.null,kargo_zpl.neq.),zpl_base64.like.JVBER%')));
 await context.run(false);assert.equal(calls.length,4,'Fresh counters must be reused on tab changes');
 await context.run(true);assert.equal(calls.length,8,'Writes must force fresh counters');
 now+=60001;await context.run(false);assert.equal(calls.length,12,'Expired counters must refresh');
 fail=true;await context.run();for(const value of Object.values(values))assert.equal(value.textContent,'—','Failure must never show false zero');
 const failedCalls=calls.length;await context.run(false);assert.equal(calls.length,failedCalls+4,'Failed counters must not be cached');
 fail=false;hold=true;const base=calls.length;const pending=context.run(true);await Promise.resolve();await context.run(false);await context.run(true);assert.equal(calls.length,base+4,'Concurrent navigation and writes must not duplicate in-flight requests');
 hold=false;for(const release of releases)release();await pending;await new Promise(r=>setImmediate(r));assert.equal(calls.length,base+8,'A write during counting must trigger one follow-up count');
 console.log('PASS: all four global counters use exact HEAD requests, match list filters, separate missing/saved labels and show unavailable counts on errors.');
})().catch(e=>{console.error(e);process.exitCode=1});
