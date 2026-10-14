const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true, ...(process.env.SCANNER_BROWSER_PATH ? {executablePath:process.env.SCANNER_BROWSER_PATH,args:['--no-sandbox']} : {})});
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
 page.setDefaultTimeout(10000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://127.0.0.1:8765/**',r=>{
  const file=new URL(r.request().url()).pathname;
  const types={'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'};
  const path=require('node:path');
  const root=path.resolve(__dirname,'..'),target=path.resolve(root,'.'+file);
  if(!target.startsWith(root+path.sep)||!fs.existsSync(target))return r.fulfill({status:404,body:''});
  return r.fulfill({body:fs.readFileSync(target),contentType:types[path.extname(target)]||'text/html'});
 });
 await page.route('**/scanner-test.html',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><button id="scanLabelBtn" disabled>Etiket Okut</button><script type="module">
 import {installLabelScanner} from '/label-scanner.js';
 window.opened=[];window.results=[{siparis_no:9615,ad_soyad:'Test',sehir:'İSTANBUL',ilce:'ÜSKÜDAR'}];window.stops=0;
 const db={from(){const q={select(){return q},or(){return q},ilike(){q.parcels=true;return q},limit(){return Promise.resolve({data:q.parcels?[]:window.results,error:null})}};return q}};
 installLabelScanner({db,table:'gazi_siparisler',openOrder:async id=>window.opened.push(id),toast:()=>{}});
 </script>`}));
 await page.goto('http://127.0.0.1:8765/scanner-test.html');
 await page.evaluate(()=>{
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,writable:true,value:async()=>{throw new DOMException('denied','NotAllowedError')}});
  window.ZXingBrowser={BrowserMultiFormatReader:class {async decodeFromStream(stream,video,callback){window.scanCallback=callback;return {stop(){window.stops++}}}}};
 });
 await page.click('#scanLabelBtn');
 await page.getByText('Kamera izni verilmedi.',{exact:false}).waitFor();
 assert.equal(await page.locator('.label-scan-card').evaluate(e=>e.getBoundingClientRect().right<=innerWidth),true);
 await page.fill('#labelScanInput','200766387002');await page.click('[type=submit]');
 await page.waitForFunction(()=>window.opened.length===1);
 assert.deepEqual(await page.evaluate(()=>window.opened),[9615]);assert.equal(await page.locator('.label-scan-backdrop').count(),0);
 // Unknown code and ambiguous results remain reviewable.
 await page.evaluate(()=>window.results=[]);await page.click('#scanLabelBtn');await page.fill('#labelScanInput','123');await page.click('[type=submit]');
 await page.getByText('Bu barkodla sipariş bulunamadı.',{exact:false}).waitFor();
 await page.evaluate(()=>window.results=[{siparis_no:1,ad_soyad:'Bir'},{siparis_no:2,ad_soyad:'İki'}]);await page.fill('#labelScanInput','124');await page.click('[type=submit]');
 await page.locator('.label-scan-choice').nth(1).click();assert.deepEqual(await page.evaluate(()=>window.opened),[9615,2]);
 // Scanned result opens the order and stops the camera.
 await page.evaluate(()=>{
  window.results=[{siparis_no:9615}];
  navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[{stop:()=>window.stops++}]});
 });
 await page.click('#scanLabelBtn');await page.waitForFunction(()=>window.scanCallback);
 await page.evaluate(()=>window.scanCallback({getText:()=> 'D@53@DO1RZR1QXAAA6J'}));
 await page.waitForFunction(()=>window.opened.length===3);assert.ok(await page.evaluate(()=>window.stops>=2));
 // Closing before a permission response must release the late stream.
 await page.evaluate(()=>navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>window.allowCamera=resolve));
 await page.click('#scanLabelBtn');await page.waitForFunction(()=>window.allowCamera);await page.keyboard.press('Escape');
 const before=await page.evaluate(()=>window.stops);
 await page.evaluate(()=>window.allowCamera({getTracks:()=>[{stop:()=>window.stops++}]}));
 await page.waitForFunction(n=>window.stops>n,before);
 assert.equal(await page.locator('.label-scan-backdrop').count(),0);
 await page.click('#scanLabelBtn');if(process.env.SCANNER_SCREENSHOT) await page.screenshot({path:process.env.SCANNER_SCREENSHOT});await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);
 await browser.close();console.log('Scanner mobile, lookup and camera lifecycle checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
