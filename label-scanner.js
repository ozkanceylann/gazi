// Barcode decoding stays on the phone. Only the decoded number is queried.
export function normalizeLabelCode(input) {
  let code = String(input || '').trim();
  if (/^https?:\/\//i.test(code)) {
    const url = new URL(code);
    if (!/(^|\.)(dhlecommerce\.com\.tr|mngkargo\.com\.tr)$/.test(url.hostname))
      throw new Error('Kargo barkodunu veya sipariş numarasını girin.');
    code = url.searchParams.get('takipNo') || url.searchParams.get('shipmentId') || '';
  }
  code = code.trim().toUpperCase();
  if (!/^[A-Z0-9@._\/-]{1,100}$/.test(code))
    throw new Error('Geçerli bir barkod veya sipariş numarası girin.');
  return code;
}

function apiHasCode(raw, code) {
  let data;
  try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return false; }
  const visit = value => {
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, item]) =>
      (['barcode', 'referenceId', 'shipmentId'].includes(key) && String(item).toUpperCase() === code)
      || (typeof item === 'object' && visit(item)));
  };
  return visit(data);
}

export async function findLabelOrders(db, table, input) {
  const code = normalizeLabelCode(input);
  const fields = ['kargo_takip_kodu', 'kargo_siparis_no', 'orderinvoiceid', 'orderinvoicedetailid', 'invoiceid'];
  const references = [code];
  // A reference label may add the parcel number, e.g. AKH452009615-2.
  if (/^[A-Z][A-Z0-9]*-\d+$/.test(code)) references.push(code.replace(/-\d+$/, ''));
  const filters = fields.flatMap(field => references.map(ref => `${field}.eq.${JSON.stringify(ref)}`));
  if (/^\d+$/.test(code) && Number(code) > 0 && Number(code) <= 2147483647)
    filters.push('siparis_no.eq.' + Number(code));
  const select = 'siparis_no,ad_soyad,sehir,ilce,kargo_durumu,kargo_api_yanit';
  const active = query => query.or('kargo_durumu.is.null,kargo_durumu.neq.Silindi');
  const escaped = code.replace(/[\\%_]/g, character => '\\' + character);
  const [direct, parcels] = await Promise.all([
    active(db.from(table).select(select)).or(filters.join(',')).limit(21),
    active(db.from(table).select(select)).ilike('kargo_api_yanit', '%' + escaped + '%').limit(21)
  ]);
  if (direct.error || parcels.error) throw new Error('Sipariş aranamadı. Bağlantınızı kontrol edip tekrar deneyin.');
  if (direct.data.length > 20 || parcels.data.length > 20)
    throw new Error('Çok fazla eşleşme var. Etiketteki tam barkodu okutun veya tam numarayı girin.');
  const matches = [...direct.data, ...parcels.data.filter(order => apiHasCode(order.kargo_api_yanit, code))];
  return [...new Map(matches.map(order => [order.siparis_no, order])).values()];
}

let decoderPromise;
function loadDecoder() {
  if (window.ZXingBrowser) return Promise.resolve(window.ZXingBrowser);
  if (!decoderPromise) decoderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => { clearTimeout(timer); script.remove(); reject(new Error('Barkod okuyucu yüklenemedi. Elle numara girebilirsiniz.')); };
    const timer = setTimeout(fail, 15000);
    script.src = './vendor/zxing-browser-0.1.5.min.js';
    script.onload = () => { clearTimeout(timer); window.ZXingBrowser ? resolve(window.ZXingBrowser) : fail(); };
    script.onerror = fail;
    document.head.append(script);
  }).catch(error => { decoderPromise = null; throw error; });
  return decoderPromise;
}

export function installLabelScanner({ db, table, openOrder, toast }) {
  const launch = document.getElementById('scanLabelBtn');
  if (!launch) return;
  let current = null;
  launch.disabled = false;
  launch.addEventListener('click', () => {
    if (current) return;
    const wrap = document.createElement('div');
    wrap.className = 'label-scan-backdrop';
    wrap.innerHTML = `<section class="label-scan-card" role="dialog" aria-modal="true" aria-labelledby="labelScanTitle">
      <div class="label-scan-heading"><h2 id="labelScanTitle">Etiket Okut</h2><button type="button" class="label-scan-close" aria-label="Okuyucuyu kapat">✕</button></div>
      <p class="label-scan-help">Etiketteki barkodu kameraya gösterin. Sipariş bulunduğunda detayları açılır.</p>
      <div class="label-scan-preview"><video muted autoplay playsinline aria-label="Barkod kamera görüntüsü"></video><div class="label-scan-guide" aria-hidden="true"></div></div>
      <p class="label-scan-status" role="status" aria-live="polite">Kamera açılıyor…</p>
      <div class="label-scan-controls"><button type="button" class="btn-secondary" data-retry>Tekrar Okut</button><button type="button" class="btn-secondary" data-torch hidden>Işığı Aç</button></div>
      <form class="label-scan-form"><label for="labelScanInput">Barkod / takip / sipariş numarası</label><div><input id="labelScanInput" autocomplete="off" autocapitalize="characters" enterkeyhint="search" placeholder="Numarayı elle girin" maxlength="100" required><button type="submit" class="btn-primary">Siparişi Aç</button></div></form>
      <div class="label-scan-results"></div>
    </section>`;
    document.body.append(wrap);
    const video = wrap.querySelector('video'), status = wrap.querySelector('.label-scan-status');
    const results = wrap.querySelector('.label-scan-results'), input = wrap.querySelector('input');
    const retry = wrap.querySelector('[data-retry]'), torch = wrap.querySelector('[data-torch]');
    const submit = wrap.querySelector('[type="submit"]'), closeButton = wrap.querySelector('.label-scan-close');
    const events = new AbortController();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const state = current = { closed: false, epoch: 0, stream: null, controls: null, busy: false, torchOn: false };
    function stopCamera() {
      state.epoch++;
      try { Promise.resolve(state.controls?.stop()).catch(() => {}); } catch {}
      state.controls = null;
      state.stream?.getTracks().forEach(track => track.stop());
      state.stream = null;
      video.srcObject = null;
      torch.hidden = true;
      state.torchOn = false;
    }
    function close() {
      if (state.closed) return;
      state.closed = true;
      stopCamera();
      events.abort();
      wrap.remove();
      current = null;
      document.body.style.overflow = oldOverflow;
      launch.focus();
    }
    async function showOrder(order) {
      close();
      await openOrder(order.siparis_no);
    }
    async function lookup(raw) {
      if (state.busy || state.closed) return;
      state.busy = true;
      stopCamera();
      submit.disabled = retry.disabled = true;
      results.replaceChildren();
      status.textContent = 'Sipariş aranıyor…';
      try {
        const orders = await findLabelOrders(db, table, raw);
        if (state.closed) return;
        if (!orders.length) { status.textContent = 'Bu barkodla sipariş bulunamadı. Diğer barkodu okutun veya sipariş numarasını girin.'; return; }
        if (orders.length === 1) {
          if (navigator.vibrate) navigator.vibrate(80);
          await showOrder(orders[0]);
          return;
        }
        status.textContent = 'Birden fazla sipariş eşleşti. Açmak istediğiniz siparişi seçin.';
        for (const order of orders) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'label-scan-choice';
          button.textContent = `#${order.siparis_no} · ${order.ad_soyad || 'İsimsiz'} · ${order.sehir || ''} / ${order.ilce || ''} · ${order.kargo_durumu || 'Bekliyor'}`;
          button.onclick = () => showOrder(order).catch(error => toast(error.message));
          results.append(button);
        }
      } catch (error) { if (!state.closed) status.textContent = error.message; }
      finally { state.busy = false; submit.disabled = retry.disabled = false; }
    }
    async function startCamera() {
      if (state.closed || state.busy) return;
      stopCamera();
      const epoch = state.epoch;
      results.replaceChildren();
      retry.disabled = true;
      status.textContent = 'Kamera açılıyor…';
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
          throw new Error('Bu tarayıcıda kamera açılamıyor. HTTPS üzerinden Chrome veya Safari ile açın; elle numara da girebilirsiniz.');
        const ZXing = await loadDecoder();
        if (state.closed || epoch !== state.epoch) return;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
        if (state.closed || epoch !== state.epoch) { stream.getTracks().forEach(track => track.stop()); return; }
        state.stream = stream;
        const reader = new ZXing.BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 200, delayBetweenScanSuccess: 1000 });
        const controls = await reader.decodeFromStream(stream, video, result => {
          if (result && !state.closed && epoch === state.epoch && !state.busy) {
            input.value = result.getText();
            lookup(input.value);
          }
        });
        if (state.closed || epoch !== state.epoch) { controls.stop(); return; }
        state.controls = controls;
        torch.hidden = typeof controls.switchTorch !== 'function';
        status.textContent = 'Barkodu çerçevenin içine alın. Netleşmesi için telefonu biraz uzaklaştırın.';
      } catch (error) {
        if (state.closed || epoch !== state.epoch) return;
        stopCamera();
        const messages = { NotAllowedError: 'Kamera izni verilmedi. Tarayıcı ayarlarından izin verip tekrar deneyin veya numarayı elle girin.', NotFoundError: 'Kamera bulunamadı. Numarayı elle girebilirsiniz.', NotReadableError: 'Kamera başka bir uygulamada açık olabilir. Kapatıp tekrar deneyin.' };
        status.textContent = messages[error.name] || error.message || 'Kamera açılamadı. Numarayı elle girebilirsiniz.';
      } finally { if (!state.closed && (epoch === state.epoch || !state.stream)) retry.disabled = false; }
    }
    closeButton.onclick = close;
    wrap.addEventListener('click', event => { if (event.target === wrap) close(); });
    retry.onclick = startCamera;
    wrap.querySelector('form').onsubmit = event => { event.preventDefault(); lookup(input.value); };
    torch.onclick = async () => {
      const controls = state.controls;
      try { await controls?.switchTorch(!state.torchOn); state.torchOn = !state.torchOn; torch.textContent = state.torchOn ? 'Işığı Kapat' : 'Işığı Aç'; }
      catch { status.textContent = 'Bu kamerada ışık açılamadı.'; }
    };
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const focusable = [...wrap.querySelectorAll('button,input')].filter(element => !element.disabled && !element.hidden);
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }, { signal: events.signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) close(); }, { signal: events.signal });
    window.addEventListener('pagehide', close, { signal: events.signal });
    closeButton.focus();
    startCamera();
  });
}
