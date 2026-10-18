/* Shared mobile navigation for the Gazi order and report pages. */
(() => {
  "use strict";
  if (document.getElementById("mobileBottomNav")) return;
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar) return;
  const ordersPage = !!document.getElementById("ordersBody");
  const tabs = [
    ["bekleyen", "Bekleyen", "M4 5h16v15H4z M8 3v4 M16 3v4 M4 11h16"],
    ["hazirlandi", "Hazırlandı", "m4 7 8-4 8 4-8 4-8-4Z M4 7v10l8 4 8-4V7 M12 11v10"],
    ["kargolandi", "Kargolandı", "M3 6h11v12H3z M14 10h4l3 4v4h-7 M7 18a2 2 0 1 0 0 .1 M18 18a2 2 0 1 0 0 .1"],
    ["tamamlandi", "Tamamlandı", "m5 12 4 4L19 6"],
    ["iade", "İade", "M9 5 3 11l6 6 M3 11h11a6 6 0 0 1 6 6v3"],
    ["sorunlu", "Sorunlu", "m12 3 10 18H2L12 3Z M12 9v5 M12 17h.01"]
  ];
  const svg = path => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>';
  const nav = document.createElement("nav");
  nav.id = "mobileBottomNav";
  nav.className = "mobile-bottom-nav";
  nav.setAttribute("aria-label", "Sipariş bölümleri");
  nav.innerHTML = tabs.map(([tab,label,path]) => '<button type="button" data-nav-tab="' + tab + '" aria-label="' + label + '">' + svg(path) + '<span>' + label + '</span></button>').join("") +
    '<details class="mobile-bottom-more"><summary aria-label="Raporlar ve diğer işlemler">' + svg("m6 15 6-6 6 6") + '<span>Diğer</span></summary><div class="mobile-bottom-popup" aria-label="Diğer işlemler">' +
    '<button type="button" data-nav-tab="iptal">İptal edilenler</button>' +
    '<a href="rapor.html" data-nav-report>Raporlar</a>' +
    '<button type="button" data-nav-existing="takerSettingsMenu" hidden>Telefon / Kişi Tanımları</button>' +
    '<button type="button" data-nav-existing="installAppBtn" hidden>Ana Ekrana Ekle</button>' +
    '<button type="button" data-nav-logout>Çıkış Yap</button></div></details>';
  document.body.appendChild(nav);
  const more = nav.querySelector("details");
  const close = () => { more.open = false; };
  function sync() {
    const active = sidebar.querySelector(".menu li.active");
    const tab = active?.id?.replace(/^tab_/, "") || (ordersPage ? "bekleyen" : "rapor");
    nav.querySelectorAll("[data-nav-tab]").forEach(button => {
      if (button.dataset.navTab === tab) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    const report = nav.querySelector("[data-nav-report]");
    if (!ordersPage) report.setAttribute("aria-current", "page");
    else report.removeAttribute("aria-current");
    more.classList.toggle("has-active-page", !tabs.some(([key]) => key === tab));
    nav.querySelectorAll("[data-nav-existing]").forEach(button => {
      const source = document.getElementById(button.dataset.navExisting);
      button.hidden = !source || source.hidden || source.style.display === "none";
    });
  }
  nav.addEventListener("click", event => {
    const button = event.target.closest("[data-nav-tab],[data-nav-existing],[data-nav-logout],[data-nav-report]");
    if (!button) return;
    close();
    if (button.dataset.navTab) {
      const tab = button.dataset.navTab;
      if (ordersPage && typeof window.setTab === "function") {
        window.setTab(tab);
        window.scrollTo(0, 0);
      } else location.href = "index.html?tab=" + encodeURIComponent(tab);
    } else if (button.dataset.navExisting) {
      document.getElementById(button.dataset.navExisting)?.click();
    } else if (button.hasAttribute("data-nav-logout")) {
      sidebar.querySelector(".btn-logout, .btn-danger")?.click();
    }
  });
  document.addEventListener("click", event => { if (!nav.contains(event.target)) close(); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && more.open) { close(); more.querySelector("summary").focus(); }
  });
  window.addEventListener("resize", () => { if (window.innerWidth > 900) close(); });
  new MutationObserver(sync).observe(sidebar, {subtree:true,attributes:true,attributeFilter:["class","hidden","style"]});
  sync();
})();
