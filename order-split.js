(function(root){
  'use strict';
  const LIMIT=15000;
  let config,dialog,busy=false,opening=false;
  function amount(value){
    let s=String(value??'').replace(/(?:TL|TRY|₺)/gi,'').replace(/\s/g,'');
    if(/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(s))s=s.replace(/\./g,'').replace(',','.');
    else if(!/^\d+(?:\.\d{1,2})?$/.test(s))return NaN;
    const n=Number(s);return Number.isFinite(n)?n:NaN;
  }
  function formatAmount(value,grouping=true){
    const n=amount(value);
    return Number.isFinite(n)?n.toLocaleString('tr-TR',{useGrouping:grouping,minimumFractionDigits:Number.isInteger(n)?0:2,maximumFractionDigits:2}):String(value??'—');
  }
  const cents=value=>Math.round(amount(value)*100);
  function products(value){
    let s=String(value??'');
    if(s.trim().startsWith('[')){try{const a=JSON.parse(s);if(!Array.isArray(a))throw Error();s=a.join('\n');}catch{throw Error('Ürün listesi okunamadı. Siparişi düzenleyin.');}}
    return s.replace(/\\n/g,'\n').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  }
  function weights(kg,count){
    count=Number(count);
    if(!Number.isInteger(count)||count<1||count>50)throw Error('Paket adedi 1–50 olmalı.');
    const parsed=root.CargoWeights.parse(kg,count);
    if(parsed.some(x=>Math.abs(x*1000-Math.round(x*1000))>1e-7))throw Error('Kilogram en fazla üç ondalık hane içerebilir.');
    return parsed;
  }
  function expected(o){return Object.fromEntries(['urun_bilgisi','toplam_tutar','kargo_adet','kargo_kg','kargo_durumu'].map(k=>[k,o[k]??null]));}
  const over=o=>amount(o.toplam_tutar)>LIMIT;
  function blocked(o){
    if(o.bolunme_grubu)return 'Bu sipariş zaten bölünmüş.';
    if(!['Bekliyor','Hazırlandı'].includes(o.kargo_durumu)||o.isDelivered||Number(o.shipmentStatusCode)>0||o.orderinvoiceid||o.kargo_takip_kodu||o.kargo_zpl||o.zpl_base64||['sending','sent','uncertain','historical'].includes(o.sube_etiket_durumu))return 'Aktif kargo veya etiket var. Önce DHL gönderisini iptal edip Bekleyen durumuna alın.';
    if(amount(o.toplam_tutar)>30000)return 'İki kayıt toplam en fazla 30.000 TL olabilir. Bu sipariş için ikiden fazla gönderi gerekli.';
    return '';
  }
  function validate(o,parts){
    if(!over(o))throw Error('Sipariş 15.000 TL üzerinde olmalı.');
    const reason=blocked(o);if(reason)throw Error(reason);
    const lines=products(o.urun_bilgisi),seen=new Set();
    if(parts.length!==2)throw Error('İki kayıt gerekli.');
    let money=0,grams=0;
    for(const p of parts){
      const price=cents(p.amount);
      if(!Number.isFinite(price)||price<=0||price>LIMIT*100)throw Error('Her kaydın tutarı 0 üzeri ve en fazla 15.000 TL olmalı.');
      money+=price;
      if(!p.products.length)throw Error('İki kayıt için de ürün seçin.');
      for(const i of p.products){if(!Number.isInteger(i)||i<0||i>=lines.length||seen.has(i))throw Error('Her ürün yalnızca bir kayda atanmalı.');seen.add(i);}
      grams+=weights(p.kg,p.count).reduce((sum,n)=>sum+Math.round(n*1000),0);
    }
    if(seen.size!==lines.length)throw Error('Tüm ürünleri bir kayda atayın.');
    if(money!==cents(o.toplam_tutar))throw Error('İki tutarın toplamı mevcut sipariş tutarına eşit olmalı.');
    const originalGrams=weights(o.kargo_kg,o.kargo_adet).reduce((sum,n)=>sum+Math.round(n*1000),0);
    if(grams!==originalGrams)throw Error('Toplam kilogram mevcut siparişle aynı olmalı.');
    return parts;
  }
  function button(o){return config?.isAdmin&&over(o)?`<button type="button" class="order-split-button" onclick="event.stopPropagation();OrderSplit.open(${Number(o.siparis_no)})">Siparişi böl</button>`:'';}
  function related(o){return o.bolunme_ana_siparis_no?`<small class="order-split-related"><span class="order-split-reference">#${Number(o.bolunme_ana_siparis_no)} · ${Number(o.bolunme_sira)}/2</span></small>`:'';}
  const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
  function field(parent,label,id,value,mode='decimal'){
    const wrap=el('label',undefined,'split-field');wrap.append(el('span',label));
    const input=el('input');input.id=id;input.value=value;input.inputMode=mode;input.required=true;wrap.append(input);parent.append(wrap);return input;
  }
  async function open(id){
    if(!config?.isAdmin||busy||opening)return;
    opening=true;
    try{
      const {data:o,error}=await config.db.from(config.table).select('*').eq('siparis_no',id).single();
      if(error)throw error;
      const reason=blocked(o);if(reason)throw Error(reason);
      if(!over(o))throw Error('Sipariş 15.000 TL üzerinde olmalı.');
      const lines=products(o.urun_bilgisi);if(lines.length<2)throw Error('Ürünleri iki kayda ayırabilmek için önce siparişte ayrı satırlara yazın.');
      const oldWeights=weights(o.kargo_kg,o.kargo_adet),half=Math.ceil(oldWeights.length/2);
      let groups=[oldWeights.slice(0,half),oldWeights.slice(half)];
      if(!groups[1].length){const g=Math.round(oldWeights[0]*1000);groups=[[Math.floor(g/2)/1000],[(g-Math.floor(g/2))/1000]];}
      dialog?.remove();dialog=el('dialog',undefined,'order-split-dialog');dialog.setAttribute('aria-labelledby','split-title');
      const heading=el('h2',`#${id} — Siparişi böl`);heading.id='split-title';dialog.append(heading);
      dialog.append(el('p',`${o.ad_soyad} · Mevcut tutar ${amount(o.toplam_tutar).toLocaleString('tr-TR')} TL`));
      dialog.append(el('p','Her ürünü bir kayda atayın. Tutarları ürün fiyatlarına göre girin; her kayıt en fazla 15.000 TL olabilir.','split-help'));
      const form=el('form');form.noValidate=true;
      const list=el('fieldset',undefined,'split-products');list.append(el('legend','Ürün dağılımı'));
      lines.forEach((text,i)=>{
        const row=el('div',undefined,'split-product');row.append(el('span',text));
        for(let g=0;g<2;g++){
          const label=el('label'),radio=el('input');radio.type='radio';radio.name='product-'+i;radio.value=String(g);radio.checked=g===(i<Math.ceil(lines.length/2)?0:1);
          label.append(radio,document.createTextNode(`${g+1}. kayıt`));row.append(label);
        }
        list.append(row);
      });form.append(list);
      const cards=el('div',undefined,'split-cards'),inputs=[];
      for(let g=0;g<2;g++){
        const card=el('fieldset');card.append(el('legend',`${g+1}. kayıt`));
        const price=field(card,'Tahsilat tutarı (TL)','split-price-'+g,''),count=field(card,'Paket adedi','split-count-'+g,String(groups[g].length),'numeric'),kg=field(card,'Paket kilogramları (ör. 5+10)','split-kg-'+g,groups[g].join('+'));
        inputs.push({price,count,kg});cards.append(card);
      }form.append(cards);
      const fill=el('button','2. tutarı kalan tutarla doldur','split-fill');fill.type='button';fill.onclick=()=>{const first=cents(inputs[0].price.value);if(Number.isFinite(first))inputs[1].price.value=formatAmount(String((cents(o.toplam_tutar)-first)/100),false);update();};form.append(fill);
      const summary=el('p',undefined,'split-summary');summary.setAttribute('aria-live','polite');form.append(summary);
      function update(){const values=inputs.map(x=>cents(x.price.value));const total=values.every(Number.isFinite)?values.reduce((a,b)=>a+b,0)/100:0;summary.textContent=`Girilen toplam: ${total.toLocaleString('tr-TR')} / ${amount(o.toplam_tutar).toLocaleString('tr-TR')} TL. İki kayıt da Bekleyen durumunda açılır.`;}
      form.addEventListener('input',update);update();
      const errorBox=el('p',undefined,'split-error');errorBox.setAttribute('role','alert');form.append(errorBox);
      const actions=el('div',undefined,'split-actions'),cancel=el('button','Vazgeç'),submit=el('button','İki kaydı oluştur','order-split-button');cancel.type='button';submit.type='submit';cancel.onclick=()=>dialog.close();actions.append(cancel,submit);form.append(actions);
      const requestId=crypto.randomUUID();
      form.onsubmit=async event=>{
        event.preventDefault();if(busy)return;
        errorBox.textContent='';
        try{
          const parts=inputs.map((x,g)=>({amount:x.price.value,count:Number(x.count.value),kg:x.kg.value,products:lines.map((_,i)=>Number(form.querySelector(`[name="product-${i}"]:checked`).value)===g?i:-1).filter(i=>i>=0)}));
          validate(o,parts);busy=true;submit.disabled=true;cancel.disabled=true;submit.textContent='Bölünüyor…';
          const {data,error}=await config.db.rpc('gazi_split_order',{p_order_id:Number(id),p_request_id:requestId,p_expected:expected(o),p_parts:parts});
          if(error)throw error;
          if(!data?.first_order_id||!data?.second_order_id)throw Error('İşlem yanıtı doğrulanamadı. Tekrar deneyerek mevcut sonucu kontrol edin.');
          busy=false;dialog.close();config.toast(`Sipariş iki kayda bölündü: #${data.first_order_id} ve #${data.second_order_id}.`,7000);await config.onDone();
        }catch(error){errorBox.textContent=error.message||'Bölme tamamlanamadı. Tekrar deneyebilirsiniz.';}
        finally{busy=false;submit.disabled=false;cancel.disabled=false;submit.textContent='İki kaydı oluştur';}
      };
      dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.append(form);document.body.append(dialog);dialog.showModal();dialog.querySelector('input')?.focus();
    }catch(error){config.toast(error.message||'Sipariş bölme ekranı açılamadı.',7000);}
    finally{opening=false;}
  }
  root.OrderSplit={bind:options=>{config=options;},open,button,related,over,amount,formatAmount,products,weights,expected,validate,blocked};
})(globalThis);
