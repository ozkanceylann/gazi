import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../label-scanner.js', import.meta.url), 'utf8');
const { normalizeLabelCode, findLabelOrders } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
assert.equal(normalizeLabelCode(' d@53@do1rzr1qxaaa6j '), 'D@53@DO1RZR1QXAAA6J');
assert.equal(normalizeLabelCode('https://kargotakip.dhlecommerce.com.tr/?takipNo=200766387002'), '200766387002');
assert.throws(() => normalizeLabelCode('https://example.com/?takipNo=123'));
assert.throws(() => normalizeLabelCode('123),siparis_no.gt.0'));
assert.throws(() => normalizeLabelCode(''));
function mock(direct, parcels, error = null) {
  const calls = [];
  const db = { from(table) {
    const query = { select() { return query; }, or(filter) { calls.push(filter); return query; },
      ilike(field, pattern) { calls.push([field, pattern]); query.parcels = true; return query; },
      limit() { return Promise.resolve({ data: query.parcels ? parcels : direct, error }); } };
    return query;
  } };
  return { db, calls };
}
const order = { siparis_no:9615, kargo_api_yanit:JSON.stringify({barcodeResult:[{barcodes:[{barcode:'D@53@DO1RZR1QXAAA6J'}]}]}) };
let m = mock([], [order]);
assert.equal((await findLabelOrders(m.db, 'gazi_siparisler', 'D@53@DO1RZR1QXAAA6J'))[0].siparis_no, 9615);
// Substring matches and unrelated text must never open an order.
m = mock([], [order, { siparis_no:2,kargo_api_yanit:JSON.stringify({message:'D@53@DO1RZR1QXAAA6J'}) }]);
assert.equal((await findLabelOrders(m.db, 'gazi_siparisler', 'D@53@DO1RZR1QXAAA6J')).length, 1);
assert.equal((await findLabelOrders(m.db, 'gazi_siparisler', 'DO1RZR1QX')).length, 0);
m = mock([order], [order]);
assert.equal((await findLabelOrders(m.db, 'gazi_siparisler', '9615')).length, 1);
assert.ok(m.calls.some(x => typeof x === 'string' && x.includes('siparis_no.eq.9615')));
m = mock([{ siparis_no:1 }, { siparis_no:2 }], []);
assert.equal((await findLabelOrders(m.db, 'gazi_siparisler', 'AKH452009615-2')).length, 2);
assert.ok(m.calls.some(x => typeof x === 'string' && x.includes('kargo_siparis_no.eq."AKH452009615"')));
m = mock([], [], { message:'permission denied' });
await assert.rejects(() => findLabelOrders(m.db, 'gazi_siparisler', '9615'), /Sipariş aranamadı/);
console.log('Label lookup checks passed.');
