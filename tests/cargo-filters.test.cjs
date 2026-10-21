const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app.js','utf8');
const elements={searchInput:{value:'Zafer'},tabSearchInput:{value:'iade'},pageTitle:{},listSummary:{}};
const context=vm.createContext({document:{getElementById:id=>elements[id],querySelectorAll:()=>[]},window:{},applyOperationFilter:q=>q,loadOrders:()=>{},currentTab:'iade',cargoFilter:'all',cargoFilterGlobal:false,operationFilter:'',OPERATION_CARDS:{}});
const slice=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
vm.runInContext(slice('function applyTabFilter(', '// Dashboard')+slice('const CARGO_STATES =','function cargoBranchPhones(')+slice('const CARGO_FILTER_GROUPS=','async function cargoRequest(')+slice('function updateListHeading(', '\nfunction loadMore('),context);
// Interpret the actual PostgREST predicates against representative carrier rows.
function parts(s){let depth=0,start=0,out=[];for(let i=0;i<s.length;i++){if(s[i]==='(')depth++;if(s[i]===')')depth--;if(s[i]===','&&!depth){out.push(s.slice(start,i));start=i+1;}}return [...out,s.slice(start)];}
function match(row,s){
 for(const op of ['and','or'])if(s.startsWith(op+'(')){const values=parts(s.slice(op.length+1,-1)).map(p=>match(row,p));return op==='and'?values.every(Boolean):values.some(Boolean);}
 const [field,op,...tail]=s.split('.');let value=tail.join('.'),actual=row[field];
 if(op==='not')return !match(row,field+'.'+value);
 if(op==='is')return value==='null'?actual==null:actual===JSON.parse(value);
 if(actual==null)return false;
 if(op==='eq')return String(actual)===value;
 if(op==='neq')return String(actual)!==value;
 if(op==='gt')return Number(actual)>Number(value);
 throw Error('Unknown predicate '+s);
}
class Query{constructor(){this.filters=[];}or(s){this.filters.push(row=>parts(s).some(p=>match(row,p)));return this;}eq(k,v){this.filters.push(row=>row[k]===v);return this;}in(k,v){this.filters.push(row=>v.includes(row[k]));return this;}rows(rows){return rows.filter(r=>this.filters.every(f=>f(r)));}}
const rows=[...Array.from({length:8},(_,i)=>({siparis_no:i+1,kargo_durumu:'Kargolandı',shipmentStatusCode:i+1})),{siparis_no:9,kargo_durumu:'Bekliyor'},{siparis_no:10,kargo_durumu:'Hazırlandı'},{siparis_no:11,kargo_durumu:'Kargolandı',shipmentStatus:null},{siparis_no:12,kargo_durumu:'İade',shipmentStatus:'Transfer_Aşamasında'},{siparis_no:13,kargo_durumu:'Kargolandı',isDelivered:true,shipmentStatusCode:5}];
const expected={all:[1,2,3,4,5,6,7,8,11,12,13],created:[1,11],transit:[2,3,12],delivery:[4],delivered:[5,13],problem:[6,8],return:[7]};
for(const tab of ['iade','sorunlu','tamamlandi','kargolandi'])for(const [key,ids] of Object.entries(expected)){
 context.currentTab=tab;context.key=key;vm.runInContext('filterCargo(key)',context);
 assert.equal(elements.searchInput.value,'');assert.equal(elements.tabSearchInput.value,'');
 context.query=new Query();const q=vm.runInContext('applyCargoFilter(applyTabFilter(query,currentTab,operationFilter,cargoFilterGlobal))',context);
 assert.deepEqual(q.rows(rows).map(r=>r.siparis_no),ids,tab+' / '+key);
 vm.runInContext('updateListHeading(false,"loaded")',context);assert.match(elements.pageTitle.textContent,/Tüm Kargolar/);
}
context.query=new Query();assert.deepEqual(vm.runInContext('applyTabFilter(query,"bekleyen","")',context).rows(rows).map(r=>r.siparis_no),[9],'Dashboard keeps tab scope even during global cargo filtering');
vm.runInContext('setTab("iade")',context);assert.equal(context.cargoFilterGlobal,false);assert.equal(context.cargoFilter,'all');
console.log('PASS: all seven filters across four tabs, DHL states 1–8, raw status fallback, both search resets, headings, dashboard isolation and tab reset');
