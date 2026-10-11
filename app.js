/* ============================================================
   CONFIG YÜKLENENE KADAR BEKLE
============================================================ */
await window.waitConfig();

/* ============================================================
   SUPABASE
============================================================ */
const SUPABASE_URL = "https://jarsxtpqzqzhlshpmgot.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphcnN4dHBxenF6aGxzaHBtZ290Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyODExMTcsImV4cCI6MjA3Nzg1NzExN30.98oYONSkb8XSDrfGW2FxhFmt2BLB5ZRo3Ho50GhZYgE";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
await window.requireSession(db);


/* ============================================================
   REFERANS VERİLER (ŞEHİR / İLÇE)
============================================================ */
const cityCache = [];
const districtCache = new Map();

/* ============================================================
   MARKA AYARLARI
============================================================ */
const TABLE         = CONFIG.table;
const WH_KARGOLA    = CONFIG.webhooks.kargola;
const WH_BARKOD     = CONFIG.webhooks.barkod;
const WH_IPTAL      = CONFIG.webhooks.iptal;
const WH_SEHIR_ILCE = CONFIG.webhooks.sehir_ilce;

/* ============================================================
   GLOBAL STATE
============================================================ */
let currentTab = "bekleyen";
let currentPage = 1;
const PAGE_SIZE = 10;
let selectedOrder = null;

const busy = { kargola: new Set(), barkod: new Set() };



/* ============================================================
   UI HELPERS
============================================================ */
function getColumnCount(){
  return 7;
}

function shouldShowNoteColumn(tab) {
  return ["bekleyen", "hazirlandi"].includes(tab);
}

function shouldShowCargoCode(tab) {
  return ["kargolandi", "tamamlandi", "sorunlu"].includes(tab);
}

function renderTableHeader(){
  const head = document.getElementById("ordersHeadRow");
  if(!head) return;

  head.innerHTML = currentTab === "bekleyen"
  ? `
    <th>Hazırla</th>
    <th>S.No</th>
    <th>İsim</th>
    <th>Ürün</th>
    <th>Tutar</th>
    <th>Not</th>
    <th>Sipariş Alan</th>
  `
  : `
    <th>S.No</th>
    <th>İsim</th>
    <th>Ürün</th>
    <th>Tutar</th>
    <th>Durum</th>
    <th>${shouldShowNoteColumn(currentTab) ? "Not" : "Kargo Kodu"}</th>
    <th>${currentTab === "hazirlandi" ? "Hata / İşlem" : "İşlem"}</th>
  `;

}

function toast(msg, ms=2500){
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function toggleLoadMore(visible){
  const btn = document.getElementById("loadMoreBtn");
  if(!btn) return;
  btn.style.display = visible ? "block" : "none";
}

// Sidebar menü tıklanınca otomatik kapanması (mobil)
document.querySelectorAll(".sidebar .menu li").forEach(item => {
  item.addEventListener("click", () => {
    const sidebar = document.querySelector(".sidebar");
    if (sidebar.classList.contains("open")) {
      sidebar.classList.remove("open"); // KAPAT
    }
  });
});

function confirmModal({title, text, confirmText="Onayla", cancelText="Vazgeç"}){
  return new Promise(res=>{
    const root = document.getElementById("alertRoot");
    const wrap = document.createElement("div");
    wrap.className = "alert-backdrop";
    wrap.innerHTML = `
      <div class="alert-card">
        <div class="alert-title">${title}</div>
        <div class="alert-text">${(text||"").replace(/\n/g,"<br>")}</div>
        <div class="alert-actions">
          <button class="btn-ghost" id="cCancel">${cancelText}</button>
          <button class="btn-brand" id="cOk">${confirmText}</button>
        </div>
      </div>`;
    root.appendChild(wrap);
    const finish = value => { wrap.remove(); res(value); };
    wrap.dismiss = () => finish(false);
    wrap.querySelector("#cCancel").onclick = wrap.dismiss;
    wrap.querySelector("#cOk").onclick = () => finish(true);
  });
}

async function logout(){
  const { error } = await db.auth.signOut({ scope: "local" });
  if (error) return toast("Çıkış yapılamadı. Yeniden deneyin.");
  ["session", "firma", "rol", "print_order"].forEach(key => localStorage.removeItem(key));
  location.href = "login.html";
}


function formatDateTimeTR(iso) {
  if (!iso) return "-";

  const d = new Date(iso);
  if (isNaN(d)) return iso;

  const date = d.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });

  const time = d.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit"
  });

  return `${date} • ${time}`;
}

/* ============================================================
   LİSTELEME
============================================================ */
let listRequest = 0;
async function loadOrders(reset=false){
  syncCargoTools();
  const request = ++listRequest;
  const tbody = document.getElementById("ordersBody");
  if(reset){
    currentPage = 1;
    tbody.innerHTML = "";
  }

  renderTableHeader();
  updateListHeading(false, "Siparişler yükleniyor…");

  let q = db.from(TABLE).select("*", { count: "exact" });

  if(currentTab==="bekleyen")   q = q.eq("kargo_durumu","Bekliyor");
  if(currentTab==="hazirlandi") q = q.eq("kargo_durumu","Hazırlandı");
  if(currentTab==="kargolandi") q = q.eq("kargo_durumu","Kargolandı");
  if(currentTab==="tamamlandi") { q = q.or("shipmentStatusCode.eq.5,isDelivered.eq.true"); }
  if(currentTab==="sorunlu") {  q=q.in("shipmentStatusCode", [6,7]).eq("isDelivered", false); } // 6: sorunlu, 7: iade
  if(currentTab==="iptal")      q = q.eq("kargo_durumu","İptal");

  const start = (currentPage - 1) * PAGE_SIZE;
  const end   = currentPage * PAGE_SIZE - 1;

  q = q.order("siparis_no", { ascending:false })
       .range(start, end);

  const { data, error, count } = await q;
  if (request !== listRequest) return;
  if(error){
    tbody.innerHTML = `<tr><td colspan="${getColumnCount()}">HATA: ${error.message}</td></tr>`;
    toggleLoadMore(false);
    updateListHeading(false, "Liste yüklenemedi. Yeniden deneyin.");
    return;
  }

  const hasMore = typeof count === "number"
    ? count > currentPage * PAGE_SIZE
    : (data?.length === PAGE_SIZE);

  if(!reset && (!data || data.length === 0)){
    toggleLoadMore(false);
    return toast("Gösterilecek başka kayıt yok.");
  }

  renderTable(data, { append: !reset, hasMore });
  updateListHeading(false, `${tbody.children.length} sipariş gösteriliyor · Toplam ${count ?? data.length} kayıt`);
}

function renderTable(rows, { append=false, hasMore } = {}){
  const tbody = document.getElementById("ordersBody");
  if(!tbody) return;

  if(!append) tbody.innerHTML = "";

  if(!rows || rows.length===0){
    if(!append) tbody.innerHTML = `<tr><td colspan="${getColumnCount()}">Kayıt bulunamadı</td></tr>`;
    toggleLoadMore(false);
    return;
  }

  rows.forEach(o=>{
    const tr = document.createElement("tr");

   const durumText = ["kargolandi", "tamamlandi", "sorunlu"].includes(currentTab)
    ? (o.shipmentStatus ?? "—")
    : o.kargo_durumu;

    const isTrackingTab = ["kargolandi", "tamamlandi", "sorunlu"].includes(currentTab);

    const isPendingTab = currentTab === "bekleyen";

  const isPreparedTab = currentTab === "hazirlandi";

  const actionBtn = `<button class="btn-open" onclick="event.stopPropagation(); openOrder(${Number(o.siparis_no)})">Aç</button>`;

const errorPreview = isPreparedTab && o.gonder_hata_bilgisi
  ? `<button class="error-chip"
        data-error="${escapeHtml(o.gonder_hata_bilgisi ?? "")}"
        onclick="event.stopPropagation(); showErrorDetail(this.dataset.error)">
        <span class="error-chip__label">Hata</span>
        <span class="error-chip__text">${escapeHtml(shortenError(o.gonder_hata_bilgisi))}</span>
     </button>`
  : actionBtn;


// Not chip'i (Hata chip'i ile aynı class)
const noteChip = o.notlar ? `
  <button class="error-chip"
      data-note="${escapeHtml(o.notlar ?? "")}"
      onclick="event.stopPropagation(); showNoteDetail(this.dataset.note)">
      <span class="error-chip__label">Not</span>
      <span class="error-chip__text">${escapeHtml(shortenNote(o.notlar, 20))}</span>
  </button>
` : "—";

tr.innerHTML = isPendingTab
  ? `
    <td><button class="btn-open" onclick="event.stopPropagation(); prepareFromList(${Number(o.siparis_no)}, this)">Hazırla</button></td>
    <td>${o.siparis_no}</td>
    <td>${escapeHtml(o.ad_soyad)}</td>
    <td>
  <span class="order-product-limit"
        title="${escapeHtml(parseProduct(o.urun_bilgisi))}">
    ${escapeHtml(parseProduct(o.urun_bilgisi))}
  </span>
</td>

    <td>${o.toplam_tutar} TL</td>
    <td>${noteChip}</td>
    <td>${escapeHtml(o.siparis_alan ?? "-")}</td>
  `
  : `
    <td>${o.siparis_no}</td>
    <td>${o.ad_soyad}</td>
    <td>
  <span class="order-product-limit"
        title="${escapeHtml(parseProduct(o.urun_bilgisi))}">
    ${escapeHtml(parseProduct(o.urun_bilgisi))}
  </span>
</td>

    <td>${o.toplam_tutar} TL</td>
<td>${isTrackingTab ? cargoStatusBadge(o) : escapeHtml(durumText ?? "—")}</td>

<td>
  ${
    shouldShowNoteColumn(currentTab)
      ? noteChip
      : (o.kargo_takip_kodu ?? "-")
  }
</td>

<td>${errorPreview}</td>

  `;

// Satır tıklama kontrolü (chip'e tıklayınca detay açılmasın)
tr.addEventListener("click", (e)=>{
  if (
    e.target.classList.contains("btn-open") ||
    e.target.closest(".error-chip")
  ) return;
  openOrder(o.siparis_no);
});


tbody.appendChild(tr);
});

  if(typeof hasMore === "boolean") toggleLoadMore(hasMore);
}

function parseProduct(v){
  if(!v) return "-";
  if(Array.isArray(v)) return v.join(", ");
  v = String(v);
  try{
    if(v.startsWith("[") && v.endsWith("]")) return JSON.parse(v).join(", ");
  }catch{}
  return v;
}

function shortenError(text, max=55){
  if(!text) return "Hata bilgisi yok";
  if(text.length <= max) return text;
  return text.slice(0, max) + "...";
}
function shortenNote(text, max = 40){
  if (!text) return "";
  return text.length <= max ? text : text.slice(0, max) + "...";
}


function escapeHtml(str=""){
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showNoteDetail(note = "") {
  console.log("NOT CLICK:", note); // 🔥 DEBUG (bunu görmelisin)

  if (!note) {
    toast("Not bilgisi yok");
    return;
  }

  const root = document.getElementById("alertRoot");
  if (!root) {
    alert(note); // fallback
    return;
  }

  // varsa eskisini kapat
  root.querySelectorAll(".alert-backdrop").forEach(n => n.remove());

  const wrap = document.createElement("div");
  wrap.className = "alert-backdrop";
  wrap.innerHTML = `
    <div class="alert-card">
      <div class="alert-title">📝 Sipariş Notu</div>
      <div class="alert-text">
        <textarea class="error-detail-text" readonly>${escapeHtml(note)}</textarea>
      </div>
      <div class="alert-actions">
        <button class="btn-brand" id="noteCloseBtn">Kapat</button>
      </div>
    </div>
  `;

  root.appendChild(wrap);

  wrap.querySelector("#noteCloseBtn").onclick = () => wrap.remove();
}


/* ============================================================
   KARGO SORGULAMA
============================================================ */
function openTrackingUrl(url){
  if(!url) return toast("Kargo sorgulama linki yok.");
  try { const safe = new URL(url); if(safe.protocol !== "https:") throw new Error(); window.open(safe.href, "_blank", "noopener,noreferrer"); }
  catch { toast("Kargo takip bağlantısı geçersiz."); }
}

function cargoStatusInfo(order){
  const code=Number(order.shipmentStatusCode);
  const states={1:["created","Gönderi hazırlandı"],2:["transit","Transfer aşamasında"],3:["transit","Teslimat biriminde"],4:["delivery","Dağıtımda"],5:["delivered","Teslim edildi"],6:["problem","Teslim edilemedi"],7:["problem","İade geliyor"],8:["problem","Destek gerekiyor"]};
  const [tone,label]=order.isDelivered===true ? states[5] : (states[code]||["unknown","Durum bekleniyor"]);
  return {tone,label:String(order.shipmentStatus||label).replace(/_/g," ")};
}
function cargoStatusBadge(order){
  const {tone,label}=cargoStatusInfo(order);
  const checked=order.kargo_gunc_saat ? `<small class="cargo-checked">${escapeHtml(formatDateTimeTR(order.kargo_gunc_saat))}</small>` : "";
  return `<span class="cargo-status cargo-status--${tone}">${escapeHtml(label)}</span>${checked}`;
}
function isLiveShipment(order){
  try { return JSON.parse(order.kargo_api_yanit||"{}").environment==="test" && !!order.kargo_takip_kodu; }
  catch { return false; }
}
function syncCargoTools(){
  const tools=document.getElementById("cargoTools");
  if(tools) tools.hidden=!["kargolandi","tamamlandi","sorunlu"].includes(currentTab);
}
async function cargoRequest(url,body={}){
  if(!url) throw new Error("Canlı kargo bağlantısı ayarlanmamış.");
  const {data:sessionData}=await db.auth.getSession();
  if(!sessionData.session?.access_token)throw new Error("Oturum gerekli. Panele yeniden giriş yapın.");
  body={...body,accessToken:sessionData.session.access_token,publicKey:SUPABASE_KEY};
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),180000);
  try{
    const response=await fetch(url,{method:"POST",body:new URLSearchParams(body),signal:controller.signal});
    let result;try{result=JSON.parse(await response.text());}catch{throw new Error("n8n geçerli JSON yanıtı döndürmedi.");}
    if(!response.ok||result.success!==true||result.environment!=="test")throw new Error(result.message||"DHL test işlemi başarısız.");
    return result;
  }catch(error){if(error.name==="AbortError")throw new Error("DHL test isteği zaman aşımına uğradı.");if(error instanceof TypeError)throw new Error("Kargo bağlantısına ulaşılamadı. n8n erişimini kontrol edin.");throw error;}
  finally{clearTimeout(timeout);}
}
let cargoSyncBusy=false;
async function connectCargo(){
  const button=document.getElementById("connectCargoBtn");if(button.disabled)return;
  button.disabled=true;const label=button.textContent;button.textContent="Bağlanıyor…";
  try{
    const result=await cargoRequest(CONFIG.webhooks.baglan,{operation:"baglan"});
    document.getElementById("cargoSyncStatus").textContent="DHL test bağlantısı hazır. Token geçerlilik: "+result.jwtExpireDate;
    toast("DHL test hesabına bağlanıldı. Token n8n'de saklandı.");
  }catch(error){toast(error.message,8000);}
  finally{button.disabled=false;button.textContent=label;}
}
async function refreshCargoMovements(){
  if(cargoSyncBusy)return;
  cargoSyncBusy=true;const button=document.getElementById("refreshCargoBtn");const status=document.getElementById("cargoSyncStatus");button.disabled=true;
  let success=0,failed=0,warnings=0,skipped=0;const errors=[];
  try{
    status.textContent="Kargolanmış siparişler bulunuyor…";
    const candidates=[];
    for(let offset=0;;offset+=100){
      const {data,error}=await db.from(TABLE).select("siparis_no,kargo_takip_kodu,kargo_api_yanit").eq("kargo_durumu","Kargolandı").order("siparis_no",{ascending:true}).range(offset,offset+99);
      if(error)throw error;
      for(const row of data||[]){if(isLiveShipment(row))candidates.push(row);else skipped++;}
      if((data||[]).length<100)break;
    }
    if(!candidates.length){status.textContent="Güncellenecek test gönderisi yok. "+skipped+" canlı / takip numarası olmayan sipariş atlandı.";return;}
    for(let i=0;i<candidates.length;i++){
      const order=candidates[i];status.textContent=`${i+1}/${candidates.length} · Sipariş ${order.siparis_no} güncelleniyor…`;
      try{const result=await cargoRequest(CONFIG.webhooks.hareket,{operation:"hareket",siparis_no:String(order.siparis_no)});success++;if(result.warning){warnings++;errors.push("Sipariş "+order.siparis_no+": "+result.warning);}}
      catch(error){failed++;errors.push("Sipariş "+order.siparis_no+": "+error.message);}
    }
    status.textContent=`${success} durum güncellendi · ${warnings} hareket uyarısı · ${failed} başarısız · ${skipped} test / takip numarası olmayan sipariş atlandı.`;
    await loadOrders(true);
    if(selectedOrder&&document.getElementById("orderModal").style.display==="flex")await openOrder(selectedOrder.siparis_no);
    if(errors.length)showErrorDetail(errors.join("\n"));
    else toast("Kargo hareketleri güncellendi.");
  }catch(error){status.textContent="Güncelleme tamamlanamadı: "+error.message;toast(error.message,8000);}
  finally{cargoSyncBusy=false;button.disabled=false;}
}
function renderCargoTracking(order){
  if(!order.kargo_takip_kodu)return "";
  let tracking;try{tracking=JSON.parse(order.kargo_api_yanit||"{}").tracking;}catch{}
  const movements=Array.isArray(tracking?.movements)?[...tracking.movements].sort((a,b)=>Number(b.eventSequence)-Number(a.eventSequence)):[];
  const timeline=movements.map(m=>`<li><strong>${escapeHtml(m.eventStatus||"Kargo hareketi")}</strong><span>${escapeHtml(m.eventDateTime||m.eventDateTime2||"")} · ${escapeHtml(m.location||"")}</span>${m.description?`<span>${escapeHtml(m.description)}</span>`:""}</li>`).join("");
  const url=order.kargo_takip_url;
  let link="";try{if(new URL(url).protocol==="https:")link=`<a class="btn-open" target="_blank" rel="noopener noreferrer" href="${escapeHtml(url)}">Kargo Takip Sayfası</a>`;}catch{}
  return `<div class="detail-group cargo-detail"><div class="detail-title">🚚 Kargo Bilgileri</div>${cargoStatusBadge(order)}<p>Takip no: ${escapeHtml(order.kargo_takip_kodu)}</p>${link}${timeline?`<ol class="cargo-timeline">${timeline}</ol>`:"<p class='cargo-empty'>Henüz kayıtlı kargo hareketi yok.</p>"}${tracking?.movementError?`<p class="cargo-warning">${escapeHtml(tracking.movementError)}</p>`:""}</div>`;
}


function printEtiket(){
  localStorage.setItem("print_order", JSON.stringify(selectedOrder));
  window.open("printetiket-v2.html?v=20261011-4", "_blank", "width=320,height=240");
}
function openPrintChooser(){
  const root = document.getElementById("alertRoot");
  root.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "alert-backdrop";

  wrap.innerHTML = `
    <div class="alert-card">
      <div class="alert-title">🖨 Yazdırma Seçimi</div>

      <div class="alert-actions" style="flex-direction:column;gap:10px">
        <button class="btn-primary" id="btnPrintAdisyon">
          🧾 Adisyon Yazdır
        </button>

        <button class="btn-secondary" id="btnPrintEtiket">
          🏷 Etiket Yazdır (58×40 mm)
        </button>

        <button class="btn-close" id="btnCancelPrint">
          Vazgeç
        </button>
      </div>
    </div>
  `;

  root.appendChild(wrap);

  // 🔥 JS EVENT BIND (EN KRİTİK KISIM)
  document.getElementById("btnPrintAdisyon").onclick = () => {
    printSiparis(selectedOrder);
  };

  document.getElementById("btnPrintEtiket").onclick = () => {
    printEtiket();
  };

  document.getElementById("btnCancelPrint").onclick = () => {
    wrap.remove();
  };
}



/* ============================================================
   İPTALDEN SİLME
============================================================ */

async function deleteCanceledOrder() {

  const ok = await confirmModal({
    title: "Siparişi Sil",
    text: "Bu sipariş tamamen listelerden kaldırılacaktır. İşlem geri alınamaz.\nOnaylıyor musunuz?",
    confirmText: "Sil",
    cancelText: "Vazgeç"
  });

  if (!ok) return;

  if (!await updateSelectedOrder({kargo_durumu:"Silindi", iptal_nedeni:null, iptal_tarihi:new Date().toISOString()})) return;

  toast("Sipariş silindi");
  closeModal();

  setTimeout(() => loadOrders(true), 1000);
}




/* ============================================================
   GÖNDERİM HATA DETAYI
============================================================ */
function showErrorDetail(message=""){
  const root = document.getElementById("alertRoot");
  const wrap = document.createElement("div");
  wrap.className = "alert-backdrop";

  const safeMessage = message || "Gönderim hatası kaydı bulunamadı.";

  wrap.innerHTML = `
    <div class="alert-card error-detail-card">
      <div class="alert-title">Gönderim Hata Bilgisi</div>
      <div class="alert-text">
        <textarea class="error-detail-text" readonly>${escapeHtml(safeMessage)}</textarea>
      </div>
      <div class="alert-actions">
        <button class="btn-brand" id="errorClose">Kapat</button>
      </div>
    </div>`;

  root.appendChild(wrap);

  wrap.querySelector("#errorClose").onclick = () => wrap.remove();
}

/* ============================================================
   API ÖNİZLEME POPUP (tek örnek, güvenli)
============================================================ */
function showApiResult(content) {
  const root = document.getElementById("alertRoot");
  // Önce var olanı sil (tek örnek olsun)
  root.querySelectorAll(".alert-backdrop").forEach(n => n.remove());

  const wrap = document.createElement("div");
  wrap.className = "alert-backdrop";
  // Backdrop tıklamasıyla kapansın (karta tıklamada kapanmasın)
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) wrap.remove();
  });

  // İçerik: PNG <img> ya da metin (ZPL/JSON)
  const isString = typeof content === "string";
  const html = isString && content.trim().startsWith("<img")
    ? content
    : `<textarea class="error-detail-text" readonly>${
        isString ? content : JSON.stringify(content, null, 2)
      }</textarea>`;

  wrap.innerHTML = `
    <div class="alert-card" style="pointer-events:auto">
      <div class="alert-title">API Yanıtı</div>
      <div class="alert-text">${html}</div>
      <div class="alert-actions">
        <button class="btn-brand" id="apiOkBtn">Kapat</button>
      </div>
    </div>
  `;
  root.appendChild(wrap);

  wrap.querySelector("#apiOkBtn").onclick = () => wrap.remove();
}

/* ============================================================
   DETAY
============================================================ */
async function openOrder(id){
  const { data } = await db.from(TABLE).select("*").eq("siparis_no", id).single();
  if(!data) return toast("Sipariş bulunamadı!");
  selectedOrder = data;
  renderDetails();
  document.getElementById("orderModal").style.display = "flex";
}

function closeModal(){ 
  document.getElementById("orderModal").style.display = "none"; 
}

function renderDetails() {
  const d = selectedOrder;

  /* — TÜM BUTONLARI RESETLE — */
  document.querySelectorAll("#actionButtons button").forEach(btn => {
    btn.style.display = "inline-block";
  });

  /* — DETAY HTML — */
document.getElementById("orderDetails").innerHTML = `
<div class="detail-layout" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:start;">
<div class="detail-column detail-column-customer">
  <div class="detail-group">
    <div class="detail-title">📞Müşteri İletişim</div>    
    <div class="detail-item"><b>İsim:</b> ${escapeHtml(d.ad_soyad ?? "—")}</div>
    <div class="detail-item"><b>Müşteri Tel:</b> ${escapeHtml(d.musteri_tel ?? "—")}</div>
  </div>

  <div class="detail-group">
    <div class="detail-title">📍 Adres Bilgileri</div>
    <div class="detail-item"><b>Adres:</b> ${escapeHtml(d.adres ?? "—")}</div>
    <div class="detail-item">
      <b>Şehir / İlçe:</b> ${escapeHtml(d.sehir ?? "—")} / ${escapeHtml(d.ilce ?? "—")}
      <button class="btn-mini" onclick="queryCityDistrictCodes()">Sor</button>
    </div>
    <div class="detail-item">
      <small>Kodlar: ${d.sehir_kodu ?? "-"} / ${d.ilce_kodu ?? "-"}</small>
    </div>
  </div>


</div>
<div class="detail-column detail-column-order">

  <div class="detail-group">
    <div class="detail-item"><b>No:</b> ${d.siparis_no}</div>
    <div class="detail-item"><b>Sipariş Alan:</b> ${d.siparis_alan ?? "-"}</div>
    <div class="detail-item"><b>Sipariş Alan Tel:</b> ${escapeHtml(d.siparis_tel ?? "—")}</div>    
    <div class="detail-item" style="margin-top:6px;">
  <span class="pill pill-date">
    📅 ${formatDateTimeTR(d.tarih)}
  </span>
</div>

  </div>

  <div class="detail-group">
    <div class="detail-title">📦 Ürün Bilgisi</div>
    <div class="detail-item"><b>Ürün:</b> ${escapeHtml(parseProduct(d.urun_bilgisi))}</div>
    <div class="detail-item"><b>Adet:</b> ${d.kargo_adet ?? "-"}</div>
    <div class="detail-item"><b>KG:</b> ${d.kargo_kg ?? "-"}</div>
    <div class="detail-item"><b>Tutar:</b> ${escapeHtml(d.toplam_tutar ?? "—")} TL</div>
    <div class="detail-item"><b>Ödeme:</b> ${escapeHtml(d.odeme_sekli ?? "—")}</div>
  </div>

</div>

<div class="detail-group detail-note" style="grid-column:1 / -1;">
  <div class="detail-title">📝 Not</div>

  ${
    d.notlar
      ? `
        <div class="note-card">
          <div class="note-text">${escapeHtml(d.notlar)}</div>
        </div>
      `
      : `
        <div class="note-empty">Not girilmemiş</div>
      `
  }
</div>


</div>
`;

  document.getElementById("orderDetails").insertAdjacentHTML("beforeend",renderCargoTracking(d));
  /* ============================================================
      1) SOR BUTONU — SADECE Bekliyor & Hazırlandı
  ============================================================ */
  try {
    const sorBtn = document.querySelector(".btn-mini");
    if (sorBtn) {
      sorBtn.style.display = ["Bekliyor", "Hazırlandı"].includes(d.kargo_durumu)
        ? "inline-block"
        : "none";
    }
  } catch {}

  /* ============================================================
      2) DÜZENLE BUTONU
         Hazırlandı → Gizle
         Kargolandı → Gizle  ❗ (senin istediğin)
  ============================================================ */
  try {
    const duzenleBtn = document.querySelector("#actionButtons .btn-warning");
    if (duzenleBtn && ["Hazırlandı", "Kargolandı"].includes(d.kargo_durumu)) {
      duzenleBtn.style.display = "none";
    }
  } catch {}


  /* ============================================================
      3) BEKLİYOR BUTONU
         Bekleyen → gizle
         Hazırlandı → göster
         Diğer durumlar → gizle
  ============================================================ */
  try {
    const bekliyorBtn = document.getElementById("btnWaiting");

    if (bekliyorBtn) {
      if (d.kargo_durumu === "Bekliyor") {
        bekliyorBtn.style.display = "none";
      } else if (d.kargo_durumu === "Hazırlandı") {
        bekliyorBtn.style.display = "inline-block";
      } else {
        bekliyorBtn.style.display = "none";
      }
    }
  } catch {}


  /* ============================================================
      4) DİĞER BUTONLAR
  ============================================================ */

  const iptal = d.kargo_durumu === "İptal";
  const kargo = d.kargo_durumu === "Kargolandı";
  const tamam = d.kargo_durumu === "Tamamlandı";

  // Bekleyeni → Hazırla
  document.getElementById("btnPrepare").style.display =
    d.kargo_durumu === "Bekliyor" ? "inline-block" : "none";

  // Hazırlandı → Kargola
  document.getElementById("btnCargo").style.display =
    d.kargo_durumu === "Hazırlandı" ? "inline-block" : "none";

  // Mevcut etiketi tekrar aç; yeni kargo / barkod oluşturma.
  document.getElementById("btnBarcode").style.display =
    (kargo || tamam || d.isDelivered) && d.zpl_base64 ? "inline-block" : "none";

  // Tamamlandı → butonları kapat, sadece kapat butonu açık kalsın
  if (tamam) {
    document.querySelectorAll("#actionButtons button").forEach(btn => {
      btn.style.display = "none";
    });
    document.querySelector("#actionButtons .btn-close").style.display = "inline-block";
    if(d.zpl_base64)document.getElementById("btnBarcode").style.display="inline-block";
  }

  // İptal → tüm actionButtons gizli, restoreButtons açık
  document.getElementById("actionButtons").style.display = iptal ? "none" : "flex";
  document.getElementById("restoreButtons").style.display = iptal ? "flex" : "none";

  // edit mode kapanmalı
  document.getElementById("editButtons").style.display = "none";
  document.getElementById("cancelForm").style.display = "none";
}


/* ============================================================
   ŞEHİR/İLÇE KODU SOR  (ORİJİNAL - WEBHOOK İLE)
============================================================ */
async function queryCityDistrictCodes(){
  toast("Kodlar sorgulanıyor...");

  const res = await fetch(WH_SEHIR_ILCE, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(selectedOrder)
  });

  if(!res.ok) return toast("Kod bulunamadı");

  const d = await res.json();

  await db.from(TABLE)
    .update({ sehir_kodu:d.sehir_kodu, ilce_kodu:d.ilce_kodu })
    .eq("siparis_no", selectedOrder.siparis_no);

  toast("Kodlar güncellendi");
  openOrder(selectedOrder.siparis_no);
}

/* ============================================================
   ŞEHİR / İLÇE REFERANSI
============================================================ */
async function loadCities(){
  if(cityCache.length) return cityCache;

  const { data, error } = await db
    .from("sehir")
    .select("id, name")
    .order("name", { ascending:true });

  if(error){
    toast("Şehir listesi alınamadı");
    return [];
  }

  cityCache.splice(0, cityCache.length, ...(data || []));
  return cityCache;
}

async function loadDistricts(cityId){
  if(!cityId) return [];
  if(districtCache.has(cityId)) return districtCache.get(cityId) || [];

  const { data, error } = await db
    .from("ilce")
    .select("id, city_id, name, code")
    .eq("city_id", cityId)
    .order("name", { ascending:true });

  if(error){
    toast("İlçe listesi alınamadı");
    districtCache.set(cityId, []);
    return [];
  }

  districtCache.set(cityId, data || []);
  return data || [];
}

function findCityIdForOrder(order, cities){
  if(order?.sehir_kodu){
    const hit = cities.find(c => String(c.id) === String(order.sehir_kodu));
    if(hit) return String(hit.id);
  }

  if(order?.sehir){
    const hit = cities.find(c => c.name?.toLowerCase() === order.sehir.toLowerCase());
    if(hit) return String(hit.id);
  }

  return "";
}

function findDistrictIdForOrder(order, districts){
  if(order?.ilce_kodu){
    const hit = districts.find(d => String(d.code) === String(order.ilce_kodu));
    if(hit) return String(hit.id);
  }

  if(order?.ilce){
    const hit = districts.find(d => d.name?.toLowerCase() === order.ilce.toLowerCase());
    if(hit) return String(hit.id);
  }

  return "";
}

function renderOptions(selectEl, list, { placeholder="Seçiniz", selectedValue="", includeCode=false } = {}){
  if(!selectEl) return;
  const opts = [`<option value="">${placeholder}</option>`];
  (list || []).forEach(item => {
    const attrs = [
      `value="${item.id}"`,
      includeCode ? `data-code="${item.code ?? ''}"` : ""
    ].filter(Boolean).join(" ");

    opts.push(`<option ${attrs}>${item.name}</option>`);
  });

  selectEl.innerHTML = opts.join("");
  if(selectedValue) selectEl.value = String(selectedValue);
}

async function populateDistrictSelect(cityId, selectedDistrictId){
  const districtSelect = document.getElementById("ilce_select");
  const ilceInput      = document.getElementById("ilce");
  const ilceKoduInput  = document.getElementById("ilce_kodu");

  const districts = await loadDistricts(cityId);

  renderOptions(districtSelect, districts, {
    placeholder: cityId ? "İlçe seçiniz" : "Önce şehir seçin",
    selectedValue: selectedDistrictId,
    includeCode: true,
  });

  const active = districtSelect?.selectedOptions?.[0];
  if(active){
    ilceInput.value = active.textContent;
    ilceKoduInput.value = active.dataset.code || "";
  }else{
    ilceInput.value = "";
    ilceKoduInput.value = "";
  }
}

/* ============================================================
   DÜZENLEME
============================================================ */
async function enterEditMode(){
  const d = selectedOrder;
  const cities = await loadCities();
  const selectedCityId = findCityIdForOrder(d, cities);
  const districts = selectedCityId ? await loadDistricts(selectedCityId) : [];
  const selectedDistrictId = findDistrictIdForOrder(d, districts);

  document.getElementById("orderDetails").innerHTML = `
    <div class="edit-card">
      <div class="edit-card__header">
        <div>
          <p class="eyebrow">Sipariş No</p>
          <p class="title">${d.siparis_no}</p>
        </div>
        <div class="pill">Durum: ${d.kargo_durumu}</div>
      </div>

      <div class="edit-grid">
        <div class="form-field"><label>Ad Soyad</label><input id="ad_soyad" value="${d.ad_soyad??""}"></div>
        <div class="form-field"><label>Sipariş Tel</label><input id="siparis_tel" value="${d.siparis_tel??""}"></div>
        <div class="form-field"><label>Müşteri Tel</label><input id="musteri_tel" value="${d.musteri_tel??""}"></div>

        <div class="form-field full-row"><label>Adres</label><textarea id="adres">${d.adres??""}</textarea></div>

        <div class="form-field">
          <label>Şehir</label>
          <select id="sehir_select"></select>
          <input id="sehir" type="hidden" value="${d.sehir ?? ""}">
        </div>

        <div class="form-field">
          <label>İlçe</label>
          <select id="ilce_select"></select>
          <input id="ilce" type="hidden" value="${d.ilce ?? ""}">
        </div>

        <div class="form-field">
          <label>Şehir Kodu</label>
          <input id="sehir_kodu" class="input-ghost" value="${d.sehir_kodu ?? ""}" readonly>
        </div>

        <div class="form-field">
          <label>İlçe Kodu</label>
          <input id="ilce_kodu" class="input-ghost" value="${d.ilce_kodu ?? ""}" readonly>
        </div>

        <div class="form-field"><label>Kargo Adet</label><input id="kargo_adet" value="${d.kargo_adet??""}"></div>
        <div class="form-field"><label>Kargo KG</label><input id="kargo_kg" value="${d.kargo_kg??""}"></div>

        <div class="form-field full-row"><label>Ürün</label><textarea id="urun_bilgisi">${d.urun_bilgisi??""}</textarea></div>
        <div class="form-field"><label>Tutar</label><input id="toplam_tutar" value="${d.toplam_tutar??""}"></div>
        <div class="form-field"><label>Ödeme</label><input id="odeme_sekli" value="${d.odeme_sekli??""}"></div>
        <div class="form-field full-row"><label>Not</label><textarea id="notlar">${d.notlar??""}</textarea></div>
      </div>
    </div>`;

  renderOptions(document.getElementById("sehir_select"), cities, {
    placeholder: "Şehir seçiniz",
    selectedValue: selectedCityId,
  });

  await populateDistrictSelect(selectedCityId, selectedDistrictId);

  const citySelect = document.getElementById("sehir_select");
  const districtSelect = document.getElementById("ilce_select");
  const sehirInput = document.getElementById("sehir");
  const ilceInput = document.getElementById("ilce");
  const sehirKoduInput = document.getElementById("sehir_kodu");
  const ilceKoduInput = document.getElementById("ilce_kodu");

  // ilk açılış değerleri
  sehirInput.value = citySelect?.selectedOptions?.[0]?.textContent || (d.sehir ?? "");
  sehirKoduInput.value = citySelect?.value || (d.sehir_kodu ?? "");

  const activeDistrict = districtSelect?.selectedOptions?.[0];
  if(activeDistrict){
    ilceInput.value = activeDistrict.textContent;
    ilceKoduInput.value = activeDistrict.dataset.code || "";
  }

  citySelect?.addEventListener("change", async()=>{
    const name = citySelect.selectedOptions?.[0]?.textContent || "";
    sehirInput.value = name;
    sehirKoduInput.value = citySelect.value || "";
    await populateDistrictSelect(citySelect.value, "");
  });

  districtSelect?.addEventListener("change", ()=>{
    const opt = districtSelect.selectedOptions?.[0];
    ilceInput.value = opt?.textContent || "";
    ilceKoduInput.value = opt?.dataset.code || "";
  });

  document.getElementById("actionButtons").style.display = "none";
  document.getElementById("editButtons").style.display = "flex";
}

async function saveEdit(){
  const citySelect = document.getElementById("sehir_select");
  const districtSelect = document.getElementById("ilce_select");

  const sehirName = citySelect?.selectedOptions?.[0]?.textContent || (document.getElementById("sehir")?.value ?? "");
  const ilceName  = districtSelect?.selectedOptions?.[0]?.textContent || (document.getElementById("ilce")?.value ?? "");

  const sehirKoduVal = citySelect?.value || document.getElementById("sehir_kodu")?.value || null;
  const ilceKoduVal  = districtSelect?.selectedOptions?.[0]?.dataset.code || document.getElementById("ilce_kodu")?.value || null;

  const updated = {
    ad_soyad: ad_soyad.value, siparis_tel: siparis_tel.value, musteri_tel: musteri_tel.value,
    adres: adres.value, sehir: sehirName, ilce: ilceName,
    sehir_kodu: sehirKoduVal, ilce_kodu: ilceKoduVal,
    kargo_adet: kargo_adet.value, kargo_kg: kargo_kg.value,
    urun_bilgisi: urun_bilgisi.value, toplam_tutar: toplam_tutar.value,
    odeme_sekli: odeme_sekli.value, notlar: notlar.value
  };
  if (!await updateSelectedOrder(updated)) return;
  toast("Kaydedildi");
  closeModal();
  loadOrders(true);
}

async function updateSelectedOrder(values) {
  if (!selectedOrder?.siparis_no) { toast("Önce sipariş seçin."); return false; }
  try {
    const { data, error } = await db.from(TABLE).update(values)
      .eq("siparis_no", selectedOrder.siparis_no).select("siparis_no").single();
    if (error || !data) throw error || new Error("Kayıt güncellenemedi");
    return true;
  } catch (error) {
    console.error("Güncelleme hatası:", error);
    toast("İşlem tamamlanamadı. Değişiklikler kaydedilmedi.");
    return false;
  }
}

function cancelEdit(){
  renderDetails();
  document.getElementById("editButtons").style.display = "none";
  document.getElementById("actionButtons").style.display = "flex";
}

/* ============================================================
   DURUMLAR
============================================================ */
let waitingBusy = false;

async function setWaiting(){
  if (waitingBusy) return;
  waitingBusy = true;

  const siparisNo = selectedOrder?.siparis_no;

  if(!siparisNo){
    waitingBusy = false;
    return toast("Sipariş numarası bulunamadı.");
  }

  // Önce panel/veritabanı durumunu değiştir
  const { error } = await db
    .from(TABLE)
    .update({ kargo_durumu: "Bekliyor" })
    .eq("siparis_no", siparisNo);

  if(error){
    waitingBusy = false;
    console.error(error);
    return toast("Sipariş güncellenemedi.");
  }

  // Kullanıcıya ANINDA sonucu göster
  toast("Sipariş Bekliyor ⏳");
  closeModal();
  loadOrders(true);

  // WhatsApp işlemini arkada yap.
  // Panel bunun bitmesini BEKLEMİYOR.
  db.functions.invoke("whatsapp-reaction", {
    body: {
      siparis_no: siparisNo,
      emoji: "⏳"
    }
  }).then(({ error }) => {
    if(error) console.error("WhatsApp reaksiyon hatası:", error);
  }).catch(err => {
    console.error("WhatsApp reaksiyon hatası:", err);
  }).finally(() => {
    waitingBusy = false;
  });
}

const preparingOrders = new Set();
async function prepareFromList(siparisNo, button){
  if(preparingOrders.has(siparisNo)) return;
  const printWindow = window.open("", "_blank");
  if(!printWindow) return toast("Yazdırma ekranı için açılır pencerelere izin verin.");
  printWindow.document.body.textContent="Sipariş hazırlanıyor…";
  preparingOrders.add(siparisNo);
  button.disabled=true;
  try {
    const {data:order,error:readError}=await db.from(TABLE).select("*").eq("siparis_no",siparisNo).single();
    if(readError) throw readError;
    const count=Number(order.kargo_adet);
    if(!Number.isSafeInteger(count)||count<1||count>100) throw new Error("Siparişin kargo adedini düzeltin.");
    const {data:updated,error}=await db.from(TABLE).update({kargo_durumu:"Hazırlandı"}).eq("siparis_no",siparisNo).eq("kargo_durumu","Bekliyor").select("siparis_no");
    if(error) throw error;
    if(!updated?.length) throw new Error("Sipariş artık Bekleyen durumunda değil.");
    const {error:reactionError}=await db.functions.invoke("whatsapp-reaction",{body:{siparis_no:siparisNo,emoji:"📦"}});
    if(reactionError) toast("Hazırlandı; WhatsApp emojisi gönderilemedi.",6000);
    localStorage.setItem("prepare_print_"+siparisNo,JSON.stringify(order));
    if(!printWindow.closed) printWindow.location.replace("printetiket-v2.html?v=20261011-prepared-label&order="+encodeURIComponent(siparisNo));
    toast("Sipariş hazırlandı. "+count+" paket barkodu açıldı.");
    await loadOrders(true);
  } catch(error){
    if(!printWindow.closed) printWindow.close();
    toast(error.message||"Sipariş hazırlanamadı.",6000);
  } finally {preparingOrders.delete(siparisNo);button.disabled=false;}
}
window.prepareFromList=prepareFromList;

async function markPrepared(){

  const siparisNo = selectedOrder?.siparis_no;

  if(!siparisNo){
    toast("Sipariş numarası bulunamadı.");
    return;
  }

  // Siparişi Hazırlandı yap
  const { error } = await db
    .from(TABLE)
    .update({
      kargo_durumu: "Hazırlandı"
    })
    .eq("siparis_no", siparisNo);

  if(error){
    console.error("Hazırlama hatası:", error);
    toast("Sipariş hazırlanamadı.");
    return;
  }

  // WhatsApp mesajına 📦 reaksiyonu gönder
  try {

    const { error: reactionError } =
      await db.functions.invoke("whatsapp-reaction", {
        body: {
          siparis_no: siparisNo,
          emoji: "📦"
        }
      });

    if(reactionError){
      console.error("WhatsApp reaksiyon hatası:", reactionError);
    }

  } catch(err) {
    console.error("WhatsApp reaksiyon hatası:", err);
  }

  // Yazdırma seçimi
  openPrintChooser();

  toast("Sipariş Hazırlandı 📦");

  closeModal();

  setTimeout(() => loadOrders(true), 1000);
}

function openCargoPdf(w, base64){
  if(!base64?.startsWith("JVBER")) throw new Error("Geçerli etiket PDF'si alınamadı.");
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  const url=URL.createObjectURL(new Blob([bytes],{type:"application/pdf"}));
  if(w.closed){URL.revokeObjectURL(url);throw new Error("Etiket penceresi kapatıldı. Barkod Kes ile tekrar açabilirsiniz.");}
  w.document.body.innerHTML='<iframe title="Paket Etiketleri" style="border:0;width:100%;height:100vh" src="'+url+'#view=FitH"></iframe>';
  w.document.body.style.cssText="margin:0";
  w.document.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();w.close();}});
  w.addEventListener("unload",()=>URL.revokeObjectURL(url),{once:true});
}
async function sendToCargo(){
  const siparisNo=selectedOrder?.siparis_no;
  if(!siparisNo) return toast("Önce sipariş seçin.");
  if(busy.kargola.has(siparisNo)) return toast("Kargolama sürüyor.");
  const ok=await confirmModal({title:"Siparişi Kargola",text:"Sipariş DHL test hesabıyla kargolanacak. Her paketin kargo etiketi hazırlanıp açılacak. Devam edilsin mi?",confirmText:"Evet, Kargola",cancelText:"Vazgeç"});
  if(!ok) return;
  const w=window.open("","_blank");
  if(!w) return toast("Etiket ekranı için açılır pencerelere izin verin.");
  w.document.body.textContent="Kargolanıyor; paket etiketleri hazırlanıyor…";
  busy.kargola.add(siparisNo);
  try{
    const {data:order,error}=await db.from(TABLE).select("*").eq("siparis_no",siparisNo).single();
    if(error) throw error;
    if(order.kargo_takip_kodu && !isLiveShipment(order))throw new Error("Canlı gönderi test ortamında yeniden kargolanamaz.");
    if(order.zpl_base64){openCargoPdf(w,order.zpl_base64);return;}
    if(order.kargo_takip_kodu) throw new Error("Gönderi zaten mevcut. Yeni kargo oluşturmadan etiket dönüşümünü tamamlamak gerekiyor.");
    const payload=await cargoRequest(WH_KARGOLA,{operation:"kargola",payload:JSON.stringify({...order,test_mode:true})});
    openCargoPdf(w,payload.pdf_base64);
    db.functions.invoke("whatsapp-reaction",{body:{siparis_no:siparisNo,emoji:"🚚"}}).then(({error})=>{if(error)toast("Kargolandı; WhatsApp emojisi gönderilemedi.",6000);}).catch(()=>toast("Kargolandı; WhatsApp emojisi gönderilemedi.",6000));
    toast("Kargolandı. Paket etiketleri yazdırmaya hazır.",6000);
    await loadOrders(true);
  }catch(error){
    if(!w.closed) w.close();
    toast(error.name==="AbortError"?"İstek zaman aşımına uğradı. Tekrar göndermeden sipariş ve n8n sonucunu kontrol edin.":error.message,8000);
  }finally{busy.kargola.delete(siparisNo);}
}

async function printBarcode() {
  const siparisNo = selectedOrder?.siparis_no;
  if (siparisNo == null) return toast("Önce sipariş seçin.");
  const ok = await confirmModal({
    title: "Etiketi Tekrar Yazdır",
    text: "Daha önce oluşturulmuş paket etiketleri açılacak. Yeni kargo veya yeni barkod oluşturulmaz.",
    confirmText: "Aç", cancelText: "Vazgeç"
  });
  if (!ok) return;
  const w = window.open("", "_blank");
  if (!w) return toast("Pop-up engellendi, izin ver.");
  w.document.write("<html><head><title>Paket Etiketleri</title></head><body>Kayıtlı etiketler açılıyor…</body></html>");
  w.document.close();
  function fail(message) {
    if (!w.closed) w.close();
    toast(message);
  }
  try {
    
    if(selectedOrder.zpl_base64?.startsWith("JVBER")){
      openCargoPdf(w,selectedOrder.zpl_base64);
      toast("Kayıtlı paket etiketleri tekrar yazdırmaya hazır.");
      return;
    }
    const { data, error } = await db.from(TABLE)
      .select("zpl_base64, kargo_adet").eq("siparis_no", siparisNo).single();
    if (error) return fail("Barkod alınamadı!");
    if (!data?.zpl_base64) return fail("Barkod bulunamadı!");
    const cargoCount = Number(data.kargo_adet);
    if (!Number.isSafeInteger(cargoCount) || cargoCount < 1)
      return fail("Kargo adedi geçersiz. Siparişteki kargo adedini kontrol edin.");

    let raw = data.zpl_base64;
    try { raw = JSON.parse(raw); } catch {}
    const list = (Array.isArray(raw) ? raw : [raw])
      .map(item => typeof item === "string" ? item : item?.data)
      .filter(item => typeof item === "string" && item.trim());
    if (!list.length) return fail("Geçerli barkod bulunamadı!");

    if (!window.PDFLib) {
      if (!window.barcodePdfLibPromise) {
        window.barcodePdfLibPromise = new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
          script.onload = () => window.PDFLib ? resolve() : reject(new Error("PDF aracı yüklenemedi"));
          script.onerror = () => { script.remove(); reject(new Error("PDF aracı yüklenemedi")); };
          document.head.appendChild(script);
        }).catch(error => { window.barcodePdfLibPromise = null; throw error; });
      }
      await window.barcodePdfLibPromise;
    }

    const { PDFDocument } = window.PDFLib;
    const source = await PDFDocument.create();
    for (const value of list) {
      const base64 = value.trim().replace(/^data:[^,]*,/, "").replace(/\s/g, "");
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
      if (base64.startsWith("iVBOR")) {
        const image = await source.embedPng(bytes);
        const width = image.width * 72 / 96;
        const height = image.height * 72 / 96;
        source.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
      } else {
        const pdf = await PDFDocument.load(bytes);
        const pages = await source.copyPages(pdf, pdf.getPageIndices());
        pages.forEach(page => source.addPage(page));
      }
    }
    const pageCount = source.getPageCount();
    let output = source;
    if (pageCount !== cargoCount) {
      return fail("Barkod sayfası (" + pageCount + ") kargo adediyle (" +
        cargoCount + ") eşleşmiyor. Barkodları kontrol edin.");
    }
    if (w.closed) return;
    const blobUrl = URL.createObjectURL(new Blob([await output.save()], { type: "application/pdf" }));
    w.document.body.innerHTML = '<iframe title="Barkodlar" src="' + blobUrl +
      '#view=FitH" style="border:0;width:100%;height:100vh"></iframe>';
    w.document.body.style.cssText = "margin:0;overflow:hidden";
    w.document.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();w.close();}});
    w.addEventListener("unload", () => URL.revokeObjectURL(blobUrl), { once: true });
    toast(cargoCount + " kayıtlı paket etiketi tekrar yazdırmaya hazır.");
  } catch (error) {
    console.error("Barkod hazırlama hatası:", error);
    fail("Barkod PDF hazırlanamadı. Dosyayı ve internet bağlantısını kontrol edin.");
  }
}

/* ============================================================
   İPTAL / GERİ AL
============================================================ */

function cancelCancelForm(){
  document.getElementById("cancelForm").style.display = "none";
  document.getElementById("actionButtons").style.display = "flex";
}

async function openCancelForm() {
  const isShipped = hasExistingShipment(selectedOrder);

  // 🚨 Kargolanmışsa → daha form açılmadan uyarı ver!
  if (isShipped) {
    const ok = await confirmModal({
      title: "Kargolanmış Siparişi İptal Et",
      text: `Bu sipariş kargoya gönderilmiş durumda. Siparişi iptal etseniz de kargo firmasından ek ücret çıkabilir. Devam etmek istiyor musunuz?`,
      confirmText: "Devam Et",
      cancelText: "Vazgeç"
    });

    if (!ok) return; // vazgeçerse form açma
  }

  // 🟢 Kargolanmamışsa veya onay verildiyse → formu aç
  document.getElementById("cancelForm").style.display = "block";
  document.getElementById("actionButtons").style.display = "none";
}

function hasExistingShipment(order){
  return !!(order?.kargo_takip_kodu || order?.orderinvoiceid || order?.zpl_base64 || ["Kargolandı","Tamamlandı"].includes(order?.kargo_durumu) || Number(order?.shipmentStatusCode)>0);
}



/* ============================================================
   KARGOLANMIŞ İPTAL
============================================================ */

let cancelBusy=false;
async function confirmCancel(){
  if(cancelBusy)return;
  const reason=document.getElementById("iptalInput").value.trim();if(!reason)return toast("İptal nedeni gerekli");
  const id=selectedOrder?.siparis_no;if(!id)return;
  cancelBusy=true;
  try{
    const {data:order,error}=await db.from(TABLE).select("*").eq("siparis_no",id).single();if(error)throw error;
    if(hasExistingShipment(order) && !isLiveShipment(order))throw new Error("Canlı gönderi test bağlantısıyla iptal edilemez.");
    if(hasExistingShipment(order)){
      const result=await cargoRequest(CONFIG.webhooks.iptal,{operation:"iptal",siparis_no:String(id),reason});toast(result.message,6000);
    }else{
      if(!await updateSelectedOrder({kargo_durumu:"İptal",iptal_nedeni:reason,iptal_tarihi:new Date().toISOString()}))return;
      toast("Sipariş iptal edildi");
    }
    closeModal();await loadOrders(true);
  }catch(error){toast(error.message,10000);}
  finally{cancelBusy=false;}
}

async function restoreOrder(){
  const ok = await confirmModal({
    title: "Bekleyenlere Geri Al",
    text: "Bu sipariş bekleyen siparişlere geri alınacaktır. Onaylıyor musunuz?",
    confirmText: "Evet",
    cancelText: "Hayır"
  });

  if(!ok) return;

  if (!await updateSelectedOrder({
    kargo_durumu:"Bekliyor",
    iptal_nedeni:null,
    iptal_tarihi:null
  })) return;

  toast("Sipariş geri alındı");
  closeModal();

  setTimeout(() => loadOrders(true), 1000);
}

/* ============================================================
   ARAMA
============================================================ */
function buildOrderSearchFilter(input) {
  const raw = input.trim();
  const pattern = value => JSON.stringify("%" + value.replace(/[\\%_]/g, character => "\\" + character) + "%");
  const text = pattern(raw);
  const filters = ["ad_soyad", "adres", "kargo_takip_kodu"]
    .map(column => column + ".ilike." + text);
  const digits = raw.replace(/\D/g, "");
  const phoneInput = /^[+\d\s().-]+$/.test(raw) && digits.length >= 3;
  const phone = phoneInput
    ? JSON.stringify("%" + (digits.length >= 10 ? digits.slice(-10) : digits).split("").join("%") + "%")
    : text;
  filters.push("siparis_tel.ilike." + phone, "musteri_tel.ilike." + phone);
  if (/^\d+$/.test(raw)) {
    const value = Number(raw);
    if (Number.isSafeInteger(value) && value <= 2147483647)
      filters.push("siparis_no.eq." + value);
    if (Number.isSafeInteger(value) && value <= 32767)
      filters.push("musteri_no.eq." + value);
  }
  return filters.join(",");
}

async function searchOrders() {
  const request = ++listRequest;
  const raw = document.getElementById("searchInput").value.trim();
  if (!raw) return loadOrders(true);
  updateListHeading(true, "Aranıyor…");
  try {
    const { data, error } = await db.from(TABLE).select("*")
      .or(buildOrderSearchFilter(raw))
      .order("siparis_no", { ascending: false });
    if (request !== listRequest) return;
    if (error) throw error;
    renderTableHeader();
    renderTable(data, { append: false, hasMore: false });
    updateListHeading(true, `${data?.length ?? 0} sonuç · Tüm siparişlerde arama`);
  } catch (error) {
    updateListHeading(true, "Arama tamamlanamadı. Yeniden deneyin.");
    console.error("Arama Hatası:", error);
    toast("Arama yapılırken bir hata oluştu!");
  }
}


function clearSearch(){
  document.getElementById("searchInput").value="";
  loadOrders(true);
}

/* ============================================================
   TAB / LOAD MORE / MOBİL MENÜ
============================================================ */
function updateListHeading(search, summary) {
  const titles = {bekleyen:"Bekleyen Siparişler", hazirlandi:"Hazırlanan Siparişler", kargolandi:"Kargolanan Siparişler", tamamlandi:"Tamamlanan Siparişler", sorunlu:"Sorunlu Siparişler", iptal:"İptal Edilen Siparişler"};
  const title = document.getElementById("pageTitle");
  const info = document.getElementById("listSummary");
  if (title) title.textContent = search ? "Arama Sonuçları" : titles[currentTab];
  if (info) info.textContent = summary;
}

function setTab(tab){
  document.getElementById("searchInput").value = "";
  currentTab = tab;
  document.querySelectorAll(".menu li").forEach(li=>li.classList.remove("active"));
  const el = document.getElementById(`tab_${tab}`);
  if(el) el.classList.add("active");
  loadOrders(true);
}

function loadMore(){
  currentPage++;
  loadOrders(false);
}

function toggleMenu(){
  document.querySelector(".sidebar").classList.toggle("open");
}

document.addEventListener("click", e=>{
  const sidebar = document.querySelector(".sidebar");
  const btn = document.querySelector(".mobile-menu-btn");
  if(!sidebar.classList.contains("open")) return;
  if(sidebar.contains(e.target) || btn.contains(e.target)) return;
  sidebar.classList.remove("open");
});

/* ============================================================
   FİŞ (Adisyon)
============================================================ */
function printSiparis(order){
  const w = window.open("adisyon_print.html", "_blank");
  if(!w){ toast("Pop-up engellendi. Lütfen bu site için pop-up izni verin."); return; }

  const html = `
    <div style="font-size:12px">
      <div><b>No:</b> ${order.siparis_no}</div>
      <div><b>İsim:</b> ${order.ad_soyad}</div>
      <div><b>Tel:</b> ${order.musteri_tel ?? ""}</div>
      <div><b>Adres:</b> ${order.adres ?? ""}</div>
      <div><b>Şehir/İlçe:</b> ${order.sehir ?? ""} / ${order.ilce ?? ""}</div>
      <div style="margin:6px 0;border-bottom:1px dashed #000;"></div>
      <div><b>Ürünler:</b> ${parseProduct(order.urun_bilgisi)}</div>
      <div><b>Adet:</b> ${order.kargo_adet ?? "-"}</div>
      <div><b>KG:</b> ${order.kargo_kg ?? "-"}</div>
      <div><b>Tutar:</b> ${order.toplam_tutar} TL</div>
      <div><b>Ödeme:</b> ${order.odeme_sekli ?? "-"}</div>
      <div><b>Not:</b> ${order.notlar ?? "-"}</div>
    </div>`;

  const inject = ()=>{
    try{
      const el = w.document.getElementById("content");
      if(el){
        el.innerHTML = html;
        if(typeof w.doPrint === "function") w.doPrint();
        else w.print();
        return true;
      }
      return false;
    }catch{ return false; }
  };

  let tries = 0;
  const t = setInterval(()=>{
    tries++;
    if(inject() || tries>40) clearInterval(t);
  }, 100);
}
/* ============================================================
   ENNTER İLE ARA 
============================================================ */

// Delegation also works when config loading finishes after DOMContentLoaded.
document.addEventListener("keydown", (event) => {
  if(event.key === "Escape" && !event.isComposing){
    const overlays=document.querySelectorAll("#alertRoot .alert-backdrop");
    const top=overlays[overlays.length-1];
    if(top){event.preventDefault();if(typeof top.dismiss==="function")top.dismiss();else top.remove();return;}
    const modal=document.getElementById("orderModal");
    if(modal?.style.display==="flex"){
      event.preventDefault();
      if(document.getElementById("cancelForm").style.display==="block")cancelCancelForm();
      else closeModal();
      return;
    }
    document.querySelector(".sidebar")?.classList.remove("open");
  }
  if (event.target?.id === "searchInput" && event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    searchOrders();
  }
});

/* ============================================================
   GLOBAL EXPORT
============================================================ */
Object.assign(window, {
  logout,
  loadOrders,
   loadMore,
  setTab,
  searchOrders,
  clearSearch,
  toggleMenu,

  openOrder,
  closeModal,

  openTrackingUrl,
  showErrorDetail,

  setWaiting,
  markPrepared,
  sendToCargo,
  printBarcode,
  connectCargo,
  refreshCargoMovements,

  enterEditMode,
  saveEdit,
  cancelEdit,

  openCancelForm,
  cancelCancelForm,
  confirmCancel,
  restoreOrder,

  queryCityDistrictCodes,
deleteCanceledOrder,
showNoteDetail,

  openPrintChooser,
  printSiparis,
  printEtiket
});
/* ============================================================
   BAŞLAT
============================================================ */

// Menü öğeleri klavye ile de kullanılabilir.
document.querySelectorAll(".menu li").forEach(item => {
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); item.click(); }
  });
});

const requestedTab = new URLSearchParams(location.search).get("tab");
if (["bekleyen","hazirlandi","kargolandi","tamamlandi","sorunlu","iptal"].includes(requestedTab)) {
  currentTab = requestedTab;
  document.querySelectorAll(".menu li").forEach(item => item.classList.toggle("active", item.id === "tab_" + currentTab));
}
