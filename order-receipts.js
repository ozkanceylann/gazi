/* Shared by Mobil Takip and Gazi Sipariş. Files remain private. */
const OrderReceipts=(()=>{
 const OPERATIONS=true;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const required=o=>/\b(eft|iban|havale|fast)\b/i.test(String(o.odeme_sekli||'')+' '+String(o.notlar||''));
 const states={pending:'🟡 Kontrol bekliyor',approved:'✅ Onaylandı',rejected:'🔴 Kontrol gerekli'};
 async function load(db,orders){
 for(const o of orders)o.receipts=undefined;
 const ids=orders.map(o=>Number(o.siparis_no)).filter(Number.isSafeInteger);if(!ids.length)return;
 try{
 let all=[];for(let i=0;i<ids.length;i+=100){const {data,error}=await db.from('order_receipts').select('id,order_id,status').in('order_id',ids.slice(i,i+100));if(error)throw error;all.push(...data);}
 for(const o of orders)o.receipts=all.filter(r=>r.order_id===Number(o.siparis_no));
 }catch{for(const o of orders)o.receiptError=true;}
 }
 function badge(o){
 if(!required(o)&&!o.receipts?.length)return '';
 if(!Array.isArray(o.receipts))return '<span class="receipt-badge">Dekont durumu alınamadı</span>';
 const state=!o.receipts.length?'⚠️ Dekont eksik':o.receipts.some(r=>r.status==='rejected')?states.rejected:o.receipts.some(r=>r.status==='pending')?states.pending:states.approved;
 return `<span class="receipt-badge" title="${esc(state)}">${esc(state)}</span>`;
 }
 function markup(o){return `<section class="receipt-panel" data-receipt-panel="${Number(o.siparis_no)}"><h3>Ödeme belgeleri</h3><p>${badge(o)}</p><div data-receipt-list role="status">Belgeler yükleniyor…</div>${required(o)&&!OPERATIONS?'<label class="receipt-upload">Belge yükle<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" data-receipt-upload></label><p class="receipt-hint">PDF, JPG, PNG veya WEBP · En fazla 10 MB. Belge eklemek ödemeyi otomatik onaylamaz.</p>':''}<p data-receipt-message role="status"></p></section>`;}
 async function invoke(db,body){const {data,error}=await db.functions.invoke('order-receipts',{body});if(error){let message=error.message;try{message=(await error.context.json()).error||message;}catch{}throw Error(message);}if(data?.error)throw Error(data.error);return data;}
 async function open(db,r){const {data,error}=await db.storage.from('order-receipts').createSignedUrl(r.object_path,120);if(error)throw error;const u=new URL(data.signedUrl);if(u.protocol!=='https:')throw Error('Belge bağlantısı geçersiz');const a=document.createElement('a');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';a.click();}
 async function mount(db,o,root,onChange=()=>{}){
 const panel=root.querySelector(`[data-receipt-panel="${Number(o.siparis_no)}"]`);if(!panel)return;
 const message=panel.querySelector('[data-receipt-message]');
 const {data:auth}=await db.auth.getUser();const isAdmin=OPERATIONS&&auth?.user?.app_metadata?.firma==='gazi'&&auth.user.app_metadata?.role!=='seller';
 async function refresh(){
 const {data,error}=await db.from('order_receipts').select('*').eq('order_id',Number(o.siparis_no)).order('created_at',{ascending:false});
 if(!panel.isConnected)return;
 if(error){panel.querySelector('[data-receipt-list]').textContent='Belgeler alınamadı. Siparişi yeniden açın.';return;}
 o.receipts=data;panel.querySelector('p').innerHTML=badge(o);
 const list=panel.querySelector('[data-receipt-list]');list.innerHTML=data.map(r=>`<article class="receipt-item"><strong>${esc(r.file_name)}</strong><small>${esc(new Date(r.created_at).toLocaleString('tr-TR'))} · ${r.source==='whatsapp'?'WhatsApp':'Panel'} · ${esc(states[r.status])}</small><div><button type="button" data-receipt-open="${r.id}">Dekontu aç</button>${isAdmin?`<button type="button" data-receipt-review="${r.id}" data-status="approved">Onayla</button><button type="button" data-receipt-review="${r.id}" data-status="rejected">Kontrol gerekli</button>`:''}</div></article>`).join('')||'<p>Henüz dekont eklenmemiş.</p>';
 list.onclick=async e=>{const b=e.target.closest('button');if(!b)return;e.stopPropagation();b.disabled=true;message.textContent='';try{const r=data.find(r=>r.id===(b.dataset.receiptOpen||b.dataset.receiptReview));if(b.dataset.receiptOpen)await open(db,r);else{await invoke(db,{action:'review',receipt_id:r.id,status:b.dataset.status});await refresh();await onChange();}}catch(err){message.textContent=err.message;}finally{b.disabled=false;}};
 }
 const input=panel.querySelector('[data-receipt-upload]');if(input)input.onchange=async()=>{
 const file=input.files?.[0];if(!file)return;message.textContent='';if(file.size>10*1024*1024){message.textContent='Dosya en fazla 10 MB olabilir.';input.value='';return;}
 input.disabled=true;message.textContent='Belge yükleniyor…';
 try{const body=new FormData();body.set('order_id',String(o.siparis_no));body.set('file',file);await invoke(db,body);await refresh();message.textContent='Belge eklendi. Kontrol bekliyor.';await onChange();}catch(err){message.textContent=err.message;}finally{input.disabled=false;input.value='';}
 };
 await refresh();
 }
 async function unmatched(db){
 let dialog=document.getElementById('receipt-inbox');if(dialog)dialog.remove();dialog=document.createElement('dialog');dialog.id='receipt-inbox';dialog.className='receipt-inbox';document.body.append(dialog);
 dialog.innerHTML='<h2>Eşleştirme bekleyen dekontlar</h2><p>Yalnızca doğruladığınız siparişe bağlayın.</p><div data-inbox-list>Yükleniyor…</div><button type="button" data-inbox-close>Kapat</button><p data-inbox-message role="status"></p>';dialog.querySelector('[data-inbox-close]').onclick=()=>dialog.close();dialog.showModal();
 const message=dialog.querySelector('[data-inbox-message]');
 async function refresh(){const {data,error}=await db.from('order_receipts').select('*').is('order_id',null).order('created_at',{ascending:false}).limit(100);if(error)throw error;dialog.querySelector('[data-inbox-list]').innerHTML=data.map(r=>`<article class="receipt-item"><strong>${esc(r.file_name)}</strong><small>${esc(r.sender_phone)} · ${esc(new Date(r.created_at).toLocaleString('tr-TR'))}</small><p>${esc(r.caption||'Açıklama yok')}</p><button type="button" data-inbox-open="${r.id}">Dekontu aç</button><label>Sipariş no <input type="number" min="1" inputmode="numeric" data-inbox-order="${r.id}"></label><button type="button" data-inbox-assign="${r.id}">Siparişe bağla</button></article>`).join('')||'<p>Eşleştirme bekleyen dekont yok.</p>';
 dialog.querySelector('[data-inbox-list]').onclick=async e=>{const b=e.target.closest('button');if(!b)return;b.disabled=true;try{const r=data.find(r=>r.id===(b.dataset.inboxOpen||b.dataset.inboxAssign));if(b.dataset.inboxOpen)await open(db,r);else{const id=Number(dialog.querySelector(`[data-inbox-order="${r.id}"]`).value);const {data:o,error}=await db.from('gazi_siparisler').select('siparis_no,ad_soyad,musteri_tel,tarih').eq('siparis_no',id).single();if(error)throw Error('Sipariş bulunamadı');if(!confirm(`#${o.siparis_no} · ${o.ad_soyad} · ${o.musteri_tel}\nBu dekont bu müşterinin siparişine bağlansın mı?`))return;await invoke(db,{action:'assign',receipt_id:r.id,order_id:id});await refresh();message.textContent='Dekont siparişe bağlandı.';}}catch(err){message.textContent=err.message;}finally{b.disabled=false;}};
 }try{await refresh();}catch(err){message.textContent=err.message;}
 }
 return {required,load,badge,markup,mount,unmatched};
})();
