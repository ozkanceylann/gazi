const fs=require("node:fs");
const assert=require("node:assert/strict");
const {chromium,webkit}=require("playwright");
const css=fs.readFileSync("style.css","utf8");
const script=fs.readFileSync("mobile-navigation.js","utf8");
const index=fs.readFileSync("index.html","utf8");
const report=fs.readFileSync("rapor.html","utf8");
function fixture(reports=false){
  const aside=(reports?report:index).match(/<aside class="sidebar">[\s\S]*?<\/aside>/)[0];
  return '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>'+css+'</style><body class="orders-page"><button class="mobile-menu-btn">☰</button>'+aside+'<main class="content-area"><h1>Test listesi</h1><div style="height:1100px"></div>'+(reports?'':'<table><tbody id="ordersBody"></tbody></table>')+'</main><script>window.setTab=function(tab){document.querySelectorAll(".menu li").forEach(li=>li.classList.toggle("active",li.id==="tab_"+tab));window.selectedTab=tab;};window.openOrderTakerSettings=function(){window.settingsOpened=true};window.logout=function(){window.loggedOut=true};window.reportLogout=window.logout;document.getElementById("installAppBtn")?.addEventListener("click",()=>window.installed=true);</script></body>';
}
(async()=>{
  for(const [name,engine] of [["chromium",chromium],["webkit",webkit]]){
    const browser=await engine.launch();
    try{
      const page=await browser.newPage();
      const errors=[];
      page.on("pageerror",e=>errors.push(e.message));
      await page.route("https://gazi.test/**",route=>route.fulfill({contentType:"text/html",body:fixture(new URL(route.request().url()).pathname.endsWith("rapor.html"))}));
      async function open(path="index.html"){await page.goto("https://gazi.test/"+path);await page.addScriptTag({content:script});}
      for(const width of [320,375,430,900]){
        await page.setViewportSize({width,height:740});await open();
        const nav=page.locator("#mobileBottomNav"),more=nav.locator("summary");
        assert(await nav.isVisible());assert(!(await page.locator(".sidebar").isVisible()));assert(!(await page.locator(".mobile-menu-btn").isVisible()));
        const geometry=await nav.evaluate(el=>({box:el.getBoundingClientRect().toJSON(),width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,padding:parseFloat(getComputedStyle(document.querySelector(".content-area")).paddingBottom)}));
        assert(!geometry.overflow);assert(Math.abs(geometry.box.bottom-740)<1);assert(geometry.padding>=100);
        const buttons=await nav.locator(":scope > button").all();
        assert.equal(buttons.length,6);
        for(const button of buttons){const b=await button.boundingBox();assert(b.width>=43.5&&b.height>=44);}
        for(const tab of ["hazirlandi","kargolandi","tamamlandi","iade","sorunlu","bekleyen"]){
          await nav.locator('[data-nav-tab="'+tab+'"]').click();
          await page.waitForFunction(expected=>window.selectedTab===expected,tab);
          await page.waitForFunction(expected=>document.querySelector('#mobileBottomNav [data-nav-tab="'+expected+'"]').getAttribute("aria-current")==="page",tab);
          assert.equal(await nav.locator('[aria-current="page"]').count(),1);
        }
        await more.click();assert(await nav.locator("details").getAttribute("open")!==null);
        const menu=await nav.locator(".mobile-bottom-popup").boundingBox(),bottom=await nav.boundingBox();
        assert(menu.y>=0&&menu.y+menu.height<=bottom.y);
        await page.keyboard.press("Escape");assert.equal(await nav.locator("details").getAttribute("open"),null);
        await more.click();await page.locator("h1").click();assert.equal(await nav.locator("details").getAttribute("open"),null);
        await more.click();await nav.locator('[data-nav-tab="iptal"]').click();
        await page.waitForFunction(()=>document.querySelector('#mobileBottomNav [data-nav-tab="iptal"]').getAttribute("aria-current")==="page");
        assert(await nav.locator("details").evaluate(el=>el.classList.contains("has-active-page")));
        await more.click();assert(!(await nav.locator('[data-nav-existing="takerSettingsMenu"]').isVisible()));
        await page.evaluate(()=>document.getElementById("takerSettingsMenu").hidden=false);
        await nav.locator('[data-nav-existing="takerSettingsMenu"]').waitFor({state:"visible"});
        await nav.locator('[data-nav-existing="takerSettingsMenu"]').click();assert(await page.evaluate(()=>window.settingsOpened));
        await more.click();await nav.locator("[data-nav-report]").click();assert.equal(new URL(page.url()).pathname,"/rapor.html");
      }
      await page.setViewportSize({width:375,height:667});await open("rapor.html");
      await page.locator("#mobileBottomNav summary").click();
      assert.equal(await page.locator("#mobileBottomNav [data-nav-report]").getAttribute("aria-current"),"page");
      await page.locator('#mobileBottomNav > [data-nav-tab="bekleyen"]').click();
      assert.equal(new URL(page.url()).searchParams.get("tab"),"bekleyen");
      await page.setViewportSize({width:1280,height:800});await open();
      assert(!(await page.locator("#mobileBottomNav").isVisible()));assert(await page.locator(".sidebar").isVisible());
      assert.deepEqual(errors,[]);
      console.log("PASS "+name+": 320/375/430/900 px, six tabs, active state, upward menu, outside/Escape close, permissions, report routing and desktop sidebar.");
    }finally{await browser.close();}
  }
})().catch(e=>{console.error(e);process.exitCode=1});
