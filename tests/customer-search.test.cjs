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

for (const input of ['AKH452009630', 'akh452009630', '  AKH452009630  '])
  assert.equal(context.buildOrderSearchFilter(input), 'siparis_no.eq.9630');
assert.equal(context.buildOrderSearchFilter('AKH4520010157'), 'siparis_no.eq.10157');
for (const input of ['AKH45200', 'AKH452000', 'AKH452002147483648', 'AKH452009630oops'])
  assert(!context.buildOrderSearchFilter(input).includes('siparis_no.eq.'));
console.log('PASS: exact cargo reference lookup, case/whitespace, invalid references');

for (const input of ['AKH452009979-R2', 'akh452009979-r2', ' AKH452009979-R2 ', 'AKH452009979-R1', 'AKH452009979-2', 'AKH452009979-R2-1'])
  assert.equal(context.buildOrderSearchFilter(input), 'siparis_no.eq.9979');
for (const input of ['AKH452009979-R', 'AKH452009979-R2junk', 'AKH452009979-', 'AKH452002147483648-R2'])
  assert(!context.buildOrderSearchFilter(input).includes('siparis_no.eq.'));
console.log('PASS: revision/parcel references map to the exact order; malformed suffixes rejected');
