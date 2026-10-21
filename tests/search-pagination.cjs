const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app.js','utf8');let calls=[],shown=[];
const fixtures=Array.from({length:23},(_,i)=>({siparis_no:23-i}));
const inputs={searchInput:{value:'Test'},tabSearchInput:{value:''},loadMoreBtn:{},ordersBody:{querySelectorAll:()=>shown}};
const c=vm.createContext({console,LIST_TABLE:'gazi_order_list',currentTab:'kargolandi',cargoFilterGlobal:true,operationFilter:'',currentPage:1,PAGE_SIZE:10,listRequest:0,listLoading:false,document:{getElementById:id=>inputs[id]},db:{from:table=>{assert.equal(table,'gazi_order_list');let span;const q={select(_,{count}){assert.equal(count,'exact');return q;},or:()=>q,order:()=>q,range(a,b){span=[a,b];calls.push(span);return Promise.resolve({data:fixtures.slice(a,b+1),count:23});}};return q;}},syncCargoTools:()=>{},applyTabFilter:q=>q,applyCargoFilter:q=>q,buildOrderSearchFilter:()=>'',renderTableHeader:()=>{},markExtras:()=>{},hydrateExtras:async()=>{},renderTable:(rows,{append,hasMore})=>{shown=append?[...shown,...rows]:rows;c.hasMore=hasMore;},updateListHeading:()=>{},toast:()=>{},loadOrders:()=>{throw Error('unexpected load');}});
const a=source.indexOf('async function searchOrders('),b=source.indexOf('\nfunction clearSearch(',a);vm.runInContext(source.slice(a,b),c);
(async()=>{
 await vm.runInContext('searchOrders()',c);assert.equal(shown.length,10);assert(c.hasMore);
 vm.runInContext('currentPage++',c);await vm.runInContext('searchOrders("all",true)',c);assert.equal(shown.length,20);assert(c.hasMore);
 vm.runInContext('currentPage++',c);await vm.runInContext('searchOrders("all",true)',c);assert.equal(shown.length,23);assert(!c.hasMore);assert.equal(new Set(shown.map(o=>o.siparis_no)).size,23);
 await vm.runInContext('searchOrders()',c);assert.equal(shown.length,10);assert.equal(vm.runInContext('currentPage',c),1);
 assert.deepEqual(calls,[[0,9],[10,19],[20,29],[0,9]]);
 inputs.tabSearchInput.value='Test';await vm.runInContext('searchOrders("tab")',c);assert.equal(inputs.searchInput.value,'');assert.equal(calls.length,5);assert.equal(shown.length,10);
 console.log('PASS: bounded search pages, append, reset, all/tab scope and final-page detection');
})().catch(e=>{console.error(e);process.exitCode=1;});
