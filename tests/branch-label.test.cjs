const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const app=fs.readFileSync('app.js','utf8');
const source=app.slice(app.indexOf('function canRequestBranchLabel('),app.indexOf('function canPrintCargoLabel('));
const ctx={isGaziAdmin:true,isCargoAwaitingHandover:o=>o.kargo_durumu==='Kargolandı'&&!o.isDelivered&&!o.shipmentStatusCode,hasCargoLabel:o=>!!o.kargo_zpl,cargoEnvironment:o=>o.env};vm.createContext(ctx);vm.runInContext(source,ctx);
const base={siparis_no:9672,kargo_durumu:'Kargolandı'};
assert(ctx.canRequestBranchLabel(base));
for(const status of ['sending','sent','uncertain','historical'])assert(!ctx.canRequestBranchLabel({...base,sube_etiket_durumu:status}));
for(const changes of [{kargo_durumu:'Bekliyor'},{isDelivered:true},{kargo_zpl:'label'},{env:'test'},{shipmentStatusCode:2}])assert(!ctx.canRequestBranchLabel({...base,...changes}));
ctx.isGaziAdmin=false;assert(!ctx.canRequestBranchLabel(base));ctx.isGaziAdmin=true;
assert(ctx.branchLabelBadge({...base,sube_etiket_durumu:'historical'}).includes('Şubeden kesilen'));
assert(ctx.branchLabelButton({...base,sube_etiket_durumu:'sent'}).includes("'confirm'"));
const ts=fs.readFileSync('supabase/functions/gazi-branch-label/index.ts','utf8');
const js=require('node:module').stripTypeScriptTypes(ts.replace(/export /g,''));
let handler,sends=0,rpcStatus=null;
const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'anon',EVOLUTION_API_URL:'https://wa.test',EVOLUTION_API_KEY:'secret'};
const api={Response,Request,AbortSignal,Error,Number,JSON,Deno:{env:{get:k=>env[k]},serve:f=>handler=f},fetch:async(url,opts)=>{
 if(url.includes('/auth/'))return Response.json({id:'user',app_metadata:{firma:'gazi',role:'admin'}});
 if(url.includes('/rpc/')){const x=JSON.parse(opts.body);if(x.p_operation==='begin'){if(rpcStatus)return Response.json({existing:true,status:rpcStatus});rpcStatus='sending';return Response.json({existing:false,order:base});}rpcStatus=x.p_operation;return Response.json({success:true});}
 sends++;assert.equal(JSON.parse(opts.body).number,'120363408432692208@g.us');return Response.json({key:{id:'message',remoteJid:'120363408432692208@g.us'}});
}};
vm.createContext(api);vm.runInContext(js,api);
(async()=>{const req=()=>new Request('https://edge.test',{method:'POST',headers:{authorization:'Bearer user'},body:JSON.stringify({siparis_no:9672})});
 const first=await handler(req());assert.equal(first.status,200);assert.equal(rpcStatus,'sent');
 await handler(req());assert.equal(sends,1);
 const original=api.fetch;rpcStatus=null;api.fetch=async(url,opts)=>{if(url.includes('wa.test')){sends++;throw Error('timeout');}return original(url,opts);};
 const failed=await handler(req());assert.equal(failed.status,400);assert.equal(rpcStatus,'uncertain');assert.equal(sends,2);await handler(req());assert.equal(sends,2);
 console.log('PASS: eligibility, roles, branch badge, fixed recipient, confirmed delivery and duplicate suppression.');
})().catch(e=>{console.error(e);process.exitCode=1;});
