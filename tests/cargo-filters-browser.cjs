const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
 try{
  const page=await browser.newPage();
  const css=fs.readFileSync('style.css','utf8')+fs.readFileSync('theme.css','utf8');
  const tools=fs.readFileSync('index.html','utf8').match(/<section id="cargoTools"[\s\S]*?<\/section>/)[0].replace(' hidden','');
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><body class="orders-page"><main class="content-area">'+tools+'</main><script>window.filterCargo=key=>{window.selected=key;document.querySelectorAll("[data-cargo-filter]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.cargoFilter===key)));}</script>');
  for(const width of [320,375,430,768,900]){
   await page.setViewportSize({width,height:740});
   const geometry=await page.locator('.cargo-legend').evaluate(el=>({tops:[...el.children].map(b=>b.offsetTop),overflow:document.documentElement.scrollWidth>innerWidth,scroll:el.scrollWidth,client:el.clientWidth}));
   assert.equal(new Set(geometry.tops).size,1,'All seven labels stay in one row at '+width);
   assert(!geometry.overflow,'Page must not scroll sideways at '+width);
   for(const key of ['all','created','transit','delivery','delivered','problem','return']){
    await page.locator('[data-cargo-filter="'+key+'"]').click();
    assert.equal(await page.evaluate(()=>window.selected),key);
    assert.equal(await page.locator('[data-cargo-filter][aria-pressed="true"]').count(),1);
   }
  }
  console.log('PASS: all seven labels on a single row at 320/375/430/768/900 px, no page overflow, horizontal reachability and active state');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
