const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage();let calls=[],allowCancel=true,canCancel=true;
 const shipment={referenceId:'AKH452009979-R2',shipmentId:'123456789012',status:'Gönderi Hazırlandı',recipient:'Test Alıcı',pieceCount:2,checkedAt:new Date().toISOString(),reason:'DHL onayı sonrası uygulanır.',carrierStatus:{shipmentStatusCode:1},carrierDetail:{referenceId:'AKH452009979-R2'}};
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>window.__SHIPMENT_QUERY_TEST__=true);
 await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api'){
     const body=Object.fromEntries(new URLSearchParams(route.request().postData()));calls.push(body);
     return route.fulfill({json:body.operation==='query'?{success:true,environment:'production',shipment:{...shipment,canCancel},order:{siparis_no:9979,ad_soyad:'Test Alıcı',kargo_durumu:'Kargolandı'}}:{success:true,environment:'production',message:'DHL iptali tamamlandı; sipariş Bekleyen aşamasına alındı.'}});
   }
   if(url.pathname==='/config.js'||url.hostname!=='app.local')return route.fulfill({body:'',contentType:'application/javascript'});
   const file=path.join(process.cwd(),url.pathname);if(!fs.existsSync(file))return route.abort();
   return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});
 });
 await page.goto('http://app.local/gonderi-sorgulama.html');
 await page.evaluate(async()=>{const {bindShipmentQuery}=await import('/gonderi-sorgulama.js');window.approveCancel=true;bindShipmentQuery({db:{auth:{getSession:async()=>({data:{session:{access_token:'test'}}})}},publicKey:'test',endpoint:'/api',document,confirmCancel:async()=>window.approveCancel});});
 assert(await page.locator('#cancelShipmentButton').isHidden());
 await page.locator('#shipmentIdentifier').fill('AKH452009979-R2');await page.locator('#queryButton').click();
 await page.locator('#shipmentResult').waitFor({state:'visible'});assert.equal(calls.length,1);assert.equal(calls[0].operation,'query');
 assert(await page.locator('#cancelShipmentButton').isVisible());assert((await page.locator('#shipmentFields').innerText()).includes('AKH452009979-R2'));
 for(const width of [390,1280]){
   await page.setViewportSize({width,height:900});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
   await page.screenshot({path:'/tmp/shipment-query-'+width+'.png',fullPage:true});
 }
 await page.evaluate(()=>window.approveCancel=false);await page.locator('#cancelShipmentButton').click();assert.equal(calls.length,1);
 await page.locator('#shipmentIdentifier').fill('AKH452009979-R1');assert(await page.locator('#shipmentResult').isHidden());
 await page.locator('#shipmentIdentifier').fill('AKH452009979-R2');await page.locator('#queryButton').click();await page.locator('#shipmentResult').waitFor({state:'visible'});
 await page.evaluate(()=>window.approveCancel=true);await page.locator('#cancelShipmentButton').click();
 await page.waitForFunction(()=>document.getElementById('queryStatus').textContent.includes('iptali tamamlandı'));
 assert.equal(calls.at(-1).operation,'cancel');assert.equal(calls.at(-1).expectedReference,'AKH452009979-R2');assert.equal(calls.at(-1).expectedOrder,'9979');assert(await page.locator('#cancelShipmentButton').isHidden());
 canCancel=false;await page.locator('#queryButton').click();await page.locator('#shipmentResult').waitFor({state:'visible'});assert(await page.locator('#cancelShipmentButton').isHidden());
 assert.deepEqual(errors,[]);await browser.close();console.log('PASS: desktop/mobile query screen, query-only submit, exact reference, edit invalidation, cancelled confirmation, cancellation payload, ineligible shipment');
})().catch(e=>{console.error(e);process.exit(1)});
