(function () {
  'use strict';
  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function date(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    return match ? match[3] + '.' + match[2] + '.' + match[1] : 'Tarih yok';
  }
  async function load(db, rows) {
    if (!rows || !rows.length) return;
    rows.forEach(function (o) { delete o.customer_order_history; });
    var ids = rows.map(function (o) { return Number(o.siparis_no); }).filter(function (n) { return Number.isSafeInteger(n) && n > 0; });
    for (var start = 0; start < ids.length; start += 100) {
      try {
        var result = await db.rpc('gazi_customer_order_history', {p_order_ids: ids.slice(start, start + 100)});
        if (result.error) throw result.error;
        var histories = result.data || {};
        rows.forEach(function (o) {
          if (histories[String(o.siparis_no)]) o.customer_order_history = histories[String(o.siparis_no)];
        });
      } catch (error) {
        console.warn('Müşteri sipariş geçmişi alınamadı', error.message);
      }
    }
  }
  function markup(order) {
    var history = order.customer_order_history;
    if (!history || !Number.isInteger(history.ordinal) || !Array.isArray(history.orders)) {
      return '<span class="customer-history-unavailable">Sipariş geçmişi alınamadı</span>';
    }
    var current = Number(order.siparis_no);
    return '<details class="customer-order-history"><summary><span><strong>' + history.ordinal + '. siparişi</strong><small>Toplam ' + Number(history.total) + ' sipariş</small></span><span class="customer-history-arrow" aria-hidden="true"></span></summary><div class="customer-history-list" aria-label="Müşterinin siparişleri">' + history.orders.map(function (item) {
      var id = Number(item.siparis_no);
      if (!Number.isSafeInteger(id) || id <= 0) return '';
      return '<button type="button" data-customer-order="' + id + '"' + (id === current ? ' aria-current="true"' : '') + ' aria-label="' + id + ' numaralı siparişi aç, ' + escape(date(item.tarih)) + '"><span>#' + id + (id === current ? '<small>Bu sipariş</small>' : '') + '</span><time>' + escape(date(item.tarih)) + '</time></button>';
    }).join('') + '</div></details>';
  }
  function bind(openOrder) {
    document.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-customer-order]');
      if (!button) return;
      event.stopPropagation();
      openOrder(Number(button.getAttribute('data-customer-order')));
    }, true);
  }
  window.CustomerOrderHistory = {load: load, markup: markup, bind: bind};
})();
