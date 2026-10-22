const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium,webkit}=require('playwright');
const order={siparis_no:10040,ad_soyad:'Taner Çetin <script>',urun_bilgisi:'Domat kırma 10 kg\nYaban mersinli 10 kg\nPortakallı 10 kg\nLimonlu 10 kg',toplam_tutar:'16500',kargo_durumu:'Bekliyor',kargo_adet:'8',kargo_kg:'10+10+10+10+10+10+10+10'};
(async()=>{for(const engine of [chromium,webkit]){
const browser=await engine.launch();try{
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://gazi.test/**',r=>r.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><body class="orders-page"><h1>Bekleyen</h1></body>'}));
for(const width of [320,390,768,1280]){
await page.setViewportSize({width,height:780});await page.goto('https://gazi.test/');
await page.addStyleTag({content:fs.readFileSync('style.css','utf8')+fs.readFileSync('theme.css','utf8')+fs.readFileSync('order-split.css','utf8')});
await page.addScriptTag({content:fs.readFileSync('cargo-weights.js','utf8')+fs.readFileSync('order-split.js','utf8')});
await page.evaluate(o=>{window.calls=[];window.toasts=[];window.done=0;const db={from:()=>({select(){return this},eq(){return this},single:async()=>({data:o})}),rpc:async(name,params)=>{window.calls.push({name,params});return {data:{first_order_id:10040,second_order_id:10100}}}};OrderSplit.bind({db,table:'gazi_siparisler',isAdmin:true,toast:s=>toasts.push(s),onDone:async()=>{window.done++}});},order);
await page.evaluate(()=>OrderSplit.open(10040));await page.locator('dialog[open]').waitFor();
assert.equal(await page.locator('dialog script').count(),0);
const overflow=await page.locator('dialog').evaluate(el=>({dialog:el.scrollWidth>el.clientWidth+1,page:document.documentElement.scrollWidth>innerWidth}));assert(!overflow.dialog&&!overflow.page,JSON.stringify({width,overflow}));
await page.locator('.split-actions [type=submit]').click();assert.match(await page.locator('.split-error').textContent(),/tutarı/);assert.equal(await page.evaluate(()=>calls.length),0);
await page.locator('#split-price-0').fill('8.000');await page.locator('.split-fill').click();assert.equal(await page.locator('#split-price-1').inputValue(),'8500,00');
await page.locator('[name=product-1][value="1"]').check();
await page.locator('.split-actions [type=submit]').click();await page.waitForFunction(()=>window.done===1);
const call=await page.evaluate(()=>calls[0]);assert.equal(call.name,'gazi_split_order');assert.deepEqual(call.params.p_parts[0].products,[0]);assert.deepEqual(call.params.p_parts[1].products,[1,2,3]);assert.equal(call.params.p_parts[0].count,4);assert.equal(call.params.p_parts[1].count,4);assert.equal(await page.locator('dialog[open]').count(),0);
}
assert.deepEqual(errors,[]);console.log('PASS: '+engine.name()+': 320/390/768/1280px modal, no overflow, escaped products/customer, invalid submit, product allocation, balance, 8 packages and RPC completion');
}finally{await browser.close();}}
})().catch(e=>{console.error(e);process.exitCode=1});
