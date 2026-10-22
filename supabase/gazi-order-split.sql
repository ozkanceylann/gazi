-- Two linked, independently shippable records. The first keeps the original ID;
-- the second uses the shared master sequence, never max(id)+1.
alter table public.gazi_siparisler
  add column if not exists bolunme_grubu uuid,
  add column if not exists bolunme_ana_siparis_no integer,
  add column if not exists bolunme_sira smallint check (bolunme_sira in (1,2));
create unique index if not exists gazi_split_group_part
  on public.gazi_siparisler(bolunme_grubu,bolunme_sira);

create table if not exists public.gazi_order_splits (
  request_id uuid primary key,
  order_id integer not null unique references public.gazi_siparisler(siparis_no),
  second_order_id integer not null unique references public.gazi_siparisler(siparis_no),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  original_order jsonb not null,
  allocation jsonb not null
);
alter table public.gazi_order_splits enable row level security;
create policy gazi_split_admin_read on public.gazi_order_splits for select to authenticated
  using ((select public.seller_is_gazi_admin()));
create policy gazi_split_admin_insert on public.gazi_order_splits for insert to authenticated
  with check ((select public.seller_is_gazi_admin()) and created_by=(select auth.uid()));
revoke all on public.gazi_order_splits from public,anon,authenticated;
grant select,insert on public.gazi_order_splits to authenticated;
grant usage on sequence public.tum_siparisler_siparis_no_seq to authenticated;

create or replace function public.gazi_split_amount(p_value text)
returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare v text:=regexp_replace(coalesce(p_value,''),'(TL|TRY|₺|[[:space:]])','','gi');
begin
  if v ~ '^([0-9]{1,3}(\.[0-9]{3})+|[0-9]+)(,[0-9]{1,2})?$' then
    v:=replace(replace(v,'.',''),',','.');
  elsif v !~ '^[0-9]+(\.[0-9]{1,2})?$' then
    raise exception 'Tutar geçersiz.';
  end if;
  return v::numeric;
end; $$;

create or replace function public.gazi_split_weights(p_kg text,p_count integer)
returns numeric[] language plpgsql immutable security invoker set search_path='' as $$
declare v text; a text[]; result numeric[]; item text;
begin
  if p_count is null or p_count not between 1 and 50 then raise exception 'Paket adedi 1–50 olmalı.';end if;
  v:=public.cargo_kg_plus(p_kg,p_count::text);
  a:=string_to_array(v,'+');
  if coalesce(cardinality(a),0)<>p_count then raise exception 'Her paket için kilogram girin.';end if;
  foreach item in array a loop
    if item !~ '^[0-9]+([.,][0-9]{1,3})?$' or replace(item,',','.')::numeric<=0 then
      raise exception 'Paket kilogramı geçersiz.';
    end if;
    result:=array_append(result,replace(item,',','.')::numeric);
  end loop;
  return result;
end; $$;

create or replace function public.gazi_split_order(
  p_order_id integer,p_request_id uuid,p_expected jsonb,p_parts jsonb
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,extensions set statement_timeout='15s' as $$
declare
  original public.gazi_siparisler%rowtype;
  child public.gazi_siparisler%rowtype;
  previous public.gazi_order_splits%rowtype;
  master public.tum_siparisler%rowtype;
  source_text text; lines text[]; products_a text; products_b text;
  part jsonb; amount numeric; amounts numeric[]; weights numeric[];
  total_kg numeric:=0; original_kg numeric; count_parts integer; ids integer[]:='{}';
  product_index integer; assignment integer[]:='{}'; group_number integer;
  child_id integer; original_snapshot jsonb;
begin
  if auth.uid() is null or not public.seller_is_gazi_admin() then
    raise exception 'Sipariş bölme için Gazi yönetici oturumu gerekli.' using errcode='42501';
  end if;
  if p_request_id is null then raise exception 'İşlem kimliği gerekli.';end if;
  select * into original from public.gazi_siparisler where siparis_no=p_order_id for update;
  if not found then raise exception 'Sipariş bulunamadı.';end if;
  select * into previous from public.gazi_order_splits where request_id=p_request_id;
  if found then
    if previous.order_id<>p_order_id then raise exception 'İşlem kimliği başka siparişe ait.';end if;
    return jsonb_build_object('first_order_id',previous.order_id,'second_order_id',previous.second_order_id,'already_split',true);
  end if;
  if original.bolunme_grubu is not null then raise exception 'Bu sipariş zaten bölünmüş.';end if;
  if original.kargo_durumu not in ('Bekliyor','Hazırlandı') or original.kargo_durumu is null
    or original."isDelivered" is true or coalesce(original."shipmentStatusCode",0)>0
    or nullif(original.orderinvoiceid,'') is not null or nullif(original.kargo_takip_kodu,'') is not null
    or nullif(original.kargo_zpl,'') is not null or nullif(original.zpl_base64,'') is not null
    or original.sube_etiket_durumu in ('sending','sent','uncertain','historical') then
    raise exception 'Aktif kargo veya etiket var. Önce DHL gönderisini iptal edip Bekleyen durumuna alın.';
  end if;
  if jsonb_build_object('urun_bilgisi',original.urun_bilgisi,'toplam_tutar',original.toplam_tutar,
    'kargo_adet',original.kargo_adet,'kargo_kg',original.kargo_kg,'kargo_durumu',original.kargo_durumu)
    is distinct from p_expected then raise exception 'Sipariş değişmiş. Yeniden açıp kontrol edin.';end if;
  amount:=public.gazi_split_amount(original.toplam_tutar);
  if amount<=15000 or amount>30000 then raise exception 'İki kayda bölme toplamı 15.000 TL üzeri ve en fazla 30.000 TL olabilir.';end if;
  if jsonb_typeof(p_parts) is distinct from 'array' or jsonb_array_length(p_parts)<>2 then
    raise exception 'İki kayıt gerekli.';
  end if;
  original_snapshot:=to_jsonb(original);
  source_text:=coalesce(original.urun_bilgisi,'');
  if left(trim(source_text),1)='[' then
    begin
      select string_agg(value,E'\n' order by ordinality) into source_text
      from jsonb_array_elements_text(source_text::jsonb) with ordinality;
    exception when others then raise exception 'Ürün listesi okunamadı. Siparişi düzenleyin.';end;
  end if;
  source_text:=replace(source_text,chr(92)||'n',E'\n');
  select array_agg(trim(line) order by n) into lines
    from regexp_split_to_table(source_text,E'\r?\n') with ordinality t(line,n) where trim(line)<>'';
  if coalesce(cardinality(lines),0)<2 then raise exception 'Bölmek için ürünleri ayrı satırlara yazın.';end if;
  select sum(w) into original_kg from unnest(public.gazi_split_weights(original.kargo_kg,original.kargo_adet::integer)) w;
  for group_number in 1..2 loop
    part:=p_parts->(group_number-1);
    amount:=public.gazi_split_amount(part->>'amount');
    if amount<=0 or amount>15000 then raise exception 'Her kaydın tutarı 0 üzeri ve en fazla 15.000 TL olmalı.';end if;
    amounts:=array_append(amounts,amount);
    count_parts:=(part->>'count')::integer;
    weights:=public.gazi_split_weights(part->>'kg',count_parts);
    select total_kg+sum(w) into total_kg from unnest(weights) w;
    if jsonb_typeof(part->'products') is distinct from 'array' or jsonb_array_length(part->'products')=0 then
      raise exception 'İki kayıt için de ürün seçin.';
    end if;
    for product_index in select value::integer from jsonb_array_elements_text(part->'products') loop
      if product_index is null or product_index<0 or product_index>=cardinality(lines) or product_index=any(ids) then
        raise exception 'Ürünler tekrar edemez; her ürün bir kayda atanmalı.';
      end if;
      ids:=array_append(ids,product_index);
      if group_number=1 then products_a:=concat_ws(E'\n',products_a,lines[product_index+1]);
      else products_b:=concat_ws(E'\n',products_b,lines[product_index+1]);end if;
    end loop;
  end loop;
  if cardinality(ids)<>cardinality(lines) then raise exception 'Tüm ürünleri bir kayda atayın.';end if;
  if amounts[1]+amounts[2]<>public.gazi_split_amount(original.toplam_tutar) then raise exception 'İki tutarın toplamı mevcut sipariş tutarına eşit olmalı.';end if;
  if total_kg<>original_kg then raise exception 'Toplam kilogram mevcut siparişle aynı olmalı.';end if;

  -- All validation precedes allocation. Identity is shared with incoming orders.
  insert into public.tum_siparisler(siparis_tel,ad_soyad,musteri_tel,adres,urun_bilgisi,sehir,
    toplam_tutar,odeme_sekli,notlar,tarih,musteri_no,firma,siparis_alan,ilce,kargo_durumu,
    kargo_adet,kargo_kg,sehir_kodu,ilce_kodu,subeden_teslim,teslim_subesi,teslim_sekli_kontrol)
  values(original.siparis_tel,original.ad_soyad,original.musteri_tel,original.adres,products_b,original.sehir,
    amounts[2]::text,original.odeme_sekli,original.notlar,original.tarih,original.musteri_no,original.firma,
    original.siparis_alan,original.ilce,'Bekliyor',p_parts->1->>'count',p_parts->1->>'kg',
    original.sehir_kodu,original.ilce_kodu,original.subeden_teslim,original.teslim_subesi,original.teslim_sekli_kontrol)
    returning * into master;
  child_id:=master.siparis_no;
  child:=jsonb_populate_record(null::public.gazi_siparisler,jsonb_build_object(
    'siparis_no',child_id,'siparis_tel',master.siparis_tel,'ad_soyad',master.ad_soyad,
    'musteri_tel',master.musteri_tel,'adres',master.adres,'urun_bilgisi',products_b,'sehir',master.sehir,
    'toplam_tutar',amounts[2]::text,'odeme_sekli',master.odeme_sekli,'notlar',original.notlar,
    'tarih',original.tarih,'musteri_no',master.musteri_no,'firma',original.firma,'siparis_alan',original.siparis_alan,
    'ilce',original.ilce,'kargo_durumu','Bekliyor','kargo_adet',p_parts->1->>'count','kargo_kg',p_parts->1->>'kg',
    'sehir_kodu',master.sehir_kodu,'ilce_kodu',master.ilce_kodu,'kargo_siparis_no',master.kargo_siparis_no,
    'print',false,'isDelivered',false,'subeden_teslim',original.subeden_teslim,'teslim_subesi',original.teslim_subesi,
    'teslim_sekli_kontrol',original.teslim_sekli_kontrol,'etiket_yazdirma_sayisi',0,
    'bolunme_grubu',p_request_id,'bolunme_ana_siparis_no',p_order_id,'bolunme_sira',2));
  insert into public.gazi_siparisler overriding system value select (child).*;
  update public.gazi_siparisler set urun_bilgisi=products_a,toplam_tutar=amounts[1]::text,
    kargo_adet=p_parts->0->>'count',kargo_kg=p_parts->0->>'kg',kargo_durumu='Bekliyor',
    bolunme_grubu=p_request_id,bolunme_ana_siparis_no=p_order_id,bolunme_sira=1,
    secilen_urunler=null,gonder_hata_bilgisi=null,kargo_api_yanit=null
    where siparis_no=p_order_id;
  insert into public.gazi_order_splits(request_id,order_id,second_order_id,created_by,original_order,allocation)
    values(p_request_id,p_order_id,child_id,auth.uid(),original_snapshot,p_parts);
  return jsonb_build_object('first_order_id',p_order_id,'second_order_id',child_id,'already_split',false);
end; $$;
revoke all on function public.gazi_split_amount(text),public.gazi_split_weights(text,integer),
  public.gazi_split_order(integer,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.gazi_split_amount(text),public.gazi_split_weights(text,integer),
  public.gazi_split_order(integer,uuid,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';

-- Read-only list projection. Full labels and carrier responses are fetched from
-- gazi_siparisler only when opening details or executing an explicit action.
do $view$
declare columns_sql text;
begin
 select string_agg(case a.attname
  when 'kargo_zpl' then $$case when o.kargo_zpl is null or btrim(o.kargo_zpl)='' then o.kargo_zpl else '[stored]' end as kargo_zpl$$
  when 'zpl_base64' then $$left(o.zpl_base64,5) as zpl_base64$$
  when 'kargo_api_yanit' then $$case when o.kargo_api_yanit is json object then jsonb_build_object('environment',o.kargo_api_yanit::jsonb->'environment','tracking',o.kargo_api_yanit::jsonb->'tracking')::text else o.kargo_api_yanit end as kargo_api_yanit$$
  else format('o.%I',a.attname) end, ', ' order by a.attnum)
 into columns_sql from pg_attribute a where a.attrelid='public.gazi_siparisler'::regclass and a.attnum>0 and not a.attisdropped;
 execute 'create or replace view public.gazi_order_list with (security_invoker=true) as select '||columns_sql||' from public.gazi_siparisler o';
end;
$view$;
revoke all on public.gazi_order_list from public,anon,authenticated;
grant select on public.gazi_order_list to authenticated;
notify pgrst,'reload schema';
