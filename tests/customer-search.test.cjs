const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'..','app.js'),'utf8');
const context={};vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function customerNameSearchPattern('),source.indexOf('function searchActiveOrders(')),context);
for(const [input,value] of [['şükriye','sukruye'],['sukriye','ŞÜKRİYE'],['ışıl','ISIL'],['ipek','İPEK'],['çağrı','CAGRI'],['öznur','OZNUR']])assert(new RegExp(context.customerNameSearchPattern(input),'iu').test(value),input+' -> '+value);
assert(!new RegExp(context.customerNameSearchPattern('ali'),'iu').test('eli'));
assert(!new RegExp(context.customerNameSearchPattern('şükriye'),'iu').test('fatma'));
assert(!new RegExp(context.customerNameSearchPattern('a.*'),'iu').test('ahmet'));
assert(context.buildOrderSearchFilter('şükriye').includes('ad_soyad.imatch.'));
assert(!context.buildOrderSearchFilter('9180').includes('imatch'));
assert(context.buildOrderSearchFilter('9180').includes('siparis_no.eq.9180'));
assert(context.buildOrderSearchFilter('0506 090 64 24').includes('5%0%6%0%9%0%6%4%2%4'));
console.log('PASS: Turkish letters/case, one vowel typo, literal escaping, numeric IDs and formatted phone search');
console.log(context.customerNameSearchPattern('şükriye'));

for (const [input, reference] of [
  ['AKH452009630', 'AKH452009630'],
  ['akh452009979-r2', 'AKH452009979-R2'],
  [' AKH452009979-R2 ', 'AKH452009979-R2'],
  ['AKH452009979-R1', 'AKH452009979-R1'],
  ['AKH452009979-2', 'AKH452009979-2'],
  ['AKH452009979-R2-1', 'AKH452009979-R2-1']
]) {
  assert.equal(context.buildOrderSearchFilter(input), 'kargo_siparis_no.eq.' + JSON.stringify(reference));
  assert(!context.buildOrderSearchFilter(input).includes('siparis_no.eq.' + 9979));
}
assert.notEqual(context.buildOrderSearchFilter('AKH452009979-R2'), context.buildOrderSearchFilter('AKH452009979-R1'));
assert.notEqual(context.buildOrderSearchFilter('AKH452009979-R2'), context.buildOrderSearchFilter('AKH452009979'));
console.log('PASS: complete stored cargo reference equality; suffixes preserved; no order-number fallback');
