create or replace function public.gazi_branch_name_matches(p_name text,p_mask text) returns boolean language sql immutable security invoker set search_path='' as $$
 select case when position('*' in coalesce(p_mask,''))>0 then
 length(regexp_replace(translate(upper(coalesce(p_mask,'')),'İŞĞÜÖÇıişğüöç','ISGUOCIISGUOC'),'[^A-Z0-9]','','g'))>=2
 and replace(public.dhl_import_norm(p_name),' ','') ~ ('^'||replace(regexp_replace(translate(upper(p_mask),'İŞĞÜÖÇıişğüöç','ISGUOCIISGUOC'),'[^A-Z0-9*]','','g'),'*','.')||'$')
 else replace(public.dhl_import_norm(p_name),' ','')=replace(public.dhl_import_norm(p_mask),' ','') and length(public.dhl_import_norm(p_mask))>3 end;
$$;
revoke all on function public.gazi_branch_name_matches(text,text) from public,anon,authenticated;
grant execute on function public.gazi_branch_name_matches(text,text) to service_role;

create or replace function public.gazi_branch_match_plan() returns jsonb language plpgsql security invoker set search_path='' as $$
declare first_day date; today date:=(now() at time zone 'Europe/Istanbul')::date;
begin
 if current_user not in ('postgres','service_role') then raise exception 'Service role required'; end if;
 select greatest(min(tarih::date)-1,today-6) into first_day from public.gazi_siparisler where sube_etiket_durumu in ('sent','historical','uncertain') and nullif(trim(kargo_takip_kodu),'') is null and kargo_durumu='Kargolandı' and not coalesce("isDelivered",false);
 return jsonb_build_object('pending',first_day is not null,'from',coalesce(first_day,today),'to',today);
end $$;
revoke all on function public.gazi_branch_match_plan() from public,anon,authenticated;
grant execute on function public.gazi_branch_match_plan() to service_role;

create or replace function public.gazi_branch_auto_match(p_shipments jsonb,p_dry_run boolean default true) returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='25s' as $$
declare matches jsonb; item jsonb; updates integer:=0; ambiguous integer; total integer;
begin
 if current_user not in ('postgres','service_role') then raise exception 'Service role required'; end if;
 if jsonb_typeof(p_shipments) is distinct from 'array' or jsonb_array_length(p_shipments)>10000 then raise exception 'Invalid shipment list'; end if;
 perform pg_advisory_xact_lock(20261016,9672);
 with src as (
 select distinct on (x.shipment_id) x.* from jsonb_to_recordset(p_shipments) x(shipment_id text,reference text,code integer,name text,city text,district text,phone text,pieces integer,amount numeric,shipment_date date,raw jsonb)
 where x.shipment_id ~ '^[0-9]{12}$' and x.code between 1 and 8 and x.shipment_date is not null
 order by x.shipment_id
 ), pairs as (
 select g.siparis_no,g.sube_etiket_durumu,to_jsonb(s) as shipment,count(*) over(partition by g.siparis_no) as order_candidates,count(*) over(partition by s.shipment_id) as shipment_candidates
 from public.gazi_siparisler g join src s on
 public.gazi_branch_name_matches(g.ad_soyad,s.name)
 and (nullif(s.reference,'') is null or s.reference=g.kargo_siparis_no)
 and s.shipment_date between g.tarih::date-3 and g.tarih::date+10
 and (
   (length(s.phone)=10 and s.phone=right(regexp_replace(g.musteri_tel,'[^0-9]','','g'),10))
   or (
    replace(public.dhl_import_norm(g.sehir),' ','')=replace(public.dhl_import_norm(s.city),' ','') and coalesce(s.city,'')<>''
    and replace(public.dhl_import_norm(g.ilce),' ','')=replace(public.dhl_import_norm(s.district),' ','') and coalesce(s.district,'')<>''
    and s.pieces::text=g.kargo_adet
    and s.amount is not null and s.amount=public.dhl_import_money(g.toplam_tutar)
    and (length(coalesce(s.phone,''))<>10 or s.phone=right(regexp_replace(g.musteri_tel,'[^0-9]','','g'),10))
   )
 )
 where g.kargo_durumu in ('Kargolandı','Hazırlandı','Bekliyor')
 and not coalesce(g."isDelivered",false) and nullif(trim(g.kargo_takip_kodu),'') is null
 and coalesce(public.gazi_dhl_json(g.kargo_api_yanit)->>'environment','production')<>'test'
 and not exists(select 1 from public.gazi_siparisler other where trim(other.kargo_takip_kodu)=s.shipment_id and other.siparis_no<>g.siparis_no)
 ) select coalesce(jsonb_agg(jsonb_build_object('siparis_no',siparis_no,'shipment',shipment)) filter(where order_candidates=1 and shipment_candidates=1 and sube_etiket_durumu in ('sent','historical','uncertain')),'[]'), count(*) filter(where sube_etiket_durumu in ('sent','historical','uncertain') and (order_candidates>1 or shipment_candidates>1)) into matches,ambiguous from pairs;
 total:=jsonb_array_length(matches);
 if not p_dry_run then
  for item in select * from jsonb_array_elements(matches) loop
   update public.gazi_siparisler g set
    kargo_takip_kodu=item->'shipment'->>'shipment_id',
    kargo_siparis_no=coalesce(nullif(item->'shipment'->>'reference',''),g.kargo_siparis_no),
    orderinvoiceid=null,sube_etiket_durumu='historical',
    "shipmentStatusCode"=(item->'shipment'->>'code')::smallint,
    "shipmentStatus"=case (item->'shipment'->>'code')::integer when 1 then 'Gönderi_Hazırlandı' when 2 then 'Transfer_Aşamasında' when 3 then 'Teslimat_Birimine_Ulaştı' when 4 then 'Alıcı_Adresine_Yönlendirildi' when 5 then 'Teslim_Edildi' when 6 then 'Teslim_Edilemedi' when 7 then 'Geri_Geliyor' when 8 then 'Destek_Gerekiyor' end,
    "isDelivered"=(item->'shipment'->>'code')::integer=5,
    kargo_takip_url='https://kargotakip.dhlecommerce.com.tr/?takipNo='||(item->'shipment'->>'shipment_id'),
    kargo_gunc_saat=now()::text,
    kargo_api_yanit=(public.gazi_dhl_json(g.kargo_api_yanit)||jsonb_build_object('branch_link',jsonb_build_object('method','recipient_composite_unique','shipmentId',item->'shipment'->>'shipment_id','previousReference',g.kargo_siparis_no,'previousOrderInvoiceId',g.orderinvoiceid,'linkedAt',now(),'evidence',item->'shipment'))||jsonb_build_object('bulk_tracking',jsonb_build_object('environment','production','checkedAt',now(),'status',item->'shipment'->'raw'->'shipment')))::text
   where g.siparis_no=(item->>'siparis_no')::integer and nullif(trim(g.kargo_takip_kodu),'') is null;
   if found then updates:=updates+1;end if;
  end loop;
 end if;
 return jsonb_build_object('success',true,'dry_run',p_dry_run,'matched',total,'updated',updates,'ambiguous',ambiguous,'matches',matches);
end $$;
revoke all on function public.gazi_branch_auto_match(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.gazi_branch_auto_match(jsonb,boolean) to service_role;
