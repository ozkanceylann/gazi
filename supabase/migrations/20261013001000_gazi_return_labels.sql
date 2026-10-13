-- İade etiketleri çıkış gönderisinden ayrı tutulur.
alter table public.gazi_siparisler
  add column if not exists iade_kodu text,
  add column if not exists iade_etiket_url text,
  add column if not exists iade_durumu text,
  add column if not exists iade_tarihi timestamptz;

create table if not exists public.gazi_iade_islemleri (
  siparis_no integer primary key references public.gazi_siparisler(siparis_no),
  reference_id text not null unique,
  status text not null check(status in ('creating','ready','failed','uncertain')),
  label_url text,
  response jsonb,
  error text,
  updated_at timestamptz not null default now()
);
alter table public.gazi_iade_islemleri enable row level security;
revoke all on public.gazi_iade_islemleri from anon, authenticated;
grant all on public.gazi_iade_islemleri to service_role;
create schema if not exists gazi_carrier_private;
revoke all on schema gazi_carrier_private from public, anon, authenticated;
grant usage on schema gazi_carrier_private to service_role;
create table if not exists gazi_carrier_private.return_connection (
  id integer primary key check (id=1), server_key text not null check (length(server_key)>=32)
);
alter table gazi_carrier_private.return_connection enable row level security;
revoke all on gazi_carrier_private.return_connection from public, anon, authenticated;
grant select on gazi_carrier_private.return_connection to service_role;

create or replace function public.gazi_iade_internal(p_operation text,p_id integer,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.gazi_siparisler; r public.gazi_iade_islemleri; ref text; link text; config jsonb;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Sunucu yetkisi gerekli'; end if;
  select * into o from public.gazi_siparisler where siparis_no=p_id for update;
  if not found or o.kargo_durumu in ('İptal','Silindi') then raise exception 'Sipariş bulunamadı'; end if;
  select * into r from public.gazi_iade_islemleri where siparis_no=p_id for update;
  if p_operation='begin' then
    if nullif(o.iade_etiket_url,'') is not null then
      return jsonb_build_object('existing',true,'reference',o.iade_kodu,'url',o.iade_etiket_url);
    end if;
    if r.status in ('creating','uncertain') then raise exception 'İade isteğinin sonucu bekleniyor. Tekrar kayıt açılmadı; DHL kaydı kontrol edilmeli.'; end if;
    if not coalesce(o."isDelivered",false) and coalesce(o."shipmentStatusCode",0)<>5 then raise exception 'İade etiketi yalnızca teslim edilmiş siparişe oluşturulur'; end if;
    if nullif(trim(o.ad_soyad),'') is null or nullif(trim(o.adres),'') is null
      or nullif(trim(o.sehir),'') is null or nullif(trim(o.ilce),'') is null
      or nullif(trim(o.musteri_tel),'') is null or nullif(trim(o.sehir_kodu),'') is null
      or nullif(trim(o.ilce_kodu),'') is null then raise exception 'İade için müşteri, telefon, adres ve şehir/ilçe kodları eksiksiz olmalı'; end if;
    select jsonb_build_object('url','https://n8n.ozkanceylan.uk/webhook/gazi_iade_olustur','key',server_key)
      into config from gazi_carrier_private.return_connection where id=1;
    if nullif(config->>'url','') is null or nullif(config->>'key','') is null then raise exception 'DHL iade bağlantısı ayarlanmamış'; end if;
    ref:=coalesce(r.reference_id,'GZI-'||p_id||'-R1');
    insert into public.gazi_iade_islemleri(siparis_no,reference_id,status)
      values(p_id,ref,'creating') on conflict(siparis_no) do update set status='creating',error=null,updated_at=now();
    return jsonb_build_object('existing',false,'order',to_jsonb(o),'reference',ref,'gateway',config);
  elsif p_operation='finish' then
    if r.reference_id is null or p_data->>'reference' is distinct from r.reference_id then raise exception 'İade referansı eşleşmedi'; end if;
    link:=p_data->>'url';
    if link !~ '^https://mn[.]tc[/]?[?]rtnid=[A-Za-z0-9]+$' then raise exception 'DHL iade fişi bağlantısı geçersiz'; end if;
    update public.gazi_iade_islemleri set status='ready',label_url=link,response=p_data->'response',error=null,updated_at=now() where siparis_no=p_id;
    update public.gazi_siparisler set iade_kodu=r.reference_id,iade_etiket_url=link,iade_durumu='Etiket Oluşturuldu',iade_tarihi=now() where siparis_no=p_id;
    return jsonb_build_object('reference',r.reference_id,'url',link);
  elsif p_operation in ('failed','uncertain') then
    update public.gazi_iade_islemleri set status=p_operation,error=left(p_data->>'error',500),updated_at=now() where siparis_no=p_id and status<>'ready';
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'Geçersiz iade işlemi';
end $$;
revoke all on function public.gazi_iade_internal(text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.gazi_iade_internal(text,integer,jsonb) to service_role;
