const fs=require("node:fs"),assert=require("node:assert/strict");
const {chromium,webkit}=require("playwright");
const base=fs.readFileSync("style.css","utf8"),theme=fs.readFileSync("theme.css","utf8");
const index=fs.readFileSync("index.html","utf8"),report=fs.readFileSync("rapor.html","utf8"),login=fs.readFileSync("login.html","utf8");
const tags=[
  ...["all","created","transit","delivery","delivered","problem","return"].map(x=>'<span data-label-fixture class="cargo-status cargo-status--'+x+'">Kargo '+x+'</span>'),
  ...["waiting","prepared","shipped","completed","return","cancelled","unknown","problem","branch"].map(x=>'<span data-label-fixture class="order-stage-badge order-stage-badge--'+x+'">Sipariş '+x+'</span>'),
  ...["create","print","branch"].map(x=>'<button data-label-fixture class="btn-cargo-label cargo-label-'+x+'">Etiket '+x+'</button>'),
  '<button data-label-fixture class="btn-return-label">İade etiketi</button><span data-label-fixture class="cargo-count" style="--count-hue:45">3</span><a data-label-fixture class="order-taker-phone" style="--phone-hue:120">Telefon</a>'
].join(" ");
const row=(id,zero=false)=>'<tr data-order-id="'+id+'" class="'+(zero?'order-zero-total':'')+'"><td class="order-cell--number">'+id+'</td><td class="order-cell--customer"><span class="order-customer-name">Örnek Müşteri</span><span class="order-date">19 Ekim</span></td><td class="order-cell--product"><span class="order-product-limit">5 kg zeytin</span></td><td class="order-cell--total"><span class="order-total-amount">'+(zero?'0':'1.250')+' <small>TL</small></span></td><td class="order-cell--status"><span data-label-fixture class="order-stage-badge order-stage-badge--waiting">Bekliyor</span></td><td class="order-cell--primary"><button class="btn-prepare">Hazırla</button></td></tr>';
function main(){
  const sidebar=index.match(/<aside class="sidebar">[\s\S]*?<\/aside>/)[0];
  const counters=index.match(/<section id="operationCounters"[\s\S]*?<\/section>/)[0].replaceAll("…","12");
  return '<body class="orders-page">'+sidebar+'<main class="content-area"><header class="page-header"><div><h1>Siparişler</h1><p id="listSummary">Hazırlanacak siparişler</p></div><button class="btn-refresh">Yenile</button></header>'+counters+'<div class="top-bar search-slot"><input id="searchInput" placeholder="Sipariş ara"><input id="tabSearchInput" placeholder="Sekmede ara"><button class="btn-search">Ara</button></div><div class="order-quick-actions"><button class="btn-primary">İlk 10 Siparişi Hazırla</button><button class="label-scan-launch">Kamera Okut</button></div><div class="table-wrapper"><table class="orders-table"><thead><tr><th>No</th><th>Müşteri</th><th>Ürün</th><th>Tutar</th><th>Durum</th><th>İşlem</th></tr></thead><tbody id="ordersBody">'+row(101)+row(102)+row(103,true)+'</tbody></table></div><section class="test-tags" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">'+tags+'</section></main><div id="orderModal" class="modal" style="display:none"><div class="modal-content"><h2>Sipariş detayı</h2><div id="orderDetails"><div class="detail-overview"><h3>Örnek Müşteri</h3><strong>1.250 TL</strong></div><div class="detail-group"><div class="detail-title">Teslimat</div><p>Örnek adres bilgisi</p><span data-label-fixture class="cargo-status cargo-status--created">Gönderi Hazırlandı</span><input value="Örnek bilgi"></div><div class="detail-cargo-actions"><button class="btn-open">Hareket geçmişini getir</button></div></div><div id="actionButtons" class="modal-btns"><button class="btn-primary btn-prepare">Hazırla</button><button id="btnBarcode" data-label-fixture class="btn-primary cargo-label-create">Etiket Oluştur</button><button class="btn-warning">Düzenle</button><button class="btn-danger">İptal Et</button><button class="btn-close">Kapat</button></div></div></div><div id="alertRoot"></div></body>';
}
function textColors(page){return page.locator("[data-label-fixture]").evaluateAll(els=>els.map(el=>{const s=getComputedStyle(el);return [s.color,s.backgroundColor,s.backgroundImage,s.borderTopColor]}));}
(async()=>{
 fs.mkdirSync("tests/output",{recursive:true});
 for(const [name,engine] of [["chromium",chromium],["webkit",webkit]]){
  const browser=await engine.launch();
  try{
   const page=await browser.newPage({viewport:{width:1440,height:1000}});
   const errors=[];page.on("pageerror",e=>errors.push(e.message));
   await page.route("**/*",r=>r.abort());
   await page.setContent('<style>'+base+'</style>'+main());
   const old=await textColors(page);
   await page.addStyleTag({content:theme});
   assert.deepEqual(await textColors(page),old,"Existing label palettes must stay unchanged");
   for(const width of [375,1440]){
    await page.setViewportSize({width,height:1000});
    const overview=await page.locator(".operation-card").evaluateAll(els=>els.map(el=>getComputedStyle(el).backgroundImage));
    assert.equal(new Set(overview).size,1);
    const bodyColor=await page.locator("body").evaluate(el=>getComputedStyle(el).backgroundColor);
    assert.equal(bodyColor,"rgb(12, 23, 16)");
    const contrast=await page.evaluate(()=>{
      const parse=s=>(s.match(/[\d.]+/g)||[]).map(Number);
      const lum=a=>a.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
      function backgrounds(el){
        for(let node=el;node;node=node.parentElement){
          const st=getComputedStyle(node);
          if(st.backgroundImage!=="none"){const colors=st.backgroundImage.match(/rgba?\([^)]+\)/g)||[];if(colors.length)return colors.map(parse);}
          const c=parse(st.backgroundColor);if(c.length===3||c[3]===1)return [c];
        }return [[12,23,16]];
      }
      const selectors=[".page-header h1","#listSummary",".operation-card span",".operation-card strong",".operation-card small",".order-customer-name",".order-product-limit",".order-total-amount",".btn-prepare",".btn-refresh",".label-scan-launch"];
      return selectors.flatMap(selector=>[...document.querySelectorAll(selector)].map(el=>{
        const fg=lum(parse(getComputedStyle(el).color)),ratios=backgrounds(el).map(c=>{const bg=lum(c);return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)});
        return {selector,ratio:Math.min(...ratios)};
      }));
    });
    assert(!contrast.some(x=>x.ratio<4.5),JSON.stringify(contrast.filter(x=>x.ratio<4.5)));
    const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll("body *")].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.right>innerWidth+1;}).map(el=>({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right})).slice(0,12)}));
    if(name==="webkit")await page.screenshot({path:"tests/output/theme-webkit-"+width+".png",fullPage:true});
    assert(layout.scroll<=layout.width,JSON.stringify(layout));
    if(name==="chromium")await page.screenshot({path:"tests/output/theme-"+width+".png",fullPage:true});
   }
   await page.locator("#orderModal").evaluate(el=>el.style.display="flex");
   assert.notEqual(await page.locator("#actionButtons .btn-warning").evaluate(el=>getComputedStyle(el).color),"rgb(0, 0, 0)");
   if(name==="chromium")await page.screenshot({path:"tests/output/theme-detail.png",fullPage:true});
   const reportBody=report.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g,"");
   const reportStyle=report.match(/<style>([\s\S]*?)<\/style>/)[1];
   await page.setContent('<style>'+base+'</style><style>'+reportStyle+'</style><style>'+theme+'</style><body class="orders-page">'+reportBody+'</body>');
   const panels=await page.locator(".report-panel,.toolbar,.report-chart-card").evaluateAll(els=>els.map(el=>getComputedStyle(el).background));
   assert(panels.length>=6);assert(!panels.some(x=>x.startsWith("rgb(255, 255, 255)")));
   const loginStyle=login.match(/<style>([\s\S]*?)<\/style>/)[1];
   const loginBody=login.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g,"");
   await page.setViewportSize({width:375,height:812});
   await page.setContent('<style>'+loginStyle+'</style><style>'+theme+'</style><body class="login-page">'+loginBody+'</body>');
   assert.equal(await page.locator("body").evaluate(el=>getComputedStyle(el).color),"rgb(244, 241, 229)");
   if(name==="chromium")await page.screenshot({path:"tests/output/theme-login.png",fullPage:true});
   assert.deepEqual(errors,[]);
   console.log("PASS "+name+": original labels unchanged, uniform overview, readable controls, report/login surfaces and mobile/desktop layout.");
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
