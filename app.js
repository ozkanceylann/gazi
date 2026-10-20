/* ============================================================
   CONFIG YÜKLENENE KADAR BEKLE
============================================================ */
await window.waitConfig();
const {bindBranchSelector}=await import("./branch-selector.js?v=20261017-dhl-branch-73");
let branchSelector=null;

/* ============================================================
   SUPABASE
============================================================ */
const SUPABASE_URL = "https://jarsxtpqzqzhlshpmgot.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphcnN4dHBxenF6aGxzaHBtZ290Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyODExMTcsImV4cCI6MjA3Nzg1NzExN30.98oYONSkb8XSDrfGW2FxhFmt2BLB5ZRo3Ho50GhZYgE";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const sessionUser = await window.requireSession(db);
const { installLabelScanner } = await import('./label-scanner.js?v=20261015-label-scanner-44');
installLabelScanner({ db, table: CONFIG.table, openOrder, toast });
CustomerOrderHistory.bind(openOrder);


/* ============================================================
   REFERANS VERİLER (ŞEHİR / İLÇE)
============================================================ */
const cityCache = [];
const districtCache = new Map();

/* ============================================================
   MARKA AYARLARI
============================================================ */
const TABLE         = CONFIG.table;
const LIST_TABLE = "gazi_order_list";
const WH_KARGOLA    = CONFIG.webhooks.kargola;
const WH_BARKOD     = CONFIG.webhooks.barkod;
const WH_IPTAL      = CONFIG.webhooks.iptal;
const WH_SEHIR_ILCE = CONFIG.webhooks.sehir_ilce;

/* ============================================================
   GLOBAL STATE
============================================================ */
let currentTab = "bekleyen";
let cargoFilter = "all";
let operationFilter = "";
let currentPage = 1;
const PAGE_SIZE = 10;
let selectedOrder = null;
const orderTakerNames = new Map();
const isGaziAdmin = sessionUser.app_metadata?.role !== "seller";

const busy = { kargola: new Set(), barkod: new Set(), iade: new Set(), sube: new Set() };



/* ============================================================
   UI HELPERS
============================================================ */
function getColumnCount(){
  return currentTab === "hazirlandi" ? 10 : currentTab === "bekleyen" ? 9 : 8;
}

function shouldShowNoteColumn(tab) {
  return ["bekleyen", "hazirlandi"].includes(tab);
}

function shouldShowCargoCode(tab) {
  return ["kargolandi", "tamamlandi", "sorunlu", "iade"].includes(tab);
}


function cargoCountBadge(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
    return '<span class="cargo-count cargo-count--empty" aria-label="Paket adedi belirtilmemiş">—</span>';
  }
  const hue = count === 1 ? 42 : ((count - 1) * 137.508 + 145) % 360;
  return `<span class="cargo-count${count === 1 ? ' cargo-count--gold' : ''}" style="--count-hue:${hue.toFixed(3)}" aria-label="${count} paket">${count}</span>`;
}

function orderColumnRoles(){
  if(currentTab==="bekleyen")return ["number","primary","count","customer","product","total","status","note","taker"];
  if(currentTab==="hazirlandi")return ["number","primary","count","customer","product","total","status","note","taker","actions"];
  return ["number","count","customer","product","total","status","code","taker","actions"];
}
function labelOrderCells(row){
  const roles=orderColumnRoles();
  const labels={number:"Sipariş",primary:"İşlem",count:"Paket",customer:"Müşteri",product:"Ürün",total:"Tutar",status:"Durum",note:"Not",taker:"Sipariş alan",code:"Takip no",actions:"İşlemler"};
  [...row.children].forEach((cell,i)=>{cell.classList.add("order-cell--"+roles[i]);cell.dataset.label=labels[roles[i]];});
}

function renderTableHeader(){
  const head = document.getElementById("ordersHeadRow");
  if(!head) return;

  head.closest("table")?.classList.toggle("orders-table--prepared", currentTab === "hazirlandi");
  head.closest("table")?.classList.toggle("orders-table--pending", currentTab === "bekleyen");
  head.innerHTML = currentTab === "bekleyen"
  ? `
    <th>S.No</th>
    <th>Hazırla</th>
    <th class="cargo-count-column" aria-label="Kargo Adet">Kargo<br>Adet</th>
    <th>İsim</th>
    <th>Ürün</th>
    <th>Tutar</th>
    <th>Durum</th>
    <th>Not</th>
    <th>Sipariş Alan</th>
  `
  : `
    <th>S.No</th>
    ${currentTab === "hazirlandi" ? '<th class="order-ship-column">Kargola</th>' : ""}
    <th class="cargo-count-column" aria-label="Kargo Adet">Kargo<br>Adet</th>
    <th>İsim</th>
    <th>Ürün</th>
    <th>Tutar</th>
    <th>Durum</th>
    <th>${shouldShowNoteColumn(currentTab) ? "Not" : "Kargo Kodu"}</th>
    <th>Sipariş Alan</th>
    <th>${currentTab === "hazirlandi" ? "Hata / İşlem" : "İşlem"}</th>
  `;

  labelOrderCells(head);
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
document.querySelectorAll(".sidebar .menu li:not(.menu-more)").forEach(item => {
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
  if(window.caches)await caches.delete("gazi-pdf-previews-v1").catch(()=>{});
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
let listLoading = false;
function applyTabFilter(q, tab=currentTab, operation=operationFilter) {
  if(tab==="bekleyen")   q = q.eq("kargo_durumu","Bekliyor");
  if(tab==="hazirlandi") q = q.eq("kargo_durumu","Hazırlandı");
  const deliveredFilter = "shipmentStatusCode.eq.5,isDelivered.eq.true,shipmentStatus.eq.Teslim_Edildi,shipmentStatus.eq.Teslim Edildi";
  if(tab==="kargolandi") {
    q = q.in("kargo_durumu",["Kargolandı","Tamamlandı"])
      .or("isDelivered.is.null,isDelivered.eq.false")
      .or("shipmentStatusCode.is.null,shipmentStatusCode.neq.5")
      .or("shipmentStatus.is.null,and(shipmentStatus.neq.Teslim_Edildi,shipmentStatus.neq.Teslim Edildi)");
  }
  if(tab==="tamamlandi") q = q.or(deliveredFilter);
  if(tab==="sorunlu") q=q.or([cargoStateFilter("failed"),cargoStateFilter("support")].join(","));
  if(tab==="iade") q=q.or(cargoStateFilter("return")+",iade_kodu.not.is.null");
  if(tab==="iptal")      q = q.eq("kargo_durumu","İptal");

  return applyOperationFilter(q, operation);
}

// Dashboard and list share the same server-side predicates and session permissions.
const OPERATION_CARDS = {
  prepare: {tab:"bekleyen", title:"Hazırlanacak Siparişler"},
  label: {tab:"kargolandi", title:"Etiket Bekleyen Siparişler"},
  handover: {tab:"kargolandi", title:"DHL Teslim Alımı Bekleyen Siparişler"},
  attention: {tab:"sorunlu", title:"Müdahale Gereken Siparişler"}
};
function applyOperationFilter(query, key){
  if(key!=="label" && key!=="handover")return query;
  query=query.or(cargoStateFilter("created"));
  return key==="handover"
    ? query.or("and(kargo_zpl.not.is.null,kargo_zpl.neq.),zpl_base64.like.JVBER%")
    : query.or("and(or(kargo_zpl.is.null,kargo_zpl.eq.),or(zpl_base64.is.null,zpl_base64.not.like.JVBER%)),etiket_yazdirma_sayisi.is.null,etiket_yazdirma_sayisi.eq.0");
}
let operationCountsLoading = false;
async function refreshOperationCounts(){
  const panel=document.getElementById("operationCounters");
  if(!panel || operationCountsLoading)return;
  operationCountsLoading=true;
  panel.setAttribute("aria-busy","true");
  try{
    await Promise.all(Object.entries(OPERATION_CARDS).map(async ([key,card])=>{
      const value=panel.querySelector(`[data-operation-count="${key}"]`);
      try{
        const query=db.from(TABLE).select("siparis_no",{count:"exact",head:true})
          .or("kargo_durumu.is.null,kargo_durumu.neq.Silindi");
        const {count,error}=await applyOperationFilter(applyTabFilter(query,card.tab,""),key);
        if(error || typeof count!=="number")throw error || Error("Sayı alınamadı");
        value.textContent=count.toLocaleString("tr-TR");
        value.closest("button").title=card.title+": "+count+" sipariş";
      }catch{
        value.textContent="—";
        value.closest("button").title="Sayı alınamadı. Yenile düğmesiyle tekrar deneyin.";
      }
    }));
  }finally{operationCountsLoading=false;panel.setAttribute("aria-busy","false");}
}
function openOperationQueue(key){
  const card=OPERATION_CARDS[key];
  if(!card)return;
  setTab(card.tab,key);
  document.querySelector(".sidebar")?.classList.remove("open");
}
window.openOperationQueue=openOperationQueue;

// Orders needing label creation come first; saved labels follow, newest creation first. Count queues before ranges: an exhausted queue must never
// receive an offset beyond its last row (PostgREST PGRST103 / HTTP 416).
async function loadCargoLabelQueue(start, end){
  const query = (saved, head=false) => {
    let q=applyCargoFilter(applyTabFilter(db.from(LIST_TABLE)
      .select("*", {count:"exact", head})
      .or("kargo_durumu.is.null,kargo_durumu.neq.Silindi")));
    return saved
      ? q.or("and(kargo_zpl.not.is.null,kargo_zpl.neq.),zpl_base64.like.JVBER%")
      : q.or("kargo_zpl.is.null,kargo_zpl.eq.")
          .or("zpl_base64.is.null,zpl_base64.not.like.JVBER%");
  };
  // Capture the current tab/filter before the first await.
  const pendingRows=query(false), savedRows=query(true);
  const [pending,saved]=await Promise.all([query(false,true),query(true,true)]);
  if(pending.error||saved.error)return {error:pending.error||saved.error};
  const pendingCount=pending.count||0, savedCount=saved.count||0;
  const pendingTake=Math.max(0,Math.min(end+1,pendingCount)-start);
  const savedStart=Math.max(0,start-pendingCount);
  const savedTake=Math.max(0,Math.min(end-start+1-pendingTake,savedCount-savedStart));
  const requests=[];
  if(pendingTake)requests.push(pendingRows.order("siparis_no",{ascending:false}).range(start,start+pendingTake-1));
  if(savedTake)requests.push(savedRows.order("etiket_olusturma_tarihi",{ascending:false,nullsFirst:false}).order("siparis_no",{ascending:false}).range(savedStart,savedStart+savedTake-1));
  const pages=await Promise.all(requests);
  const error=pages.find(page=>page.error)?.error;
  return {data:pages.flatMap(page=>page.data||[]),error:error||null,count:pendingCount+savedCount};
}

async function loadOrders(reset=false){
  if(reset)void refreshOperationCounts();
  if(document.getElementById("tabSearchInput")?.value.trim()) return searchOrders("tab",!reset);
  if(document.getElementById("searchInput")?.value.trim()) return searchOrders("all",!reset);
  syncCargoTools();
  const request = ++listRequest;
  const loadButton=document.getElementById("loadMoreBtn");
  listLoading=true;
  if(loadButton){loadButton.disabled=true;loadButton.textContent="Yükleniyor…";}
  try {
  const tbody = document.getElementById("ordersBody");
  if(reset){
    currentPage = 1;
    tbody.innerHTML = "";
  }

  renderTableHeader();
  updateListHeading(false, "Siparişler yükleniyor…");

  let q = db.from(LIST_TABLE).select("*", { count: "exact" })
    .or("kargo_durumu.is.null,kargo_durumu.neq.Silindi");

  q = applyTabFilter(q);

  q = applyCargoFilter(q);

  const start = (currentPage - 1) * PAGE_SIZE;
  const end   = currentPage * PAGE_SIZE - 1;

  const { data, error, count } = currentTab === "kargolandi"
    ? await loadCargoLabelQueue(start, end)
    : await q.order("siparis_no", { ascending: currentTab === "bekleyen" }).range(start, end);
  if (request !== listRequest) return;
  if(error){
    if(!reset)currentPage=Math.max(1,currentPage-1);
    if(reset)tbody.innerHTML = `<tr><td colspan="${getColumnCount()}">Liste yüklenemedi. Yeniden deneyin.</td></tr>`;
    toast("Liste yüklenemedi: " + error.message,6000);
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

  markExtras(data);
  if(request!==listRequest)return;
  renderTable(data, { append: !reset, hasMore });
  void hydrateExtras(data,()=>tbody.isConnected!==false,tbody);
  updateListHeading(false, `${tbody.children.length} sipariş gösteriliyor · Toplam ${count ?? data.length} kayıt`);
  } catch(error) {
    if(request!==listRequest)return;
    if(!reset)currentPage=Math.max(1,currentPage-1);
    toast("Liste yüklenemedi. Yeniden deneyin.",6000);
  } finally {
    if(request===listRequest){
      listLoading=false;
      if(loadButton){loadButton.disabled=false;loadButton.textContent="Daha Fazla";}
    }
  }
}

function needsCargoLabelRetry(order){
  return !["sending","sent","uncertain","historical"].includes(order?.sube_etiket_durumu)
    && order?.kargo_durumu==="Kargolandı"
    && !!(order.orderinvoiceid || order.kargo_takip_kodu)
    && !hasCargoLabel(order)
    && cargoEnvironment(order)!=="test";
}


const customerNotes = new Map();
const customerNoteOrderIds = new Map();
function customerNotePhone(value){return String(value||"").replace(/\D/g,"").replace(/^90/,"").replace(/^0/,"");}
async function loadCustomerNotes(rows){
  if(!rows?.length)return;
  const ids=[...new Set(rows.map(o=>Number(o.musteri_no)).filter(n=>Number.isSafeInteger(n)&&n>0))];
  ids.forEach(id=>customerNotes.delete(id));
  const missing=rows.filter(o=>!Number(o.musteri_no));
  const phones=[...new Set(missing.flatMap(o=>{const n=customerNotePhone(o.musteri_tel);return /^5\d{9}$/.test(n)?[String(o.musteri_tel),n,"0"+n,"90"+n,"+90"+n]:[];}))];
  const reads=[];
  if(ids.length)reads.push(db.from("musteriler").select("musteri_no,musteri_tel,not").in("musteri_no",ids));
  if(phones.length)reads.push(db.from("musteriler").select("musteri_no,musteri_tel,not").in("musteri_tel",phones));
  const results=await Promise.all(reads.map(q=>Promise.resolve(q).catch(error=>({data:null,error}))));let failed=false;const customers=[];
  for(const r of results){if(r.error){failed=true;continue;}for(const c of r.data||[]){customerNotes.set(Number(c.musteri_no),c);customers.push(c);}}
  for(const o of rows){
    const number=Number(o.musteri_no);
    if(number>0){customerNoteOrderIds.set(Number(o.siparis_no),number);o._customerNoteUnavailable=failed&&!customers.some(c=>Number(c.musteri_no)===number);}
    else{o._customerNoteUnavailable=failed;const matches=customers.filter(c=>customerNotePhone(c.musteri_tel)===customerNotePhone(o.musteri_tel));const unique=[...new Set(matches.map(c=>Number(c.musteri_no)))];customerNoteOrderIds.delete(Number(o.siparis_no));if(unique.length===1)customerNoteOrderIds.set(Number(o.siparis_no),unique[0]);}
  }
}
function customerNoteRecord(order){const id=Number(order?.musteri_no)||customerNoteOrderIds.get(Number(order?.siparis_no));return customerNotes.get(id);}
function customerNoteCard(order){
  if(!["bekleyen","hazirlandi","kargolandi"].includes(currentTab))return "";
  const note=String(customerNoteRecord(order)?.not||"").trim();
  if(!note)return "";
  return `<button type="button" class="customer-note-card" title="${escapeHtml(note)}" onclick="event.stopPropagation();openOrder(${Number(order.siparis_no)})"><span>Müşteri notu</span><strong>${escapeHtml(note)}</strong></button>`;
}
function customerNoteDetail(order){
  const customer=customerNoteRecord(order),note=String(customer?.not||"");
  const unavailable=order._customerNoteUnavailable===true;
  return `<section class="detail-group customer-note-panel"><div class="customer-note-heading"><strong>Müşteri notu</strong><span>Kalıcı · tüm siparişlerde</span>${isGaziAdmin&&customer&&!unavailable?'<button type="button" onclick="editCustomerNote()">'+(note.trim()?"Düzenle":"Not ekle")+'</button>':""}</div>${note.trim()?`<p class="customer-note-content">${escapeHtml(note)}</p>`:""}${unavailable?'<p class="customer-note-content">Müşteri notu alınamadı. Siparişi yeniden açın.</p>':!customer?'<p class="customer-note-content">Müşteri kaydı eşleştirilemedi.</p>':""}${isGaziAdmin&&customer&&!unavailable?`<form id="customerNoteForm" hidden onsubmit="event.preventDefault();saveCustomerNote(this)"><label for="customerNoteInput">Bu müşterinin tüm siparişlerinde görünür</label><textarea id="customerNoteInput" name="note" rows="3" maxlength="10000">${escapeHtml(note)}</textarea><div><button type="submit">Müşteri notunu kaydet</button><button type="button" onclick="this.closest('form').hidden=true">Vazgeç</button></div><p role="status"></p></form>`:""}</section>`;
}
window.editCustomerNote=function(){const form=document.getElementById("customerNoteForm");if(form){form.hidden=!form.hidden;if(!form.hidden)form.elements.namedItem("note").focus();}};
window.saveCustomerNote=async function(form){
  const order=selectedOrder,customer=customerNoteRecord(order);
  if(!isGaziAdmin||!customer||form.dataset.saving)return;
  const id=Number(customer.musteri_no),note=form.elements.namedItem("note").value.trim()||null;
  const button=form.querySelector('[type="submit"]'),status=form.querySelector('[role="status"]');
  form.dataset.saving="true";button.disabled=true;status.textContent="Kaydediliyor…";
  try{
    let q=db.from("musteriler").update({not:note}).eq("musteri_no",id);
    q=customer.not===null?q.is("not",null):q.eq("not",customer.not);
    const {data,error}=await q.select("musteri_no,musteri_tel,not").maybeSingle();
    if(error)throw error;
    if(!data)throw Error("Müşteri notu başka bir yerde değişmiş olabilir. Siparişi yeniden açıp kontrol edin.");
    customerNotes.set(id,data);toast("Müşteri notu kaydedildi. Tüm siparişlerinde görünecek.",5000);
    const inTab=!!document.getElementById("tabSearchInput")?.value.trim();
    if(inTab||document.getElementById("searchInput")?.value.trim())await searchOrders(inTab?"tab":"all");else await loadOrders(true);
    if(selectedOrder?.siparis_no===order.siparis_no)renderDetails();
  }catch(error){status.textContent=error.message||"Müşteri notu kaydedilemedi.";}
  finally{delete form.dataset.saving;button.disabled=false;}
};

function orderDateMarkup(value) {
  // The order timestamp has no timezone; retain its recorded calendar date.
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(String(value ?? "").trim());
  if (!match) return "";
  const iso = match.slice(1).join("-");
  const date = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return "";
  const label = date.toLocaleDateString("tr-TR", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC"
  });
  return `<span class="order-date"><span>Sipariş ·</span> <time datetime="${iso}">${escapeHtml(label)}</time></span>`;
}


function hasZeroOrderTotal(value) {
  if (typeof value === "number") return Number.isFinite(value) && value === 0;
  if (typeof value !== "string" || !value.trim()) return false;
  const amount = value.trim().replace(/\s*(?:TL|TRY|₺)\s*$/i, "").replace(/\s/g, "");
  return /^[+-]?0+(?:[.,]0+)*$/.test(amount);
}



function orderTakerPhoneKey(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 10) return "90" + digits;
  if (digits.length === 11 && digits.startsWith("0")) return "90" + digits.slice(1);
  return digits;
}

function orderTakerPhoneSlot(value) {
  const label = String(value ?? "").trim();
  if (!label || label === "-" || label === "—") return "—";
  const key = orderTakerPhoneKey(label);
  if (key.length < 10 || key.length > 15) {
    return `<span class="order-taker-phone">${escapeHtml(label)}</span>`;
  }
  let hash = 2166136261;
  for (const digit of key) hash = Math.imul(hash ^ digit.charCodeAt(0), 16777619) >>> 0;
  const hue = (hash % 36000) / 100;
  const number = key.startsWith("90") && key.length === 12 ? "+" + key : (label.startsWith("+") ? "+" : "") + key;
  return `<a class="order-taker-phone" style="--phone-hue:${hue}" href="tel:${number}" onclick="event.stopPropagation()" aria-label="Sipariş alan kişiyi ara: ${escapeHtml(label)}">${escapeHtml(label)}</a>`;
}


function orderTakerMarkup(order) {
  const phone = String(order.siparis_tel ?? "").trim();
  const name = String(order.siparis_alan ?? "").trim();
  const fallbackPhone = /^[+\d\s().-]+$/.test(name) ? name : "";
  const key = orderTakerPhoneKey(phone || fallbackPhone);
  const displayName = orderTakerNames.get(key);
  if (displayName) {
    return `<a class="order-taker-person" href="tel:+${key}" title="${escapeHtml(phone || fallbackPhone)}" onclick="event.stopPropagation()">${escapeHtml(displayName)}</a>`;
  }
  if (name && !fallbackPhone && name !== "-" && name !== "—") return `<span class="order-taker-person">${escapeHtml(name)}</span>`;
  return `<span class="order-taker-person order-taker-person--unknown">${escapeHtml(phone || fallbackPhone || "—")}</span>`;
}

async function loadOrderTakerNames() {
  if (!isGaziAdmin) return [];
  const {data,error} = await db.from("gazi_order_takers").select("phone,display_name").order("phone");
  if (error) throw error;
  orderTakerNames.clear();
  for (const row of data || []) if (row.display_name) orderTakerNames.set(row.phone,row.display_name);
  return data || [];
}

async function openOrderTakerSettings() {
  if (!isGaziAdmin) return;
  let rows;
  try { rows = await loadOrderTakerNames(); } catch { return toast("Telefon tanımları yüklenemedi. Yeniden deneyin."); }
  const root = document.getElementById("alertRoot");
  const wrap = document.createElement("div");
  wrap.className = "alert-backdrop";
  wrap.innerHTML = `
    <section class="alert-card taker-settings" role="dialog" aria-modal="true" aria-labelledby="takerSettingsTitle">
      <div class="taker-settings-heading"><h2 id="takerSettingsTitle">Telefon / Kişi Tanımları</h2><button type="button" data-close aria-label="Kapat">×</button></div>
      <p>Numarayı kullanan kişinin adını yaz. Siparişlerde bu isim görünecek.</p>
      <div class="taker-settings-rows"></div>
    </section>`;
  const finish = () => wrap.remove();
  wrap.dismiss = finish;
  wrap.querySelector("[data-close]").onclick = finish;
  wrap.addEventListener("click", e => { if(e.target === wrap) finish(); });
  const container = wrap.querySelector(".taker-settings-rows");
  const addRow = (phone="",displayName="") => {
    const form = document.createElement("form");
    form.className = "taker-settings-row";
    form.innerHTML = `<label>Telefon<input name="phone" type="tel" value="${escapeHtml(phone)}" ${phone ? "readonly" : ""} placeholder="Yeni telefon" required></label><label>İsim<input name="display_name" value="${escapeHtml(displayName || "")}" maxlength="80" placeholder="Kişinin adı"></label><button type="submit">Kaydet</button><span class="taker-row-status" role="status"></span>`;
    form.addEventListener("submit",async e=>{
      e.preventDefault();
      const input = form.elements.namedItem("phone");
      const key = orderTakerPhoneKey(input.value);
      const name = form.elements.namedItem("display_name").value.trim();
      const status = form.querySelector(".taker-row-status");
      if(!/^[0-9]{10,15}$/.test(key)) { status.textContent="Geçerli telefon yazın."; return; }
      const button = form.querySelector("button");
      button.disabled=true; status.textContent="Kaydediliyor…";
      try {
        const {error}=await db.from("gazi_order_takers").upsert({phone:key,display_name:name || null},{onConflict:"phone"});
        if(error) throw error;
        await loadOrderTakerNames();
        input.value=key; input.readOnly=true;
        status.textContent="Kaydedildi";
        if(!phone) { phone=key; addRow(); }
        await loadOrders(true);
        if(selectedOrder && document.getElementById("orderModal").style.display==="flex") renderDetails();
      } catch { status.textContent="Kaydedilemedi. Yeniden deneyin."; }
      finally {button.disabled=false;}
    });
    container.appendChild(form);
  };
  for(const row of rows) addRow(row.phone,row.display_name);
  addRow();
  root.appendChild(wrap);
  wrap.querySelector('input[name="display_name"]')?.focus();
}
function orderLifecycleStage(order) {
  const stage = String(order?.kargo_durumu || "").trim();
  if (["İptal", "Silindi", "İade"].includes(stage)) return stage;
  if (order?.isDelivered === true || Number(order?.shipmentStatusCode) === 5) return "Tamamlandı";
  return stage || "Aşama belirtilmemiş";
}

function orderStageBadge(order) {
  let stage = orderLifecycleStage(order);
  const code = Number(order?.shipmentStatusCode);
  const movement = String(order?.shipmentStatus || "").replace(/_/g, " ").trim();
  if (!["İptal", "Silindi"].includes(stage)) {
    if (order?.iade_kodu || code === 7 || movement === "Geri Geliyor") stage = "İade";
    else if (stage === "Kargolandı" && ([6, 8].includes(code) || ["Teslim Edilemedi", "Destek Gerekiyor"].includes(movement))) stage = "Sorunlu";
  }
  const states = {
    "Bekliyor": ["Bekleyenler", "waiting"],
    "Hazırlandı": ["Hazırlandı", "prepared"],
    "Kargolandı": ["Kargolandı", "shipped"],
    "Tamamlandı": ["Tamamlananlar", "completed"],
    "İade": ["İade", "return"],
    "İptal": ["İptal", "cancelled"],
    "Sorunlu": ["Sorunlu Siparişler", "problem"]
  };
  const [label, tone] = states[stage] || [stage, "unknown"];
  const delivery = order?.teslim_sekli_kontrol === true ? '<span class="order-stage-badge order-stage-badge--problem">Teslim şekli kontrol</span>' : order?.subeden_teslim === true ? '<span class="order-stage-badge order-stage-badge--prepared">Şubeden teslim</span>' : '';
  return `<span class="order-stage-badge order-stage-badge--${tone}" aria-label="Sipariş durumu: ${escapeHtml(label)}">${escapeHtml(label)}</span>${delivery}${branchLabelBadge(order)}`;
}

function mobileOrderInfo(order){
  const phone=String(order.musteri_tel||order.siparis_tel||"").trim();
  const dial=phone.replace(/[^\d+]/g,"");
  const place=[order.sehir,order.ilce].filter(Boolean).join(" / ");
  const kg=CargoWeights.display(order.kargo_kg,order.kargo_adet);
  const field=(label,value)=>value?`<div class="order-mobile-field"><span>${label}</span><strong>${value}</strong></div>`:"";
  return `<div class="order-mobile-info">${field("Telefon",phone?`<a href="tel:${escapeHtml(dial)}">${escapeHtml(phone)}</a>`:"")}${field("İl / İlçe",escapeHtml(place))}${field("KG",kg?`${escapeHtml(kg)} kg`:"")}${field("Ödeme",escapeHtml(order.odeme_sekli||"Belirtilmemiş"))}</div>
    ${order.adres?`<p class="order-mobile-address">${escapeHtml(order.adres)}</p>`:""}
    <span class="order-mobile-delivery${order.subeden_teslim===true?" order-mobile-delivery--branch":""}">${order.subeden_teslim===true?"Şubeden teslim"+(order.teslim_subesi?" · "+escapeHtml(order.teslim_subesi):""):"Adrese teslim"}</span>
    <details class="card-original-message"><summary>Orjinal mesaj <span class="disclosure-action"></span></summary><div class="original-message-text">${escapeHtml(order.whatsapp_message_text===undefined?"Mesajı görmek için açın.":order.whatsapp_message_text||"Bu siparişin orijinal mesajı kayıtlı değil.")}</div></details>`;
}
function bindOrderCardSwipe(row){
  let start=null;
  row.addEventListener("pointerdown",event=>{
    if(!window.matchMedia("(max-width: 1200px)").matches||event.button>0||event.target.closest("button,a,details,input,textarea,select"))return;
    start={x:event.clientX,y:event.clientY,time:Date.now()};
  },{passive:true});
  row.addEventListener("pointercancel",()=>{start=null;},{passive:true});
  row.addEventListener("pointerup",event=>{
    const from=start;start=null;if(!from)return;
    const dx=event.clientX-from.x,dy=event.clientY-from.y;
    if(dx>=65&&dx>Math.abs(dy)*2&&Date.now()-from.time<800){
      row.dataset.swipeUntil=String(Date.now()+500);
      const panel=row.querySelector(".card-original-message");
      if(panel)panel.open=true;
    }
  },{passive:true});
}


let extrasToken=0;
function markExtras(rows,kinds=['history','receipts','note']){for(const o of rows){o._extrasToken=++extrasToken;for(const kind of kinds)o['_loading_'+kind]=true;}}
function extraContent(o,kind){
 if(o['_loading_'+kind])return kind==='note'?'':`<small role="status">${kind==='history'?'Sipariş geçmişi':kind==='receipts'?'Dekont durumu':'Müşteri notu'} yükleniyor…</small>`;
 const renderers={history:()=>CustomerOrderHistory.markup(o),receipts:()=>OrderReceipts.badge(o),note:()=>customerNoteCard(o),noteDetail:()=>customerNoteDetail(o)};return renderers[kind]();
}
function extraSlot(o,kind){if(!o['_loading_'+kind])return extraContent(o,kind);return `<span class="order-extra" style="display:contents" data-order-extra="${kind}:${Number(o.siparis_no)}:${o._extrasToken}">${extraContent(o,kind)}</span>`;}
async function hydrateExtras(rows,isCurrent,root,kinds=['history','receipts','note']){
 const loaders={history:()=>CustomerOrderHistory.load(db,rows),receipts:()=>OrderReceipts.load(db,rows),note:()=>loadCustomerNotes(rows),noteDetail:()=>loadCustomerNotes(rows)};
 await Promise.allSettled(kinds.map(async kind=>{
  try{await loaders[kind]();}catch(error){console.warn('Ek sipariş bilgisi alınamadı',kind);}
  for(const o of rows)o['_loading_'+kind]=false;
  if(!isCurrent())return;
  for(const o of rows)for(const slot of root.querySelectorAll(`[data-order-extra="${kind}:${Number(o.siparis_no)}:${o._extrasToken}"]`)){
   slot.outerHTML=extraContent(o,kind);
  }
 }));
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
    tr.dataset.orderId=String(o.siparis_no);
    if (hasZeroOrderTotal(o.toplam_tutar)) tr.classList.add("order-zero-total");

    const orderStage = orderLifecycleStage(o);
    const canShip = orderStage === "Hazırlandı";
    const canLabel = canPrintCargoLabel(o);

    const isTrackingTab = ["kargolandi", "tamamlandi", "sorunlu", "iade"].includes(currentTab);

    const isPendingTab = currentTab === "bekleyen";

  const isPreparedTab = currentTab === "hazirlandi";
  const retryLabel = false;
  if(retryLabel) tr.classList.add("cargo-label-retry");

  const actionBtn = (orderStage === "Tamamlandı" || orderStage === "İade")
    ? returnOrderActions(o)
    : "";

const errorPreview = isPreparedTab && canShip && o.gonder_hata_bilgisi
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
    <td>${o.siparis_no}</td>
    <td>${orderStage === "Bekliyor" ? `<div class="order-primary-actions"><button class="btn-prepare" onclick="event.stopPropagation(); prepareFromList(${Number(o.siparis_no)}, this)">Hazırla</button><button type="button" class="btn-direct-cargo" onclick="event.stopPropagation(); directShipFromList(${Number(o.siparis_no)}, this)">Direkt Kargola</button></div> ${actionBtn}` : actionBtn}</td>
    <td class="cargo-count-column">${cargoCountBadge(o.kargo_adet)}</td>
    <td><div class="order-customer-meta"><span class="order-customer-name" title="${escapeHtml(o.ad_soyad)}">${escapeHtml(o.ad_soyad)}</span>${orderDateMarkup(o.tarih)}</div>${extraSlot(o,'history')}${extraSlot(o,'receipts')}${extraSlot(o,'note')}</td>
    <td>
  <span class="order-product-limit"
        title="${escapeHtml(parseProduct(o.urun_bilgisi))}">
    ${escapeHtml(parseProduct(o.urun_bilgisi))}
  </span>
</td>

    <td><span class="order-total-amount">${escapeHtml(o.toplam_tutar ?? "—")} <small>TL</small></span></td>
    <td class="order-status-cell">${orderStageBadge(o)}</td>
    <td>${noteChip}</td>
    <td>${orderTakerMarkup(o)}</td>
  `
  : `
    <td>${o.siparis_no}</td>
    ${isPreparedTab ? `<td class="order-ship-column">${canShip ? `<button type="button" class="btn-ship-order" onclick="event.stopPropagation(); shipPreparedFromList(${Number(o.siparis_no)}, this)">Kargola</button>` : `${orderStageBadge(o)}`}</td>` : ""}
    <td class="cargo-count-column">${cargoCountBadge(o.kargo_adet)}</td>
    <td><div class="order-customer-meta"><span class="order-customer-name" title="${escapeHtml(o.ad_soyad)}">${escapeHtml(o.ad_soyad)}</span>${orderDateMarkup(o.tarih)}</div>${extraSlot(o,'history')}${extraSlot(o,'receipts')}${extraSlot(o,'note')}</td>
    <td>
  <span class="order-product-limit"
        title="${escapeHtml(parseProduct(o.urun_bilgisi))}">
    ${escapeHtml(parseProduct(o.urun_bilgisi))}
  </span>
</td>

    <td><span class="order-total-amount">${escapeHtml(o.toplam_tutar ?? "—")} <small>TL</small></span></td>
<td class="order-status-cell">${orderStageBadge(o)}${isTrackingTab && ["Kargolandı","Tamamlandı","İade"].includes(orderStage) ? ` ${cargoStatusBadge(o)}` : ""}</td>

<td>
  ${
    shouldShowNoteColumn(currentTab)
      ? noteChip
      : (o.kargo_takip_kodu ?? "-")
  }
</td>

<td>${orderTakerMarkup(o)}</td>
<td>${errorPreview}${currentTab === "kargolandi" && ["sent","uncertain","historical"].includes(o.sube_etiket_durumu) ? branchLabelButton(o) : ""}${currentTab === "kargolandi" && canLabel ? `<button type="button" class="btn-cargo-label ${hasCargoLabel(o)?"cargo-label-print":"cargo-label-create"}" data-label-operation="${hasCargoLabel(o)?"print":"create"}" onclick="event.stopPropagation(); retryCargoLabel(${Number(o.siparis_no)}, this)">${cargoLabelButtonText(o)}</button>` : ""}</td>

  `;

labelOrderCells(tr);
const mobileInfo=document.createElement("td");
mobileInfo.className="order-mobile-extra";
mobileInfo.innerHTML=mobileOrderInfo(o);
tr.appendChild(mobileInfo);
bindOriginalMessage(o,mobileInfo.querySelector(".card-original-message"));
bindOrderCardSwipe(tr);
tr.tabIndex=0;
tr.setAttribute("aria-label", `${o.siparis_no} numaralı siparişin detayını aç`);
tr.addEventListener("keydown", (event)=>{
  if(event.target===tr && ["Enter"," "].includes(event.key)){
    event.preventDefault();
    openOrder(o.siparis_no);
  }
});
// Satır tıklama kontrolü (chip'e tıklayınca detay açılmasın)
tr.addEventListener("click", (e)=>{
  if(Number(tr.dataset.swipeUntil||0)>Date.now())return;
  if (
    e.target.closest("button,a,details,input,textarea,select") ||
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

function returnLabelUrl(value){
  try {
    const url=new URL(value);
    return url.protocol==="https:" && url.hostname==="mn.tc" && !url.username && !url.password && !url.port
      && url.pathname==="/" && /^[A-Za-z0-9]+$/.test(url.searchParams.get("rtnid")||"") ? url.href : "";
  } catch { return ""; }
}
function returnOrderActions(order){
  const url=returnLabelUrl(order.iade_etiket_url);
  if(url)return `<div class="return-actions"><a class="btn-return-label" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">İade Fişini Aç</a><span class="return-code">${escapeHtml(order.iade_kodu)}</span></div>`;
  if(currentTab==="tamamlandi" && (order.isDelivered===true||Number(order.shipmentStatusCode)===5))
    return `<button class="btn-return-label btn-return-label-create" type="button" onclick="event.stopPropagation(); createReturnLabel(${Number(order.siparis_no)}, this)">İADE Etiketi Oluştur</button>`;
  return `<span class="cargo-checked">Geri dönüş kargosu</span>`;
}
function renderReturnDetail(order){
  const url=returnLabelUrl(order.iade_etiket_url);
  if(!url)return "";
  return `<div class="detail-group return-detail"><div class="detail-title">İade Fişi</div><p>İade kodu: <strong>${escapeHtml(order.iade_kodu)}</strong></p><p>${escapeHtml(order.iade_durumu||"Etiket oluşturuldu")} · ${escapeHtml(formatDateTimeTR(order.iade_tarihi))}</p><a class="btn-return-label" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">İade Fişini Aç</a></div>`;
}
function showReturnLabel(result){
  const url=returnLabelUrl(result.url);if(!url)throw new Error("İade fişi bağlantısı doğrulanamadı.");
  const root=document.getElementById("alertRoot"),wrap=document.createElement("div");
  wrap.className="alert-backdrop";
  wrap.innerHTML=`<div class="alert-card return-result" role="dialog" aria-modal="true" aria-label="İade etiketi"><div class="alert-title">İade Etiketi Hazır</div><p>İade kodu: <strong>${escapeHtml(result.reference)}</strong></p><p>Müşteri bu kodla DHL şubesine başvurabilir. Kargo ücreti Gazi hesabına aittir.</p><a class="btn-return-label" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">İade Fişini Aç</a><div class="alert-actions"><button class="btn-ghost" type="button" data-copy-return>Fiş Linkini Kopyala</button><button class="btn-brand" type="button" data-close-return>Kapat</button></div><p role="status" data-copy-status></p></div>`;
  root.appendChild(wrap);
  wrap.querySelector("[data-close-return]").onclick=()=>wrap.remove();
  wrap.querySelector("[data-copy-return]").onclick=async()=>{
    try{await navigator.clipboard.writeText(url);wrap.querySelector("[data-copy-status]").textContent="İade fişi bağlantısı kopyalandı.";}
    catch{wrap.querySelector("[data-copy-status]").textContent="Bağlantıyı İade Fişini Aç düğmesinden açıp kopyalayabilirsiniz.";}
  };
  wrap.querySelector("a").focus();
}
async function createReturnLabel(id,button){
  id=Number(id);if(!Number.isSafeInteger(id)||id<1||busy.iade.has(id))return;
  busy.iade.add(id);if(button)button.disabled=true;
  try {
    const {data:order,error}=await db.from(TABLE).select("*").eq("siparis_no",id).single();
    if(error||!order)throw new Error("Sipariş okunamadı.");
    if(returnLabelUrl(order.iade_etiket_url)){showReturnLabel({reference:order.iade_kodu,url:order.iade_etiket_url});return;}
    const confirmed=await confirmModal({title:"İADE Etiketi Oluştur",text:`${id} numaralı sipariş için iade etiketi oluşturulsun mu?\nKargo ücreti Gazi hesabına yazılır.`,confirmText:"Etiketi Oluştur"});
    if(!confirmed)return;
    if(button)button.textContent="İade etiketi hazırlanıyor…";
    const {data:session}=await db.auth.getSession();
    if(!session.session?.access_token)throw new Error("Panele yeniden giriş yapın.");
    const response=await fetch(SUPABASE_URL+"/functions/v1/gazi-return-label",{method:"POST",
      headers:{apikey:SUPABASE_KEY,Authorization:"Bearer "+session.session.access_token,"Content-Type":"application/json"},
      body:JSON.stringify({siparis_no:id}),signal:AbortSignal.timeout(90000)});
    const result=await response.json();
    if(!response.ok||result.success!==true)throw new Error(result.message||"İade etiketi oluşturulamadı.");
    showReturnLabel(result);
    if(document.getElementById("searchInput").value.trim())await searchOrders();else await loadOrders(true);
  }catch(error){toast(error.name==="TimeoutError"?"İade isteğinin sonucu bekleniyor. Tekrar oluşturmadan önce kaydı kontrol edin.":error.message,10000);}
  finally{busy.iade.delete(id);if(button?.isConnected){button.disabled=false;button.textContent="İADE Etiketi Oluştur";}}
}

window.linkBranchShipment=async function(id){
  if(!isGaziAdmin||busy.sube.has(Number(id)))return;
  const wrap=document.createElement("div");wrap.className="alert-backdrop";
  wrap.innerHTML=`<form class="alert-card" role="dialog" aria-modal="true"><div class="alert-title">Şube takip numarası</div><p>Şubenin bu müşteri için kestiği 12 haneli DHL gönderi numarasını yazın. DHL doğrulamasından sonra siparişe bağlanacak.</p><input name="shipment" aria-label="12 haneli DHL takip numarası" inputmode="numeric" pattern="[0-9]{12}" maxlength="12" required style="width:100%;box-sizing:border-box;padding:12px;margin:8px 0"><p role="status"></p><button type="submit" class="btn-primary">Bağla ve hareketleri getir</button><button type="button" data-cancel>Vazgeç</button></form>`;
  document.getElementById("alertRoot").appendChild(wrap);const form=wrap.querySelector("form");const input=form.elements.namedItem("shipment");input.focus();
  wrap.querySelector('[data-cancel]').onclick=()=>{if(!busy.sube.has(Number(id)))wrap.remove();};
  form.onsubmit=async event=>{event.preventDefault();if(busy.sube.has(Number(id)))return;const number=input.value.trim();if(!/^\d{12}$/.test(number))return;
    const button=form.querySelector('[type=submit]'),status=form.querySelector('[role=status]');busy.sube.add(Number(id));button.disabled=true;status.textContent="DHL gönderisi doğrulanıyor…";
    try{await cargoRequest(CONFIG.webhooks.hareket,{siparis_no:String(id),branch_shipment_id:number});wrap.remove();toast("Şube gönderisi bağlandı ve kargo hareketleri güncellendi.",6000);await loadOrders(true);if(selectedOrder?.siparis_no===Number(id))await openOrder(Number(id));}
    catch(error){status.textContent=error.message||"Gönderi bağlanamadı";}
    finally{busy.sube.delete(Number(id));button.disabled=false;}
  };
};
window.sendBranchLabel=async function(id,button,operation="send"){
  id=Number(id);if(busy.sube.has(id))return;busy.sube.add(id);
  if(operation==="send"){
    const confirmed=await confirmModal({
      title:"Şubeye İlet",
      text:`${id} numaralı sipariş şubeye WhatsApp grubundan iletilecektir.\nBu siparişi eski haline getiremeyeceksiniz.\nDevam etmek istiyor musunuz?`,
      confirmText:"Evet, Şubeye İlet",
      cancelText:"Vazgeç"
    });
    if(!confirmed){busy.sube.delete(id);return;}
  }
  button.disabled=true;button.textContent="Şubeye iletiliyor…";
  try{
    const {data,error}=await db.functions.invoke("gazi-branch-label",{body:{siparis_no:id,operation}});
    if(error){let detail;try{detail=await error.context?.json();}catch{}throw Error(detail?.message||error.message);}
    if(!data?.success)throw Error(data?.message||"Gönderim tamamlanamadı");
    toast(data.status==="historical"?"Şubeden kesilen olarak işaretlendi.":data.status==="sent"?"Şubeye iletildi. Tekrar gönderim kapatıldı.":"Bu sipariş için daha önce işlem başlatılmış. Tekrar gönderilmedi.",6000);
  }catch(error){toast(error.message||"Şubeye iletilemedi",8000);}
  finally{
    busy.sube.delete(id);await loadOrders(true);
    if(selectedOrder?.siparis_no===id){const {data}=await db.from(TABLE).select("*").eq("siparis_no",id).single();if(data){selectedOrder=data;renderDetails();}}
  }
};

const CARGO_STATES = [{"key":"created","code":1,"label":"Gönderi Hazırlandı","tone":"created","raw":"Gönderi_Hazırlandı"},{"key":"transfer","code":2,"label":"Transfer Aşamasında","tone":"transit","raw":"Transfer_Aşamasında"},{"key":"branch","code":3,"label":"Teslimat Birimine Ulaştı","tone":"transit","raw":"Teslimat_Birimine_Ulaştı"},{"key":"delivery","code":4,"label":"Alıcı Adresine Yönlendirildi","tone":"delivery","raw":"Alıcı_Adresine_Yönlendirildi"},{"key":"delivered","code":5,"label":"Teslim Edildi","tone":"delivered","raw":"Teslim_Edildi"},{"key":"failed","code":6,"label":"Teslim Edilemedi","tone":"problem","raw":"Teslim_Edilemedi"},{"key":"return","code":7,"label":"Geri Geliyor","tone":"return","raw":"Geri_Geliyor"},{"key":"support","code":8,"label":"Destek Gerekiyor","tone":"problem","raw":"Destek_Gerekiyor"}];
function cargoStatusInfo(order){
  const code=Number(order.shipmentStatusCode);
  const normalized=String(order.shipmentStatus||"").replace(/_/g," ").trim().toLocaleLowerCase("tr-TR");
  const state=CARGO_STATES.find(s=>s.code===code)
    ||CARGO_STATES.find(s=>s.label.toLocaleLowerCase("tr-TR")===normalized)
    ||(order.isDelivered===true ? CARGO_STATES.find(s=>s.key==="delivered") : null);
  if(isCargoAwaitingHandover(order)&&["sending","sent","uncertain","historical"].includes(order?.sube_etiket_durumu))return {key:"created",tone:"created",label:order.sube_etiket_durumu==="historical"?"Şubeden kesilen · takip bilgisi bekleniyor":"Etiket işlemi şubede"};
  if(isCargoAwaitingHandover(order))return {key:"created",tone:"created",label:hasCargoLabel(order)?"Etiket hazır · DHL teslim alımı bekleniyor":"Etiket oluşturulacak"};
  return state ? {...state} : {key:"unknown",tone:"unknown",label:String(order.shipmentStatus||"DHL durumu henüz alınmadı").replace(/_/g," ")};
}
function isCargoAwaitingHandover(order){
  const code=Number(order?.shipmentStatusCode);
  const status=String(order?.shipmentStatus||"").replace(/_/g," ").trim();
  return order?.kargo_durumu==="Kargolandı" && order?.isDelivered!==true
    && (!code||code===1) && ["","Gönderi Hazırlandı","DHL sipariş kaydı oluşturuldu; barkod bekleniyor"].includes(status);
}
function canRequestBranchLabel(order){
  return isGaziAdmin && isCargoAwaitingHandover(order) && !hasCargoLabel(order)
    && cargoEnvironment(order)!=="test" && !["sending","sent","uncertain","historical"].includes(order?.sube_etiket_durumu);
}
function branchLabelBadge(order){
  const labels={sending:"Şubeye gönderiliyor",sent:"Şubeye iletildi",uncertain:"Şube gönderimi kontrol edilmeli",historical:"Şubeden kesilen"};
  const label=labels[order?.sube_etiket_durumu];
  return label?`<span class="order-stage-badge order-stage-badge--branch">${label}</span>`:"";
}
function branchLabelButton(order,compact=false){
  if(isGaziAdmin&&order?.sube_etiket_durumu==="historical"&&!order.kargo_takip_kodu)return `<button type="button" class="btn-cargo-label cargo-label-branch" onclick="event.stopPropagation(); refreshCargoMovements()">Şube gönderisini bul</button>`;
  if(isGaziAdmin&&["sent","uncertain"].includes(order?.sube_etiket_durumu))return `<button type="button" class="btn-cargo-label cargo-label-branch" onclick="event.stopPropagation(); sendBranchLabel(${Number(order.siparis_no)},this,'confirm')">Şubeden Kesildi İşaretle</button>`;
  return canRequestBranchLabel(order)?`<button type="button" class="btn-cargo-label cargo-label-branch${compact?" cargo-label-branch--compact":""}" onclick="event.stopPropagation(); sendBranchLabel(${Number(order.siparis_no)},this)">Şubeye İlet</button>`:"";
}

function canPrintCargoLabel(order){
  return !["sending","sent","uncertain","historical"].includes(order?.sube_etiket_durumu) && isCargoAwaitingHandover(order) && !!order?.orderinvoiceid;
}
function cargoStateFilter(key){
  if(key==="created")return 'and(kargo_durumu.eq.Kargolandı,or(isDelivered.is.null,isDelivered.eq.false),or(shipmentStatusCode.is.null,shipmentStatusCode.eq.1),or(shipmentStatus.is.null,shipmentStatus.eq.,shipmentStatus.eq.Gönderi_Hazırlandı,shipmentStatus.eq.Gönderi Hazırlandı,shipmentStatus.eq.DHL sipariş kaydı oluşturuldu; barkod bekleniyor))';
  const state=CARGO_STATES.find(s=>s.key===key);
  if(!state)return "";
  const fallback=`or(shipmentStatus.is.null,shipmentStatus.eq.),isDelivered.eq.true`;
  let expression=`shipmentStatusCode.eq.${state.code},and(shipmentStatusCode.is.null,or(shipmentStatus.eq.${state.raw},shipmentStatus.eq.${state.label}))`;
  if(key==="delivered")expression+=`,and(shipmentStatusCode.is.null,${fallback})`;
  return expression;
}

function cargoBranchPhones(value){
  let area="";
  return String(value||"").split(/\s*[-/;,]\s*/).map(part=>{
    let digits=part.replace(/\D/g,"");
    if(digits.length===12&&digits.startsWith("90"))digits="0"+digits.slice(2);
    if(digits.length===10)digits="0"+digits;
    if(digits.length===11&&digits.startsWith("0"))area=digits.slice(0,4);
    else if(digits.length===7&&area)digits=area+digits;
    else return null;
    return {number:digits,label:digits.replace(/^(\d{4})(\d{3})(\d{2})(\d{2})$/,"$1 $2 $3 $4")};
  }).filter(Boolean);
}
function cargoBranchContact(movement){
  if(!movement)return "";
  const name=movement.locationAddress||movement.location||"";
  const phones=cargoBranchPhones(movement.locationPhone);
  return `<span class="cargo-branch-contact">${escapeHtml(name)}${phones.map(phone=>` · <a href="tel:${phone.number}" onclick="event.stopPropagation()" aria-label="${escapeHtml(name)} şubesini ara: ${phone.label}" style="color:inherit;text-decoration:underline;white-space:nowrap">☎ ${phone.label}</a>`).join("")}</span>`;
}
function cargoMovementTime(event) {
  function parse(value) {
    let text = String(value ?? "").trim();
    const local = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(.*)$/);
    if (local) text = local[3] + "-" + local[2].padStart(2, "0") + "-" + local[1].padStart(2, "0") + local[4];
    const m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/i);
    if (!m) return null;
    const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4] || 0, m[5] || 0, m[6] || 0].map(Number);
    const ms = Number((m[7] || "").padEnd(3, "0"));
    const utc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
    const date = new Date(utc);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day ||
        date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return null;
    // DHL dates without an offset are recorded in Türkiye time.
    let offset = 180;
    if (m[8]) {
      if (m[8].toUpperCase() === "Z") offset = 0;
      else {
        const zone = m[8].replace(":", "");
        const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(3, 5));
        if (hours > 23 || minutes > 59) return null;
        offset = (hours * 60 + minutes) * (zone[0] === "-" ? -1 : 1);
      }
    }
    return { time: utc - offset * 60000, hasTime: m[4] !== undefined };
  }
  const dates = [event?.eventDateTime2, event?.eventDateTime].map(parse).filter(Boolean);
  return (dates.find(date => date.hasTime) || dates[0])?.time ?? -Infinity;
}

function sortCargoMovements(movements) {
  if (!Array.isArray(movements)) return [];
  return movements.map((event, index) => ({event, index, time: cargoMovementTime(event)}))
    .sort((a, b) => b.time - a.time || a.index - b.index)
    .map(item => item.event);
}

function cargoTrackingData(order){
  try{const response=typeof order.kargo_api_yanit==="string"?JSON.parse(order.kargo_api_yanit||"{}"):order.kargo_api_yanit;return response?.tracking||{};}catch{return {};}
}

function cargoStatusBadge(order,{compact=false}={}){
  const {tone,label}=cargoStatusInfo(order);
  const checked=order.kargo_gunc_saat ? `<small class="cargo-checked">${escapeHtml(formatDateTimeTR(order.kargo_gunc_saat))}</small>` : "";
  const movements=cargoTrackingData(order).movements;
  const latest=sortCargoMovements(movements)[0] || null;
  const contact=cargoStatusInfo(order).key==="failed"&&latest ? `<small style="display:block;margin-top:5px">${cargoBranchContact(latest)}</small>` : "";
  const returnBadge = order.iade_kodu ? `<small class="cargo-checked"><span class="cargo-status cargo-status--return">İade etiketi oluşturuldu</span></small>` : "";
  return `<span class="cargo-status-actions"><span class="cargo-status cargo-status--${tone}">${escapeHtml(label)}</span>${currentTab==="kargolandi"&&canRequestBranchLabel(order)?branchLabelButton(order,true):""}</span>${returnBadge}${checked}${contact}`;
}
function cargoEnvironment(order){
  try {
    const response=typeof order?.kargo_api_yanit==="string" ? JSON.parse(order.kargo_api_yanit||"{}") : order?.kargo_api_yanit;
    return response?.environment;
  } catch { return undefined; }
}
function isLiveShipment(order){
  try { return JSON.parse(order.kargo_api_yanit||"{}").environment!=="test" && !!order.kargo_takip_kodu; }
  catch { return false; }
}
function syncCargoTools(){
  const batchTools=document.getElementById("batchPrepareTools");
  if(batchTools)batchTools.hidden=currentTab!=="bekleyen";
  const batchButton=document.getElementById("batchPrepareBtn");
  if(batchButton&&!batchPreparing)batchButton.textContent=isMobilePreparation()?"İlk 10 Siparişi Hazırla":"İlk 10 Siparişi Yazdır ve Hazırla";
  const tools=document.getElementById("cargoTools");
  if(tools) tools.hidden=!["kargolandi","tamamlandi","sorunlu","iade"].includes(currentTab);
  document.querySelectorAll("[data-cargo-filter]").forEach(button=>{
    button.setAttribute("aria-pressed",String(button.dataset.cargoFilter===cargoFilter));
  });
}
const CARGO_FILTER_GROUPS={created:["created"],transit:["transfer","branch"],delivery:["delivery"],delivered:["delivered"],return:["return"],problem:["failed","support"]};
function matchesCargoFilter(order){
  if(cargoFilter==="created")return isCargoAwaitingHandover(order);
  return cargoFilter==="all"||(CARGO_FILTER_GROUPS[cargoFilter]||[]).includes(cargoStatusInfo(order).key);
}
function applyCargoFilter(query){
  if(!["kargolandi","tamamlandi","sorunlu","iade"].includes(currentTab)||cargoFilter==="all")return query;
  const expression=(CARGO_FILTER_GROUPS[cargoFilter]||[]).map(cargoStateFilter).filter(Boolean).join(',');
  return expression ? query.or(expression) : query;
}
function filterCargo(key){
  operationFilter="";
  document.querySelectorAll("[data-operation]").forEach(button=>button.setAttribute("aria-pressed","false"));
  if(key!=="all"&&!CARGO_FILTER_GROUPS[key])return;
  cargoFilter=key;
  document.getElementById("searchInput").value="";
  loadOrders(true);
}
window.filterCargo=filterCargo;
async function cargoRequest(url,body={}){
  if(!url) throw new Error("Canlı kargo bağlantısı ayarlanmamış.");
  const {data:sessionData}=await db.auth.getSession();
  if(!sessionData.session?.access_token)throw new Error("Oturum gerekli. Panele yeniden giriş yapın.");
  body={...body,accessToken:sessionData.session.access_token,publicKey:SUPABASE_KEY};
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),210000);
  try{
    const response=await fetch(url,{method:"POST",body:new URLSearchParams(body),signal:controller.signal});
    let result;try{result=JSON.parse(await response.text());}catch{throw new Error("n8n geçerli JSON yanıtı döndürmedi.");}
    if(!response.ok||result.success!==true||result.environment!=="production")throw new Error(result.message||"DHL canlı işlemi başarısız.");
    return result;
  }catch(error){if(error.name==="AbortError")throw new Error("DHL canlı isteği zaman aşımına uğradı.");if(error instanceof TypeError)throw new Error("Kargo bağlantısına ulaşılamadı. n8n erişimini kontrol edin.");throw error;}
  finally{clearTimeout(timeout);}
}
let cargoSyncBusy=false;
async function connectCargo(){
  const button=document.getElementById("connectCargoBtn");if(button.disabled)return;
  button.disabled=true;const label=button.textContent;button.textContent="Bağlanıyor…";
  try{
    const result=await cargoRequest(CONFIG.webhooks.baglan,{operation:"baglan"});
    document.getElementById("cargoSyncStatus").textContent="DHL canlı bağlantısı hazır. Token geçerlilik: "+result.jwtExpireDate;
    toast("DHL canlı hesabına bağlanıldı. Token n8n'de saklandı.");
  }catch(error){toast(error.message,8000);}
  finally{button.disabled=false;button.textContent=label;}
}
async function refreshCargoMovements(){
  if(cargoSyncBusy)return;
  cargoSyncBusy=true;const button=document.getElementById("refreshCargoBtn");const status=document.getElementById("cargoSyncStatus");button.disabled=true;
  try{
    status.textContent="Kargo durumları toplu sorgulanıyor…";
    const url=CONFIG.webhooks.hareket_toplu||new URL("gazi_hareket_toplu",CONFIG.webhooks.hareket).href;
    const result=await cargoRequest(url,{operation:"hareket_toplu"});
    status.textContent=`${result.received} gönderi incelendi · ${result.updated} kayıt güncellendi · ${result.unchanged} değişmemiş · ${result.unmatched} eşleşmedi.`;
    if(result.ambiguous)status.textContent+=` ${result.ambiguous} belirsiz eşleşme atlandı.`;
    if(result.has_more)status.textContent+=" Önceki günler tamamlandı; kalan günler için yeniden güncelleyebilirsiniz.";
    await loadOrders(true);
    if(selectedOrder&&document.getElementById("orderModal").style.display==="flex")await openOrder(selectedOrder.siparis_no);
    toast(result.has_more?"Geçmiş günler toplu güncellendi. Kalan günler için tekrar güncelleyin.":"Kargo durumları toplu güncellendi.",6000);
  }catch(error){status.textContent="Güncelleme tamamlanamadı: "+error.message;toast(error.message,8000);}
  finally{cargoSyncBusy=false;button.disabled=false;}
}
let cargoDetailBusy=false;
async function refreshSelectedCargoMovements(id){
  if(cargoDetailBusy)return;
  const orderId=Number(id);
  if(!Number.isSafeInteger(orderId)||orderId<1)return;
  cargoDetailBusy=true;
  const button=document.querySelector("[data-cargo-detail-refresh]");
  if(button){button.disabled=true;button.textContent="Hareketler getiriliyor…";}
  try{
    const result=await cargoRequest(CONFIG.webhooks.hareket,{operation:"hareket",siparis_no:String(orderId)});
    if(selectedOrder?.siparis_no==orderId&&document.getElementById("orderModal").style.display==="flex")await openOrder(orderId);
    toast(result.warning||"Kargo hareket geçmişi güncellendi.",6000);
  }catch(error){toast(error.message,8000);}
  finally{cargoDetailBusy=false;if(button?.isConnected){button.disabled=false;button.textContent="Hareket geçmişini getir";}}
}
function cargoQrCodes(order){
  const raw=order?.kargo_qr_kod;
  if(raw===null||raw===undefined||raw==='')return [];
  let values=raw;
  if(typeof raw==='string'){
    try{values=JSON.parse(raw);}catch{values=raw.trim().startsWith('[')?[]:[raw.trim()];}
  }
  if(typeof values==='string')values=[values];
  if(!Array.isArray(values))return [];
  return [...new Set(values.filter(x=>typeof x==='string').map(x=>x.trim()).filter(x=>x.length>0&&x.length<=100))];
}

function savedCargoPieces(order){
  try{
    const raw=String(order.kargo_zpl||'').trim();
    const qrCodes=cargoQrCodes(order);
    let labels=[];
    try{labels=raw?JSON.parse(raw.startsWith('[')?raw:new TextDecoder().decode(Uint8Array.from(atob(raw),c=>c.charCodeAt(0)))):[];}catch{}
    if(!Array.isArray(labels)||labels.length>100)labels=[];
    // QR is authoritative. Match the original label by exact code, never list position.
    if(qrCodes.length)labels=qrCodes.map((barcode,index)=>({...labels.find(x=>x?.barcode===barcode),barcode,pieceNumber:labels.find(x=>x?.barcode===barcode)?.pieceNumber||index+1}));
    const seen=new Set();
    return labels.filter(x=>{
      if(typeof x?.barcode!=='string'||!x.barcode.trim()||seen.has(x.barcode))return false;
      seen.add(x.barcode);return true;
    }).map(x=>({...x,printable:typeof x.value==='string'&&x.value.trim().startsWith('^XA')&&x.value.trim().endsWith('^XZ')&&(x.value.match(/\^XA/g)||[]).length===1&&(x.value.match(/\^XZ/g)||[]).length===1}));
  }catch{return [];}
}
function hasPackageMovementData(order){
  const movements=cargoTrackingData(order).movements;
  return Array.isArray(movements)&&movements.some(m=>String(m.barcode||m.pieceBarcode||m.packageBarcode||'').trim());
}
function cargoPieceHasExit(order,barcode){
  const movements=cargoTrackingData(order).movements;
  return Array.isArray(movements)&&movements.some(m=>String(m.barcode||m.pieceBarcode||m.packageBarcode||'').trim()===barcode&&['2','3','4','5','6','7','8','9'].includes(String(m.eventSequence)));
}
function canReprintCargoPiece(order,piece){
  let meta;try{meta=typeof order.kargo_api_yanit==='string'?JSON.parse(order.kargo_api_yanit||'{}'):order.kargo_api_yanit||{};}catch{return false;}
  return isGaziAdmin&&piece.printable&&order.kargo_durumu==='Kargolandı'&&meta.environment!=='test'&&meta.activeShipmentCancelled!==true&&order.isDelivered!==true&&Number(order.shipmentStatusCode)!==5&&!cargoPieceHasExit(order,piece.barcode);
}
function renderCargoPieces(order){
  const pieces=savedCargoPieces(order);
  if(!pieces.length)return '';
  return `<details class="cargo-pieces cargo-label-archive"><summary>Kayıtlı etiketler <span class="disclosure-count">${pieces.length} paket</span><span class="disclosure-action"></span></summary><small data-label-print-count="${Number(order.siparis_no)}">${Math.max(0,Number(order.etiket_yazdirma_sayisi)||0)} kez yazdırma açıldı</small>${pieces.map((piece,index)=>`<div class="cargo-piece"><div><strong>Paket ${escapeHtml(piece.pieceNumber||index+1)}</strong><code>QR / Paket barkodu: ${escapeHtml(piece.barcode)}</code></div>${!piece.printable?'<small>Bu QR koduna ait orijinal etiket bulunamadı.</small>':''}${canReprintCargoPiece(order,piece)?`<button type="button" class="btn-open cargo-label-print" onclick="reprintCargoPiece(${Number(order.siparis_no)},${index},this)">Etiketi Yazdır</button>`:''}</div>`).join('')}</details>`;
}

const piecePrintBusy=new Set();
async function reprintCargoPiece(orderId,index,button){
  const id=Number(orderId);
  if(!isGaziAdmin||!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(index)||index<0||piecePrintBusy.has(id))return;
  const wanted=savedCargoPieces(selectedOrder||{})[index]?.barcode;
  if(selectedOrder?.siparis_no!==id||!wanted)return;
  const w=window.open('','_blank');
  if(!w)return toast('Etiket için açılır pencerelere izin verin.');
  w.document.body.textContent='Seçilen orijinal paket etiketi hazırlanıyor…';
  piecePrintBusy.add(id);button.disabled=true;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
  try{
    const {data:order,error}=await db.from(TABLE).select('*').eq('siparis_no',id).single();
    if(error)throw error;
    const piece=savedCargoPieces(order).find(p=>p.barcode===wanted);
    if(!piece||!canReprintCargoPiece(order,piece))throw Error('Paket durumu değişmiş veya orijinal etiketi bulunamıyor. Hareketleri yenileyin.');
    // Render the existing barcode only, using the same renderer as the cargo workflow.
    const response=await fetch('https://api.labelary.com/v1/printers/8dpmm/labels/4.1x4.8/0/',{method:'POST',headers:{Accept:'application/pdf','Content-Type':'application/x-www-form-urlencoded'},body:piece.value,signal:controller.signal});
    if(!response.ok)throw Error('Etiket görüntüsü hazırlanamadı ('+response.status+'). Tekrar deneyin.');
    const bytes=new Uint8Array(await response.arrayBuffer());
    let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    await openCargoPdf(w,btoa(binary),{...order,ad_soyad:order.ad_soyad+' - Paket '+(piece.pieceNumber||index+1)});
    toast('Yalnızca seçilen paketin orijinal etiketi açıldı.');
  }catch(error){if(!w.closed)w.close();toast(error.name==='AbortError'?'Etiket isteği zaman aşımına uğradı.':error.message,8000);}
  finally{clearTimeout(timeout);piecePrintBusy.delete(id);if(button.isConnected)button.disabled=false;}
}
window.reprintCargoPiece=reprintCargoPiece;

// Only carrier-provided piece barcodes identify a package. A shipment ID is shared.
function cargoMovementIdentity(movement){
  const barcode=String(movement?.barcode||movement?.pieceBarcode||movement?.packageBarcode||'').trim();
  const shipment=String(movement?.shipmentId||'').trim();
  const reference=String(movement?.referenceId||'').trim();
  const fields=[];
  if(barcode)fields.push(`Barkod: ${escapeHtml(barcode)}`);
  if(shipment)fields.push(`Gönderi takip no: ${escapeHtml(shipment)}`);
  if(reference)fields.push(`Referans: ${escapeHtml(reference)}`);
  return `<span class="cargo-movement-identity">${fields.join(' · ')}</span>`;
}

function renderCargoTracking(order){
  if(!order.kargo_takip_kodu&&!order.orderinvoiceid)return `<details class="detail-group detail-movement-history"><summary>Kargo hareketleri <span class="disclosure-action"></span></summary><p class="cargo-empty">Henüz kayıtlı kargo hareketi yok.</p></details>`;
  const tracking=cargoTrackingData(order);
  const movements=sortCargoMovements(tracking?.movements);
  const timeline=movements.map(m=>`<li><strong>${escapeHtml(m.eventStatus||"Kargo hareketi")}</strong><span>${escapeHtml(m.eventDateTime||m.eventDateTime2||"")} · ${cargoBranchContact(m)}</span>${m.description?`<span>${escapeHtml(m.description)}</span>`:""}${cargoMovementIdentity(m)}</li>`).join("");
  const url=order.kargo_takip_url;
  let link="";try{if(new URL(url).protocol==="https:")link=`<a class="btn-open" target="_blank" rel="noopener noreferrer" href="${escapeHtml(url)}">Kargo Takip Sayfası</a>`;}catch{}
  const detailButton=isLiveShipment(order)?`<button class="btn-open" type="button" data-cargo-detail-refresh onclick="refreshSelectedCargoMovements(${Number(order.siparis_no)})">Hareket geçmişini getir</button>`:"";
  return `<details class="detail-group cargo-detail detail-movement-history"><summary>Kargo hareketleri <span class="disclosure-count">${movements.length} kayıt</span><span class="disclosure-action"></span></summary><div class="detail-cargo-heading"><div class="detail-title">Kargo ve teslimat</div><span class="detail-tracking-number">${escapeHtml(order.kargo_takip_kodu||"Takip no bekleniyor")}</span></div>${cargoStatusBadge(order,{compact:true})}<div class="detail-cargo-actions">${link}${detailButton}${isGaziAdmin&&canCancelShipment(order)?`<button type="button" class="btn-danger" data-cancel-shipment onclick="cancelShipmentToWaiting(${Number(order.siparis_no)},this)">Gönderiyi İptal Et</button>`:""}</div><div class="detail-cargo-events">${renderCargoPieces(order)}${timeline?`<ol class="cargo-timeline">${timeline}</ol>`:"<p class='cargo-empty'>Henüz kayıtlı kargo hareketi yok.</p>"}${tracking?.movementError?`<p class="cargo-warning">${escapeHtml(tracking.movementError)}</p>`:""}</div></details>`;
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
let detailLoadRequest=0;
async function openOrder(id){
  const request=++detailLoadRequest;
  const { data } = await db.from(TABLE).select("*").eq("siparis_no", id).single();
  if(request!==detailLoadRequest)return;
  if(!data) return toast("Sipariş bulunamadı!");
  if(data.kargo_durumu==="Silindi"){
    let mergedInto;try{mergedInto=JSON.parse(data.kargo_api_yanit||"{}").one_time_reconciliation?.merged_into;}catch{}
    if(Number.isSafeInteger(Number(mergedInto))&&Number(mergedInto)>0&&Number(mergedInto)!==Number(id))return openOrder(Number(mergedInto));
    return toast("Bu sipariş arşivlendi.");
  }
  markExtras([data],['history','noteDetail']);
  const modal = document.getElementById("orderModal");
  const resetScroll = selectedOrder?.siparis_no !== data.siparis_no || modal.style.display !== "flex";
  selectedOrder = data;
  renderDetails();
  modal.style.display = "flex";
  if (resetScroll) modal.scrollTop = 0;
  void hydrateExtras([data],()=>request===detailLoadRequest&&selectedOrder===data&&modal.style.display==="flex",document.getElementById("orderDetails"),["history","noteDetail"]);
}

function closeModal(){
  ++detailLoadRequest;
  document.getElementById("orderModal").style.display = "none";
}

function renderOriginalMessage(order) {
  const message = order.whatsapp_message_text;
  return `<details class="detail-group original-message">
    <summary>Orjinal mesaj <span class="disclosure-action"></span></summary>
    <p class="original-message-hint">Sipariş bilgileriyle karşılaştırmak için gelen mesajı açın.</p>
    <div class="original-message-text">${escapeHtml(message === undefined ? "Mesajı görmek için bölümü açın." : (message || "Bu siparişin orijinal mesajı kayıtlı değil."))}</div>
  </details>`;
}

function bindOriginalMessage(order, panel = document.querySelector("#orderDetails .original-message")) {
  if (!panel) return;
  let loading = false;
  panel.addEventListener("toggle", async () => {
    if (!panel.open || loading || order.whatsapp_message_text !== undefined) return;
    loading = true;
    const content = panel.querySelector(".original-message-text");
    content.textContent = "Orijinal mesaj yükleniyor…";
    try {
      const { data, error } = await db.from("tum_siparisler")
        .select("whatsapp_message_text").eq("siparis_no", order.siparis_no).maybeSingle();
      if (error) throw error;
      order.whatsapp_message_text = data?.whatsapp_message_text ?? null;
      content.textContent = order.whatsapp_message_text || "Bu siparişin orijinal mesajı kayıtlı değil.";
    } catch (error) {
      content.textContent = "Orijinal mesaj alınamadı. Bölümü kapatıp yeniden açarak tekrar deneyin.";
      console.error("Orijinal mesaj alınamadı:", error);
    } finally {
      loading = false;
    }
  });
}

function renderDetails() {
  const d = selectedOrder;

  /* — TÜM BUTONLARI RESETLE — */
  document.querySelectorAll("#actionButtons button").forEach(btn => {
    btn.style.display = "inline-block";
  });

  /* — DETAY HTML — */
document.getElementById("orderDetails").innerHTML = `
<section class="detail-overview" aria-label="Sipariş özeti">
 <div class="detail-overview-main"><span class="detail-eyebrow">SİPARİŞ #${Number(d.siparis_no)}</span><h3>${escapeHtml(d.ad_soyad || "Müşteri")}</h3><div class="detail-overview-status">${orderStageBadge(d)}</div></div>
 <div class="detail-overview-total"><strong>${escapeHtml(d.toplam_tutar ?? "—")} <small>TL</small></strong><span>${escapeHtml(d.odeme_sekli || "Belirtilmemiş")}</span></div>
</section>
<div class="detail-compact-meta">
 ${d.musteri_tel?`<a class="detail-contact-phone" href="tel:${escapeHtml(String(d.musteri_tel).replace(/[^0-9+]/g,""))}">${escapeHtml(d.musteri_tel)}</a>`:""}
 <span>${escapeHtml(formatDateTimeTR(d.tarih))}</span><span class="detail-taker">Sipariş alan: ${orderTakerMarkup(d)}</span>
</div>
<div class="detail-layout detail-layout--compact">
 <div class="detail-column detail-column-customer"><div class="detail-group">
  <div class="detail-title">Teslimat adresi</div>
  <div class="detail-item detail-delivery-type">${d.subeden_teslim===true?"Şubeden teslim"+(d.teslim_subesi?" · "+escapeHtml(d.teslim_subesi):""):"Adrese teslim"}</div>
  ${d.teslim_sekli_kontrol===true?'<div class="detail-item" role="alert">Teslim şeklini kontrol edin.</div>':""}
  <div class="detail-item detail-address-text">${escapeHtml(d.adres??"—")}</div>
  <div class="detail-item detail-city-line"><strong>${escapeHtml(d.sehir??"—")} / ${escapeHtml(d.ilce??"—")}</strong><button class="btn-mini" onclick="queryCityDistrictCodes()">Sor</button></div>
  <div class="detail-address-tools"><small>Kodlar: ${escapeHtml(d.sehir_kodu??"—")} / ${escapeHtml(d.ilce_kodu??"—")}</small>${d.kargo_durumu==="Kargolandı"&&isGaziAdmin?'<button id="btnReferenceLabel" class="btn-reference-mini" type="button" onclick="printReferenceLabel()">Referans Etiketi</button>':""}</div>
 </div></div>
 <div class="detail-column detail-column-order"><div class="detail-group">
  <div class="detail-title">Ürün bilgisi</div><div class="detail-product-lines">${escapeHtml(parseProduct(d.urun_bilgisi))}</div>
  <div class="detail-parcel-line">${cargoCountBadge(d.kargo_adet)}<span>paket</span><strong>${escapeHtml(CargoWeights.display(d.kargo_kg,d.kargo_adet)||"—")} kg</strong></div>
 </div></div>
 ${d.notlar?`<div class="detail-group detail-note"><div class="detail-title">Sipariş notu</div><div class="note-text">${escapeHtml(d.notlar)}</div></div>`:""}
</div>
${OrderReceipts.markup(d)}
${extraSlot(d,'noteDetail')}
${extraSlot(d,'history')}
${renderOriginalMessage(d)}
`;

  document.getElementById("orderDetails").insertAdjacentHTML("beforeend",renderCargoTracking(d) + renderReturnDetail(d));
  bindOriginalMessage(d);
  OrderReceipts.mount(db,d,document.getElementById("orderDetails"),()=>loadOrders(true));
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
         Hazırlandı → Göster
         Kargolandı → Gizle
  ============================================================ */
  try {
    const duzenleBtn = document.querySelector("#actionButtons .btn-warning");
    if (duzenleBtn && d.kargo_durumu === "Kargolandı") {
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
  const tamam = currentTab === "tamamlandi" || d.kargo_durumu === "Tamamlandı" || d.isDelivered === true || Number(d.shipmentStatusCode) === 5;

  // Bekleyeni → Hazırla
  document.getElementById("btnPrepare").style.display =
    d.kargo_durumu === "Bekliyor" ? "inline-block" : "none";

  // Hazırlandı → Kargola
  document.getElementById("btnCargo").style.display =
    d.kargo_durumu === "Hazırlandı" ? "inline-block" : "none";

  // Kargolandı, fakat henüz fiş/etiket oluşturulmadı: DHL gönderisini iptal edip Bekleyen'e al.
  const cancelShipmentButton=document.getElementById("btnCancelShipment");
  if(cancelShipmentButton)cancelShipmentButton.style.display=canCancelShipment(d) ? "inline-block" : "none";
  const cancelOrderButton=document.getElementById("btnCancelOrder");
  if(cancelOrderButton)cancelOrderButton.style.display=hasExistingShipment(d) ? "none" : "inline-block";

  // Mevcut etiketi tekrar aç; yeni kargo / barkod oluşturma.
  document.getElementById("btnBarcode").style.display =
    canPrintCargoLabel(d) ? "inline-block" : "none";
  updateCargoLabelButton(document.getElementById("btnBarcode"),d);

  // Tamamlandı → butonları kapat, sadece kapat butonu açık kalsın
  if (tamam) {
    document.querySelectorAll("#actionButtons button").forEach(btn => {
      btn.style.display = "none";
    });
    document.querySelector("#actionButtons .btn-close").style.display = "inline-block";
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
  const id=selectedOrder?.siparis_no;if(!id)return;
  toast("Şehir / ilçe kodları sorgulanıyor…");
  try{await cargoRequest(WH_SEHIR_ILCE,{siparis_no:String(id)});toast("Kodlar güncellendi");await openOrder(id);}
  catch(error){toast(error.message,10000);}
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
  branchSelector=null;
  const d = selectedOrder;
  const deliveryLocked = !!(d.orderinvoiceid || d.kargo_takip_kodu);
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
          <label for="delivery_select">Teslim şekli</label>
          <select id="delivery_select" ${deliveryLocked ? "disabled" : ""}>
            ${d.teslim_sekli_kontrol === true && !deliveryLocked ? '<option value="" selected>Kontrol gerekli — seçim yapın</option>' : ""}
            <option value="false" ${!d.teslim_sekli_kontrol && d.subeden_teslim !== true || deliveryLocked && d.subeden_teslim !== true ? "selected" : ""}>Adrese teslim</option>
            <option value="true" ${!d.teslim_sekli_kontrol && d.subeden_teslim === true || deliveryLocked && d.subeden_teslim === true ? "selected" : ""}>Şubeden teslim</option>
          </select>
        </div>
        <div class="form-field" id="delivery_branch_field" ${d.subeden_teslim === true ? "" : "hidden"}>
          <label for="delivery_branch_select">Teslim alınacak DHL şubesi</label><select id="delivery_branch_select" disabled><option>Önce il ve ilçe seçin</option></select><input id="delivery_branch" type="hidden" value="${escapeHtml(d.teslim_subesi ?? "")}"><p id="delivery_branch_info" class="branch-selector-info" role="status"></p><button id="delivery_branch_retry" class="btn-mini" type="button" hidden>Şubeleri yeniden getir</button>
        </div>
        ${deliveryLocked ? '<div class="form-field full-row"><small>Mevcut DHL kaydı var. Teslim şekli değişikliği için kargo kaydının yeniden açılması gerekir.</small></div>' : ""}

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
        <div class="form-field"><label>Kargo KG</label><input id="kargo_kg" value="${escapeHtml(CargoWeights.display(d.kargo_kg,d.kargo_adet))}" placeholder="5+10+5+6"></div>

        <div class="form-field full-row"><label>Ürün</label><textarea id="urun_bilgisi">${d.urun_bilgisi??""}</textarea></div>
        <div class="form-field"><label>Tutar</label><input id="toplam_tutar" value="${d.toplam_tutar??""}"></div>
        <div class="form-field"><label>Ödeme</label><input id="odeme_sekli" value="${d.odeme_sekli??""}"></div>
        <div class="form-field full-row"><label>Not</label><textarea id="notlar">${d.notlar??""}</textarea></div>
      </div>
    </div>
    ${renderOriginalMessage(d)}`;
  bindOriginalMessage(d);


  document.getElementById("delivery_select").addEventListener("change", event => {
    document.getElementById("delivery_branch_field").hidden = event.target.value !== "true";
  });

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

  branchSelector=bindBranchSelector({order:d,locked:deliveryLocked,request:body=>cargoRequest(CONFIG.webhooks.subeler,body)});
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

  let normalizedKg;
  try { normalizedKg = CargoWeights.normalize(kargo_kg.value, kargo_adet.value); }
  catch(error) { return toast(error.message,6000); }
  const updated = {
    ad_soyad: ad_soyad.value, siparis_tel: siparis_tel.value, musteri_tel: musteri_tel.value,
    adres: adres.value, sehir: sehirName, ilce: ilceName,
    sehir_kodu: sehirKoduVal, ilce_kodu: ilceKoduVal,
    kargo_adet: kargo_adet.value, kargo_kg: normalizedKg,
    urun_bilgisi: urun_bilgisi.value, toplam_tutar: toplam_tutar.value,
    odeme_sekli: odeme_sekli.value, notlar: notlar.value
  };
  if (!(selectedOrder.orderinvoiceid || selectedOrder.kargo_takip_kodu)) {
    const delivery = document.getElementById("delivery_select")?.value;
    if (!["true", "false"].includes(delivery)) return toast("Adrese teslim veya Şubeden teslim seçin.", 6000);
    if(delivery === "true" && !branchSelector?.valid())return toast("Teslim alınacak DHL şubesini listeden seçin.",6000);
    updated.subeden_teslim = delivery === "true";
    updated.teslim_subesi = updated.subeden_teslim ? document.getElementById("delivery_branch").value.trim() || null : null;
    updated.teslim_sekli_kontrol = false;
  }
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

let batchPreparing=false;
async function prepareVisibleOrders(){
  if(batchPreparing||currentTab!=="bekleyen")return;
  const ids=Array.from(document.querySelectorAll("#ordersBody tr[data-order-id]"))
    .filter(row=>!row.hidden&&row.getClientRects().length>0)
    .slice(0,10).map(row=>Number(row.dataset.orderId));
  if(!ids.length)return toast("Ekranda hazırlanacak sipariş yok.");
  if(ids.some(id=>preparingOrders.has(id)))return toast("Bu siparişlerden birinin hazırlama işlemi sürüyor.");
  const mobile=isMobilePreparation();
  batchPreparing=true;
  const button=document.getElementById("batchPrepareBtn");
  button.disabled=true;
  let printWindow=null;
  const prepared=[];
  const key="prepare_batch_"+Date.now()+"_"+Math.random().toString(36).slice(2);
  try{
    const ok=await confirmModal({title:mobile?"İlk 10 Siparişi Hazırla":"Toplu Etiket Yazdır ve Hazırla",
      text:mobile?`Ekrandaki ${ids.length} sipariş Hazırlandı aşamasına geçecek.\n\nSiparişler: ${ids.join(", ")}`:`Uyarı: Ekranda görünen ${ids.length} siparişin etiket yazdırma aşaması yapılacaktır. Siparişlerin adet ve fiyat bilgilerini kontrol ettiğinizi onaylıyor musunuz?\n\nSiparişler: ${ids.join(", ")}\nOnayladığınızda etiketler tek yazdırma ekranında açılacak ve siparişler Hazırlandı aşamasına geçecektir.`,
      confirmText:mobile?"Kontrol Ettim, Hazırla":"Kontrol Ettim, Yazdır ve Hazırla",cancelText:"Vazgeç"});
    if(!ok)return;
    if(!mobile){
      printWindow=window.open("","_blank");
      if(!printWindow)throw new Error("Yazdırma ekranı için açılır pencerelere izin verin.");
      printWindow.document.body.textContent="Sipariş etiketleri hazırlanıyor…";
    }
    ids.forEach(id=>preparingOrders.add(id));
    button.textContent="Siparişler kontrol ediliyor…";
    const {data:rows,error}=await db.from(TABLE).select("*").in("siparis_no",ids);
    if(error)throw error;
    const orders=ids.map(id=>rows?.find(row=>Number(row.siparis_no)===id));
    for(const order of orders){
      if(!order||order.kargo_durumu!=="Bekliyor")throw new Error("Siparişlerden birinin durumu değişti. Listeyi yenileyip tekrar deneyin.");
      const count=Number(order.kargo_adet);
      if(!Number.isSafeInteger(count)||count<1||count>100)throw new Error(order.siparis_no+" siparişinin kargo adedini düzeltin.");
    }
    // Ensure printable data can be stored before changing any order state.
    if(!mobile)localStorage.setItem(key,JSON.stringify(orders));
    for(const order of orders){
      if(printWindow?.closed)throw new Error("Yazdırma penceresi kapatıldı.");
      button.textContent=`Hazırlanıyor… ${prepared.length+1}/${orders.length}`;
      const {data:updated,error}=await db.from(TABLE).update({kargo_durumu:"Hazırlandı"})
        .eq("siparis_no",order.siparis_no).eq("kargo_durumu","Bekliyor").select("siparis_no");
      if(error)throw error;
      if(!updated?.length)throw new Error(order.siparis_no+" artık Bekleyen durumunda değil.");
      prepared.push(order);
      db.functions.invoke("whatsapp-reaction",{body:{siparis_no:order.siparis_no,emoji:"📦"}})
        .then(({error})=>{if(error)console.error("WhatsApp reaksiyon hatası",error);})
        .catch(error=>console.error("WhatsApp reaksiyon hatası",error));
    }
  }catch(error){
    toast((prepared.length?prepared.length+" sipariş hazırlandı. Kalanlar işlenmedi. ":"")+(error.message||"Toplu hazırlama başarısız."),10000);
  }finally{
    try{
      if(prepared.length){
        if(!mobile){
          localStorage.setItem(key,JSON.stringify(prepared));
          if(printWindow&&!printWindow.closed)printWindow.location.replace("printetiket-v2.html?v=20261015-batch&batch="+encodeURIComponent(key));
        }
        toast(mobile?prepared.length+" sipariş hazırlandı 📦":prepared.length+" sipariş hazırlandı; toplam "+prepared.reduce((sum,o)=>sum+Number(o.kargo_adet),0)+" etiket açılıyor.",6000);
      }else{
        localStorage.removeItem(key);
        if(printWindow&&!printWindow.closed)printWindow.close();
      }
    }catch(error){toast("Siparişler hazırlandı; yazdırma ekranı açılamadı. Hazırlandı sekmesinden etiketleri açabilirsiniz.",10000);}
    ids.forEach(id=>preparingOrders.delete(id));
    batchPreparing=false;button.disabled=false;button.textContent=mobile?"İlk 10 Siparişi Hazırla":"İlk 10 Siparişi Yazdır ve Hazırla";
    if(prepared.length)await loadOrders(true);
  }
}
window.prepareVisibleOrders=prepareVisibleOrders;
function isMobilePreparation(){
  return window.matchMedia("(max-width: 900px), (hover: none) and (pointer: coarse)").matches;
}
const preparingOrders = new Set();
async function prepareFromList(siparisNo, button){
  if(batchPreparing)return toast("Toplu hazırlama işlemi sürüyor.");
  if(preparingOrders.has(siparisNo)) return;
  const mobile=isMobilePreparation();
  const printWindow = mobile?null:window.open("", "_blank");
  if(!mobile&&!printWindow) return toast("Yazdırma ekranı için açılır pencerelere izin verin.");
  if(printWindow)printWindow.document.body.textContent="Sipariş hazırlanıyor…";
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
    if(!mobile){
      localStorage.setItem("prepare_print_"+siparisNo,JSON.stringify(order));
      if(!printWindow.closed) printWindow.location.replace("printetiket-v2.html?v=20261011-prepared-label&order="+encodeURIComponent(siparisNo));
    }
    toast(mobile?"Sipariş hazırlandı 📦":"Sipariş hazırlandı. "+count+" paket barkodu açıldı.");
    await loadOrders(true);
  } catch(error){
    if(printWindow&&!printWindow.closed) printWindow.close();
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

  // Telefonda yalnızca hazırlama; masaüstünde yazdırma seçimi.
  if(!isMobilePreparation())openPrintChooser();

  toast("Sipariş Hazırlandı 📦");

  closeModal();

  setTimeout(() => loadOrders(true), 1000);
}

function cargoPdfFilename(order) {
  const clean=value=>String(value??"").normalize("NFC")
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g," ")
    .replace(/\s+/g," ").trim().replace(/[. ]+$/g,"");
  const name=Array.from(clean(order?.ad_soyad)||"Sipariş").slice(0,140).join("");
  const number=clean(order?.siparis_no)||"Numarasız";
  return `${name} - ${number}.pdf`;
}

async function openCargoPdf(w, base64, order, {trackPrint=true}={}){
  if(!base64?.startsWith("JVBER")) throw new Error("Geçerli etiket PDF'si alınamadı.");
  if(w.closed)throw new Error("Etiket penceresi kapatıldı. Etiketi Yazdır ile tekrar açabilirsiniz.");
  const filename=cargoPdfFilename(order);
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  const blob=new Blob([bytes],{type:"application/pdf"});
  let url,cleanup,named=false;
  try {
    if(!navigator.serviceWorker?.controller || !window.caches)throw Error("Named preview unavailable");
    // The current worker must support named responses; an old worker may still
    // control the page briefly while an update is activating.
    await new Promise((resolve,reject)=>{
      const channel=new MessageChannel();
      const timeout=setTimeout(()=>{channel.port1.close();reject(Error("Worker not ready"));},1500);
      channel.port1.onmessage=event=>{clearTimeout(timeout);channel.port1.close();event.data===true?resolve():reject(Error("Unsupported worker"));};
      navigator.serviceWorker.controller.postMessage({type:"gazi-cargo-pdf-support"},[channel.port2]);
    });
    const cache=await caches.open("gazi-pdf-previews-v1");
    for(const request of await cache.keys()){
      const previous=await cache.match(request);
      if(Number(previous?.headers.get("X-Preview-Expires"))<=Date.now())await cache.delete(request);
    }
    url=new URL(`/__cargo_pdf__/${crypto.randomUUID()}/${encodeURIComponent(filename)}`,location.origin).href;
    const ascii=filename.replace(/ı/g,"i").replace(/İ/g,"I").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\x20-\x7e]/g,"_");
    const encoded=encodeURIComponent(filename).replace(/['()*]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase());
    await cache.put(url,new Response(blob,{headers:{
      "Content-Type":"application/pdf",
      "Content-Disposition":`inline; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      "Cache-Control":"no-store",
      "X-Preview-Expires":String(Date.now()+60*60*1000)
    }}));
    cleanup=()=>{cache.delete(url).catch(()=>{});};
    named=true;
  } catch {
    // Without a controlling worker, provide an explicitly named download link.
    url=URL.createObjectURL(blob);
    cleanup=()=>URL.revokeObjectURL(url);
  }
  if(w.closed){cleanup();throw new Error("Etiket penceresi kapatıldı. Etiketi Yazdır ile tekrar açabilirsiniz.");}
  w.document.title=filename.replace(/\.pdf$/i,"");
  w.document.body.replaceChildren();
  w.document.body.style.cssText="margin:0";
  if(!named){
    const download=w.document.createElement("a");
    download.href=url;download.download=filename;download.textContent="PDF İndir · "+filename;
    download.style.cssText="display:block;box-sizing:border-box;height:42px;padding:10px;background:#e6f1ea;color:#20543b;font:14px system-ui;text-decoration:none";
    w.document.body.appendChild(download);
  }
  const frame=w.document.createElement("iframe");
  frame.title=filename;frame.src=url+"#view=FitH";
  frame.style.cssText=`display:block;border:0;width:100%;height:${named?"100vh":"calc(100vh - 42px)"}`;
  w.document.body.appendChild(frame);
  w.document.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();w.close();}});
  w.addEventListener("unload",cleanup,{once:true});
  if(trackPrint)await recordCargoLabelPrint(order);
}

async function shipPreparedFromList(siparisNo, button){
  if(button.disabled || busy.kargola.has(Number(siparisNo))) return;
  const label=button.textContent;
  button.disabled=true;
  button.textContent="Kontrol ediliyor…";
  try {
    const {data:order,error}=await db.from(TABLE).select("*").eq("siparis_no",siparisNo).single();
    if(error) throw error;
    if(order?.kargo_durumu!=="Hazırlandı") throw new Error("Sipariş artık Hazırlandı durumunda değil. Listeyi yenileyin.");
    if(cargoEnvironment(order)==="test") throw new Error("Test gönderisi canlı bağlantıyla kargolanamaz.");
    button.textContent="Kargolanıyor…";
    await sendToCargo(Number(siparisNo));
  } catch(error){
    toast(error.message||"Sipariş kargolanamadı.",6000);
  } finally {
    button.disabled=false;
    button.textContent=label;
  }
}

async function directShipFromList(siparisNo, button){
  const id=Number(siparisNo);
  if(button.disabled||preparingOrders.has(id)||busy.kargola.has(id)||batchPreparing)return;
  const label=button.textContent;
  button.disabled=true;button.textContent="Kontrol ediliyor…";
  try{await sendToCargo(id,{prepareFirst:true});}
  finally{button.disabled=false;button.textContent=label;}
}

async function sendToCargo(orderId,{prepareFirst=false}={}){
  const siparisNo=Number(orderId ?? selectedOrder?.siparis_no);
  if(!siparisNo)return toast("Önce sipariş seçin.");
  if(busy.kargola.has(siparisNo))return toast("Kargolama sürüyor.");
  if(prepareFirst&&preparingOrders.has(siparisNo))return toast("Sipariş hazırlanıyor.");
  const ok=await confirmModal({title:prepareFirst?"Hazırla ve Kargola":"Siparişi Kargola",text:prepareFirst?"Sipariş önce Hazırlandı aşamasına alınacak, ardından mevcut DHL kargolama işlemi çalışacak. Etiketi Kargolandı sekmesinden ayrıca oluşturabilirsiniz. Devam edilsin mi?":"DHL sipariş kaydı oluşturulup Kargolandı aşamasına alınacak. Etiketi Kargolandı sekmesinden ayrıca oluşturabilirsiniz. Devam etmek istiyor musunuz?",confirmText:"Evet, Kargola",cancelText:"Vazgeç"});
  if(!ok||busy.kargola.has(siparisNo)||preparingOrders.has(siparisNo))return;
  busy.kargola.add(siparisNo);
  let preparedHere=false;
  if(prepareFirst)preparingOrders.add(siparisNo);
  try{
    if(prepareFirst){
      const {data:order,error:readError}=await db.from(TABLE).select("*").eq("siparis_no",siparisNo).single();
      if(readError)throw readError;
      if(!["Bekliyor","Hazırlandı"].includes(order?.kargo_durumu))throw new Error("Siparişin aşaması değişmiş. Listeyi yenileyin.");
      if(cargoEnvironment(order)==="test")throw new Error("Test gönderisi canlı bağlantıyla kargolanamaz.");
      if(order.teslim_sekli_kontrol===true)throw new Error("Önce siparişin teslim şeklini kontrol edin.");
      CargoWeights.parse(order.kargo_kg,order.kargo_adet);
      if(order.kargo_durumu==="Bekliyor"){
        const {data:updated,error}=await db.from(TABLE).update({kargo_durumu:"Hazırlandı"})
          .eq("siparis_no",siparisNo).eq("kargo_durumu","Bekliyor").select("siparis_no");
        if(error)throw error;
        if(!updated?.length)throw new Error("Siparişin aşaması değişmiş. Listeyi yenileyin.");
        preparedHere=true;
        try{
          const {error:reactionError}=await db.functions.invoke("whatsapp-reaction",{body:{siparis_no:siparisNo,emoji:"📦"}});
          if(reactionError)toast("Hazırlandı; WhatsApp emojisi gönderilemedi.",6000);
        }catch{toast("Hazırlandı; WhatsApp emojisi gönderilemedi.",6000);}
      }
    }
    const result=await cargoRequest(WH_KARGOLA,{operation:"kargola",siparis_no:String(siparisNo)});
    if(!result.already_created)db.functions.invoke("whatsapp-reaction",{body:{siparis_no:siparisNo,emoji:"🚚"}}).then(({error})=>{if(error)toast("Kargolandı; WhatsApp emojisi gönderilemedi.",6000);}).catch(()=>toast("WhatsApp emojisi gönderilemedi.",6000));
    toast(result.message||"Sipariş kargolandı. Etiketi ayrıca oluşturabilirsiniz.",6000);
    closeModal();setTab("kargolandi");
  }catch(error){toast((preparedHere?"Sipariş hazırlandı; kargolama tamamlanamadı: ":"")+error.message,10000);await loadOrders(true);}
  finally{busy.kargola.delete(siparisNo);if(prepareFirst)preparingOrders.delete(siparisNo);}
}

function cargoLabelButtonText(order){
  return hasCargoLabel(order)?`Etiket Yazdır · ${Math.max(0,Number(order?.etiket_yazdirma_sayisi)||0)} kez`:"Etiket Oluştur";
}
function updateCargoLabelButton(button,order){
  if(!button)return;
  button.textContent=cargoLabelButtonText(order);
  button.dataset.labelOperation=hasCargoLabel(order)?"print":"create";
  button.classList.toggle("cargo-label-print",hasCargoLabel(order));
  button.classList.toggle("cargo-label-create",!hasCargoLabel(order));
}
async function recordCargoLabelPrint(order){
  try{
    const {data,error}=await db.rpc("gazi_record_label_print",{p_siparis_no:Number(order.siparis_no)});
    if(error)throw error;
    if(!Number.isSafeInteger(data)||data<1)throw Error("Yazdırma sayacı doğrulanamadı");
    order.etiket_yazdirma_sayisi=data;
    void refreshOperationCounts();
    if(Number(selectedOrder?.siparis_no)===Number(order.siparis_no)){
      selectedOrder.etiket_yazdirma_sayisi=data;
      updateCargoLabelButton(document.getElementById("btnBarcode"),selectedOrder);
    }
    document.querySelectorAll('[data-label-print-count]').forEach(el=>{
      if(Number(el.dataset.labelPrintCount)===Number(order.siparis_no))el.textContent=`${data} kez yazdırma açıldı`;
    });
  }catch(error){
    console.error("Etiket yazdırma sayacı:",error);
    toast("Etiket açıldı, ancak yazdırma sayısı kaydedilemedi. "+(error.message||""),8000);
  }
}

function hasCargoLabel(order){
  return !!(String(order?.kargo_zpl||"").trim() || String(order?.zpl_base64||"").startsWith("JVBER"));
}

async function retryCargoLabel(siparisNo,button){
  const id=Number(siparisNo);
  if(!Number.isSafeInteger(id)||id<1||button.disabled)return;
  if(busy.kargola.has(id)||busy.barkod.has(id))return toast("Bu siparişin kargo işlemi sürüyor.");
  const operation=button.dataset.labelOperation||(/Yazdır/.test(button.textContent)?"print":"create");
  // Only an explicit Print click opens a window, synchronously for popup permission.
  const w=operation==="print"?window.open("","_blank"):null;
  if(operation==="print"&&!w)return toast("Etiket ekranı için açılır pencerelere izin verin.");
  if(w)w.document.body.textContent="Paket etiketi hazırlanıyor…";
  busy.kargola.add(id);busy.barkod.add(id);
  const label=button.textContent;button.disabled=true;button.textContent=operation==="create"?"Etiket oluşturuluyor…":"Yazdırma açılıyor…";
  let latestLabelOrder=null;
  try{
    const {data:order,error}=await db.from(TABLE).select("*").eq("siparis_no",id).single();
    if(error)throw error;
    if(!canPrintCargoLabel(order))throw new Error("Bu gönderi kargo hareketine geçmiş. Etiket işlemi kapatıldı.");
    if(operation==="create"&&hasCargoLabel(order)){
      toast("Etiket zaten oluşturulmuş. Etiket Yazdır butonunu kullanabilirsiniz.",6000);
      return;
    }
    if(operation==="print"&&!hasCargoLabel(order))throw new Error("Önce Etiket Oluştur işlemini tamamlayın.");
    if(operation==="create"&&!needsCargoLabelRetry(order))throw new Error("Siparişin durumu değişti. Liste yenileniyor.");
    const result=await cargoRequest(WH_BARKOD,{siparis_no:String(id),operation});
    if(operation==="create"){
      if(!result.label_saved&&!result.pdf_base64)throw new Error("Etiket yanıtı doğrulanamadı.");
      const {data:saved,error:saveError}=await db.from(TABLE).select("*").eq("siparis_no",id).single();
      if(saveError)throw saveError;
      if(!hasCargoLabel(saved))throw new Error("Etiket kaydı doğrulanamadı. Siparişin durumunu kontrol edin.");
      toast("Etiket oluşturuldu. Etiket Yazdır butonuyla açabilirsiniz.",6000);
    }else{
      if(!result.pdf_base64)throw new Error("Etiket PDF'si alınamadı. Etiket Yazdır ile tekrar deneyin.");
      await openCargoPdf(w,result.pdf_base64,order);
      toast((result.kargo_adet||order.kargo_adet||"")+" paket etiketi açıldı.",6000);
    }
  }catch(error){if(w&&!w.closed)w.close();toast(error.message||"Kargo etiketi hazırlanamadı.",10000);}
  finally{
    busy.kargola.delete(id);busy.barkod.delete(id);
    try{
      const {data,error}=await db.from(TABLE).select("*").eq("siparis_no",id).single();
      if(!error&&data){
        latestLabelOrder=data;
        if(selectedOrder?.siparis_no===id)selectedOrder={...selectedOrder,...data};
      }
    }catch(error){console.error("Etiket durumu yenilenemedi:",error);}
    button.disabled=false;
    if(latestLabelOrder)updateCargoLabelButton(button,latestLabelOrder);else button.textContent=label;
    const detailButton=document.getElementById("btnBarcode");
    if(selectedOrder?.siparis_no===id&&detailButton)updateCargoLabelButton(detailButton,selectedOrder);
    await loadOrders(true);
  }
}

const referenceLabelBusy = new Set();
async function printReferenceLabel(orderId){
  const id=Number(orderId ?? selectedOrder?.siparis_no);
  if(!isGaziAdmin||!Number.isSafeInteger(id)||id<1)return;
  if(referenceLabelBusy.has(id))return toast("Referans etiketi hazırlanıyor.");
  const ok=await confirmModal({title:"Referans Etiketi",text:id+" numaralı mevcut DHL gönderisinin referans etiketi açılacak. Bu çıktı referans barkodudur; normal kargo etiketinden ayrıdır.",confirmText:"Etiketi Aç"});
  if(!ok)return;
  const w=window.open("","_blank");if(!w)return toast("Etiket için açılır pencerelere izin verin.");
  w.document.body.textContent="Referans etiketi hazırlanıyor…";
  referenceLabelBusy.add(id);
  try{
    const result=await cargoRequest(CONFIG.webhooks.referans_etiketi,{siparis_no:String(id)});
    if(result.label_type!=="reference")throw new Error("Referans etiketi yanıtı doğrulanamadı.");
    const {data:labelOrder,error:labelOrderError}=await db.from(TABLE).select("siparis_no,ad_soyad").eq("siparis_no",id).single();
    if(labelOrderError)throw labelOrderError;
    await openCargoPdf(w,result.pdf_base64,labelOrder,{trackPrint:false});
    toast("Referans etiketi yazdırmaya hazır.",5000);
  }catch(error){if(!w.closed)w.close();toast(error.message||"Referans etiketi alınamadı.",8000);}
  finally{referenceLabelBusy.delete(id);}
}

async function printBarcode(){
  const id=selectedOrder?.siparis_no;if(!id)return toast("Önce sipariş seçin.");
  const button=document.getElementById("btnBarcode");
  await retryCargoLabel(id,button);
}

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

function canCancelShipment(order){
  // Fiş/etiket oluşturulmuş gönderiler bu geri alma işlemine uygun değildir.
  if(!isGaziAdmin || hasCargoLabel(order)
    || Number(order?.etiket_yazdirma_sayisi)>0
    || ["sending","sent","uncertain","historical"].includes(order?.sube_etiket_durumu)
    || !isCargoAwaitingHandover(order)
    || ![0,1].includes(Number(order?.shipmentStatusCode))
    || !(order?.orderinvoiceid||order?.kargo_takip_kodu)
    || cargoEnvironment(order)==="test")return false;
  const tracking=cargoTrackingData(order);
  const status=tracking.status||{};
  if(status.isDelivered===true || (Number(status.shipmentStatusCode)>1))return false;
  return !Array.isArray(tracking.movements) || !tracking.movements.some(m=>Number(m.eventSequence)>=2);
}
async function cancelShipmentToWaiting(orderId,button){
  const id=Number(orderId??selectedOrder?.siparis_no);
  if(!isGaziAdmin||!Number.isSafeInteger(id)||id<1||cancelBusy||busy.kargola.has(id)||busy.barkod.has(id))return;
  const ok=await confirmModal({title:"Gönderi İptal",text:"Fişi henüz oluşturulmamış bu gönderi DHL üzerinden iptal edilecek. DHL onayladığında sipariş Bekleyen aşamasına alınacak ve yeniden düzenlenebilecek. Devam edilsin mi?",confirmText:"Evet, Gönderi İptal",cancelText:"Vazgeç"});
  if(!ok||cancelBusy||busy.kargola.has(id)||busy.barkod.has(id))return;
  cancelBusy=true;busy.kargola.add(id);busy.barkod.add(id);
  const label=button?.textContent;
  if(button){button.disabled=true;button.textContent="İptal ediliyor…";}
  try{
    const {data:order,error}=await db.from(TABLE).select("*").eq("siparis_no",id).single();
    if(error)throw error;
    if(!canCancelShipment(order))throw new Error("Yalnızca fiş/etiket oluşturulmamış ve DHL teslim alımı bekleyen gönderiler iptal edilebilir.");
    const result=await cargoRequest(CONFIG.webhooks.iptal,{operation:"gonderi_iptal",siparis_no:String(id),reason:"Kargo gönderisi iptal edilerek sipariş yeniden hazırlamak üzere Bekleyen aşamasına alınıyor."});
    if(result.cancelled!==true||result.recordVerified!==true||result.kargo_durumu!=="Bekliyor")throw new Error("İptal ve Bekleyen kaydı doğrulanamadı. Siparişin durumunu kontrol edin.");
    toast(result.message||"Gönderi iptal edildi; sipariş Bekleyen aşamasına alındı.",7000);
    closeModal();setTab("bekleyen");
  }catch(error){toast(error.message||"Gönderi iptali tamamlanamadı.",10000);await loadOrders(true);}
  finally{cancelBusy=false;busy.kargola.delete(id);busy.barkod.delete(id);if(button){button.disabled=false;button.textContent=label;}}
}

let cancelBusy=false;
async function confirmCancel(){
  if(cancelBusy)return;
  const reason=document.getElementById("iptalInput").value.trim();if(!reason)return toast("İptal nedeni gerekli");
  const id=selectedOrder?.siparis_no;if(!id)return;
  cancelBusy=true;
  try{
    const {data:order,error}=await db.from(TABLE).select("*").eq("siparis_no",id).single();if(error)throw error;
    if(hasExistingShipment(order) && cargoEnvironment(order)==="test")throw new Error("Test gönderisi canlı bağlantıyla iptal edilemez.");
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
function customerNameSearchPattern(input){
  const raw=String(input||'').trim().toLocaleLowerCase('tr-TR');
  // Name matching only: accents are equivalent; one vowel typo is tolerated in longer names.
  const groups={c:'[cç]',ç:'[cç]',g:'[gğ]',ğ:'[gğ]',o:'[oö]',ö:'[oö]',s:'[sş]',ş:'[sş]',u:'[uü]',ü:'[uü]',i:'[iıİI]',ı:'[iıİI]'};
  const chars=Array.from(raw);
  const escaped=chars.map(c=>groups[c]||(/^[a-z0-9 ]$/.test(c)?c:'\\'+c));
  const patterns=[escaped.join('')];
  if(chars.filter(c=>/[a-zçğıöşü]/.test(c)).length>=5){
    chars.forEach((c,index)=>{if(/[aeıioöuü]/.test(c)){const variant=[...escaped];variant[index]='[aeıiİIoöuü]';patterns.push(variant.join(''));}});
  }
  return '(?:'+patterns.join('|')+')';
}

function buildOrderSearchFilter(input) {
  const raw = input.trim();
  const pattern = value => JSON.stringify("%" + value.replace(/[\\%_]/g, character => "\\" + character) + "%");
  const text = pattern(raw);
  const filters = ["ad_soyad", "adres", "kargo_takip_kodu", "iade_kodu"]
    .map(column => column + ".ilike." + text);
  if(/[a-zçğıöşüİ]/i.test(raw))filters.push('ad_soyad.imatch.'+JSON.stringify(customerNameSearchPattern(raw)));
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


function searchActiveOrders() {
  const inTab = !!document.getElementById("tabSearchInput").value.trim();
  return searchOrders(inTab ? "tab" : "all");
}

// Keep the single search button's scope tied to the field being edited.
document.addEventListener("input", (event) => {
  const id = event.target?.id;
  if (!["searchInput", "tabSearchInput"].includes(id)) return;
  document.getElementById(id === "searchInput" ? "tabSearchInput" : "searchInput").value = "";
});

async function searchOrders(scope = "all", append=false) {
  syncCargoTools();
  const inTab = scope === "tab";
  const inputId = inTab ? "tabSearchInput" : "searchInput";
  document.getElementById(inTab ? "searchInput" : "tabSearchInput").value = "";
  const raw = document.getElementById(inputId).value.trim();
  if (!raw) return loadOrders(true);
  if(!append)currentPage=1;
  const request = ++listRequest;
  listLoading=true;
  const loadButton=document.getElementById("loadMoreBtn");
  if(loadButton){loadButton.disabled=true;loadButton.textContent="Yükleniyor…";}
  updateListHeading(!inTab, "Aranıyor…");
  try {
    let query = db.from(LIST_TABLE).select("*",{count:"exact"})
      .or("kargo_durumu.is.null,kargo_durumu.neq.Silindi");
    if (inTab) query = applyCargoFilter(applyTabFilter(query));
    const start=(currentPage-1)*PAGE_SIZE;
    const { data, error, count } = await query.or(buildOrderSearchFilter(raw))
      .order("siparis_no", { ascending: inTab && currentTab === "bekleyen" }).range(start,start+PAGE_SIZE-1);
    if (request !== listRequest) return;
    if (error) throw error;
    renderTableHeader();
    const matches = data || [];
    markExtras(matches);
    const hasMore=typeof count==="number"?count>currentPage*PAGE_SIZE:matches.length===PAGE_SIZE;
    renderTable(matches, { append, hasMore });
    void hydrateExtras(matches,()=>document.getElementById("ordersBody")?.isConnected!==false,document.getElementById("ordersBody"));
    const shown=document.getElementById("ordersBody").querySelectorAll('tr[data-order-id]').length;
    updateListHeading(!inTab, `${shown} kayıt gösteriliyor · ${count ?? shown} sonuç · ${inTab ? "Bu sekmede arama" : "Tüm siparişlerde arama"}`);
  } catch (error) {
    if (request !== listRequest) return;
    if(append)currentPage=Math.max(1,currentPage-1);
    updateListHeading(!inTab, "Arama tamamlanamadı. Yeniden deneyin.");
    toast("Arama yapılırken bir hata oluştu!");
  } finally {
    if(request===listRequest){listLoading=false;if(loadButton){loadButton.disabled=false;loadButton.textContent="Daha Fazla";}}
  }
}

function clearSearch(){
  document.getElementById("searchInput").value="";
  document.getElementById("tabSearchInput").value="";
  loadOrders(true);
}

/* ============================================================
   TAB / LOAD MORE / MOBİL MENÜ
============================================================ */
function updateListHeading(search, summary) {
  const titles = {bekleyen:"Bekleyen Siparişler", hazirlandi:"Hazırlanan Siparişler", kargolandi:"Kargolanan Siparişler", tamamlandi:"Tamamlanan Siparişler", iade:"İade Siparişleri", sorunlu:"Sorunlu Siparişler", iptal:"İptal Edilen Siparişler"};
  const title = document.getElementById("pageTitle");
  const info = document.getElementById("listSummary");
  if (title) title.textContent = search ? "Arama Sonuçları" : (OPERATION_CARDS[operationFilter]?.title || titles[currentTab]);
  if (info) info.textContent = summary;
}

function setTab(tab, operation=""){
  operationFilter=OPERATION_CARDS[operation]?.tab===tab ? operation : "";
  document.querySelectorAll("[data-operation]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.operation===operationFilter)));
  document.getElementById("searchInput").value = "";
  document.getElementById("tabSearchInput").value = "";
  currentTab = tab;
  cargoFilter = tab === "kargolandi" ? "created" : "all";
  document.querySelectorAll(".menu li:not(.menu-more)").forEach(li=>li.classList.remove("active"));
  const el = document.getElementById(`tab_${tab}`);
  if(el) el.classList.add("active");
  loadOrders(true);
}

function loadMore(){
  if(listLoading)return;
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
      <div><b>KG:</b> ${escapeHtml(CargoWeights.display(order.kargo_kg,order.kargo_adet) || "—")}</div>
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
  if (["searchInput", "tabSearchInput"].includes(event.target?.id) && event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    searchOrders(event.target.id === "tabSearchInput" ? "tab" : "all");
  }
});

/* ============================================================
   GLOBAL EXPORT
============================================================ */
Object.assign(window, {
  logout,
  openOrderTakerSettings,
  loadOrders,
   loadMore,
  setTab,
  searchOrders,
  searchActiveOrders,
  clearSearch,
  toggleMenu,

  openOrder,
  closeModal,

  openTrackingUrl,
  showErrorDetail,

  setWaiting,
  markPrepared,
  sendToCargo,
  shipPreparedFromList,
  directShipFromList,
  printBarcode,
  printReferenceLabel,
  retryCargoLabel,
  createReturnLabel,
  connectCargo,
  refreshCargoMovements,
  refreshSelectedCargoMovements,

  enterEditMode,
  saveEdit,
  cancelEdit,

  openCancelForm,
  cancelCancelForm,
  confirmCancel,
  cancelShipmentToWaiting,
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
document.querySelectorAll(".menu li:not(.menu-more)").forEach(item => {
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); item.click(); }
  });
});

document.getElementById("takerSettingsMenu").hidden = !isGaziAdmin;
try { await loadOrderTakerNames(); } catch { toast("Kişi isimleri yüklenemedi. Sayfayı yenileyin."); }

const requestedTab = new URLSearchParams(location.search).get("tab");
if (["bekleyen","hazirlandi","kargolandi","tamamlandi","iade","sorunlu","iptal"].includes(requestedTab)) {
  currentTab = requestedTab;
  document.querySelectorAll(".menu li:not(.menu-more)").forEach(item => item.classList.toggle("active", item.id === "tab_" + currentTab));
}














// Refresh visible dashboards once a minute; no background polling.
setInterval(()=>{if(!document.hidden)void refreshOperationCounts();},60000);

(async()=>{const {data}=await db.auth.getUser();if(data?.user?.app_metadata?.firma!=="gazi"||data.user.app_metadata?.role==="seller")return;const b=document.createElement("button");b.type="button";b.className="btn-mini";b.textContent="Eşleşmeyen dekontlar";b.onclick=()=>OrderReceipts.unmatched(db);document.querySelector(".page-header-actions")?.append(b);})();
