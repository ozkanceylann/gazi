const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app.js','utf8');let calls=[],rows=[{musteri_no:10,musteri_tel:'5351112233',not:'Aynı müşteri <özel> notu'}],fail=false;
const ctx={window:{},Number,String,Map,Set,Promise,currentTab:'bekleyen',isGaziAdmin:true,escapeHtml:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),db:{from:table=>({select(columns){assert.equal(table,'musteriler');assert.equal(columns,'musteri_no,musteri_tel,not');return this;},in(field,ids){calls.push({field,ids});if(fail)return Promise.reject(Error('Offline'));return Promise.resolve({data:rows.filter(r=>ids.includes(r[field])),error:null});}})}};
vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('const customerNotes = new Map();'),source.indexOf('function orderDateMarkup(')),ctx);
(async()=>{
 const orders=[{siparis_no:1,musteri_no:10},{siparis_no:2,musteri_no:10}];await ctx.loadCustomerNotes(orders);assert.equal(calls.length,1);assert.equal(ctx.customerNoteRecord(orders[0]).not,ctx.customerNoteRecord(orders[1]).not);
 const html=ctx.customerNoteCard(orders[0]);assert(html.includes('customer-note-indicator'));assert(!html.includes('<özel>'));assert(html.includes('showCustomerNote(1)'));assert(ctx.customerNoteDetail(orders[0]).includes('&lt;özel&gt;'));
 ctx.currentTab='hazirlandi';assert(ctx.customerNoteCard(orders[0]));ctx.currentTab='kargolandi';assert(ctx.customerNoteCard(orders[0]));ctx.currentTab='iptal';assert.equal(ctx.customerNoteCard(orders[0]),'');
 const unlinked={siparis_no:3,musteri_tel:'+90 535 111 22 33'};await ctx.loadCustomerNotes([unlinked]);assert.equal(ctx.customerNoteRecord(unlinked).musteri_no,10);
 rows.push({musteri_no:11,musteri_tel:'05351112233',not:'Başka kayıt'});await ctx.loadCustomerNotes([unlinked]);assert.equal(ctx.customerNoteRecord(unlinked),undefined);
 fail=true;await ctx.loadCustomerNotes([orders[0]]);assert.equal(ctx.customerNoteRecord(orders[0]),undefined);assert(orders[0]._customerNoteUnavailable);assert(ctx.customerNoteDetail(orders[0]).includes('alınamadı'));
 assert(source.includes('update({not:note}).eq("musteri_no",id)'));assert(source.includes('q.is("not",null)'));assert(source.includes('q.eq("not",customer.not)'));
 console.log('PASS: batched master notes, shared customers, all three tabs, escaping, exact phone fallback, ambiguity and read-failure handling.');
})().catch(e=>{console.error(e);process.exitCode=1;});
