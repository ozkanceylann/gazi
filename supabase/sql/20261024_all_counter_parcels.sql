CREATE OR REPLACE FUNCTION public.admin_orders(p_filter text DEFAULT 'all'::text, p_search text DEFAULT ''::text, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result jsonb; phone text:=null;
begin
 if not public.seller_is_gazi_admin() then raise exception 'Yönetici erişimi gerekli.' using errcode='42501'; end if;
 if p_filter not in ('all','pending','prepared','shipped','in_transit','arrived','distribution','delivered','undelivered','support','returning','problem','cancelled','return_label','handover','cargo_prepared','cargo_transit','cargo_returns') or p_offset<0 then raise exception 'Geçersiz filtre.'; end if;
 with owned as materialized (
 select case when trim(o.kargo_adet) ~ '^[0-9]{1,9}$' then trim(o.kargo_adet)::bigint else 0 end as parcel_count,siparis_no,"shipmentStatusCode" as carrier_code,translate(lower(replace(coalesce("shipmentStatus",''),'_',' ')),'ışğüöç','isguoc') as carrier_text,coalesce(bolunme_ana_siparis_no,siparis_no) as split_sort,coalesce(o.kargo_durumu='Kargolandı' AND o."isDelivered" IS NOT TRUE AND (o."shipmentStatusCode" IS NULL OR o."shipmentStatusCode"=1) AND coalesce(o."shipmentStatus",'') IN ('','Gönderi_Hazırlandı','Gönderi Hazırlandı','DHL sipariş kaydı oluşturuldu; barkod bekleniyor') AND (coalesce(o.kargo_zpl,'')<>'' OR o.zpl_base64 LIKE 'JVBER%'),false) as awaiting_handover,nullif(trim(iade_kodu),'') is not null as has_return_label,case when trim(coalesce(p_search,''))='' then null else concat_ws(' ',siparis_no,ad_soyad,musteri_tel,sehir,ilce,kargo_takip_kodu,urun_bilgisi,iade_kodu) end as search_text,public.seller_order_phase(kargo_durumu,"isDelivered","shipmentStatusCode","shipmentStatus",teslimat_aciklama,notlar) as s from public.gazi_siparisler o where coalesce(kargo_durumu,'')<>'Silindi'
 ), filtered as (select * from owned where (p_filter='all' or (p_filter='cargo_returns' and (has_return_label or s='returning')) or (p_filter='cargo_prepared' and (s='prepared' or (s='shipped' and (awaiting_handover or carrier_code=1 or (carrier_code is null and carrier_text in ('','gonderi hazirlandi','dhl siparis kaydi olusturuldu; barkod bekleniyor')))))) or (p_filter='cargo_transit' and s in ('shipped','arrived') and (carrier_code in (2,3) or carrier_text ~ '(transfer|transit|yolda|varis)')) or (p_filter='handover' and awaiting_handover) or (p_filter='return_label' and has_return_label) or s=p_filter or (p_filter='problem' and s in ('undelivered','support')) or (p_filter='in_transit' and s in ('shipped','arrived','distribution'))) and (trim(coalesce(p_search,''))='' or search_text ilike '%'||left(p_search,100)||'%')),
 page as (select o from public.gazi_siparisler o join (select siparis_no from filtered order by split_sort desc,siparis_no asc offset p_offset limit 30) f using(siparis_no) order by coalesce(o.bolunme_ana_siparis_no,o.siparis_no) desc,o.siparis_no asc)
 select jsonb_build_object('phone',phone,'counts',(select jsonb_build_object('all',count(*),'all_parcels',coalesce(sum(parcel_count),0),'handover',count(*) filter(where awaiting_handover),'handover_parcels',coalesce(sum(parcel_count) filter(where awaiting_handover),0),'return_label',count(*) filter(where has_return_label),'return_label_parcels',coalesce(sum(parcel_count) filter(where has_return_label),0),'pending',count(*) filter(where s='pending'),'pending_parcels',coalesce(sum(parcel_count) filter(where s='pending'),0),'prepared',count(*) filter(where s='prepared'),'prepared_parcels',coalesce(sum(parcel_count) filter(where s='prepared'),0),'shipped',count(*) filter(where s='shipped'),'shipped_parcels',coalesce(sum(parcel_count) filter(where s='shipped'),0),'delivered',count(*) filter(where s='delivered'),'delivered_parcels',coalesce(sum(parcel_count) filter(where s='delivered'),0),'problem',count(*) filter(where s in ('undelivered','support')),'problem_parcels',coalesce(sum(parcel_count) filter(where s in ('undelivered','support')),0),'arrived',count(*) filter(where s='arrived'),'arrived_parcels',coalesce(sum(parcel_count) filter(where s='arrived'),0),'distribution',count(*) filter(where s='distribution'),'distribution_parcels',coalesce(sum(parcel_count) filter(where s='distribution'),0),'undelivered',count(*) filter(where s='undelivered'),'undelivered_parcels',coalesce(sum(parcel_count) filter(where s='undelivered'),0),'support',count(*) filter(where s='support'),'support_parcels',coalesce(sum(parcel_count) filter(where s='support'),0),'returning',count(*) filter(where s='returning'),'returning_parcels',coalesce(sum(parcel_count) filter(where s='returning'),0),'cancelled',count(*) filter(where s='cancelled'),'cancelled_parcels',coalesce(sum(parcel_count) filter(where s='cancelled'),0)) from owned),'total',(select count(*) from filtered),'orders',coalesce((select jsonb_agg(public.seller_order_safe(o) || jsonb_build_object('seller_phone',public.seller_owner_phone((o).siparis_alan,(o).siparis_tel)) order by coalesce((o).bolunme_ana_siparis_no,(o).siparis_no) desc,(o).siparis_no asc) from page),'[]'::jsonb)) into result;
 return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.seller_orders(p_filter text DEFAULT 'all'::text, p_search text DEFAULT ''::text, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result jsonb; phone text:=public.seller_current_phone();
begin
 if phone is null then raise exception 'Satıcı oturumu gerekli.' using errcode='42501'; end if;
 if p_filter not in ('all','pending','prepared','shipped','in_transit','arrived','distribution','delivered','undelivered','support','returning','problem','cancelled','return_label','handover','cargo_prepared','cargo_transit','cargo_returns') or p_offset<0 then raise exception 'Geçersiz filtre.'; end if;
 with owned as materialized (
 select case when trim(o.kargo_adet) ~ '^[0-9]{1,9}$' then trim(o.kargo_adet)::bigint else 0 end as parcel_count,siparis_no,"shipmentStatusCode" as carrier_code,translate(lower(replace(coalesce("shipmentStatus",''),'_',' ')),'ışğüöç','isguoc') as carrier_text,coalesce(bolunme_ana_siparis_no,siparis_no) as split_sort,coalesce(o.kargo_durumu='Kargolandı' AND o."isDelivered" IS NOT TRUE AND (o."shipmentStatusCode" IS NULL OR o."shipmentStatusCode"=1) AND coalesce(o."shipmentStatus",'') IN ('','Gönderi_Hazırlandı','Gönderi Hazırlandı','DHL sipariş kaydı oluşturuldu; barkod bekleniyor') AND (coalesce(o.kargo_zpl,'')<>'' OR o.zpl_base64 LIKE 'JVBER%'),false) as awaiting_handover,nullif(trim(iade_kodu),'') is not null as has_return_label,case when trim(coalesce(p_search,''))='' then null else concat_ws(' ',siparis_no,ad_soyad,musteri_tel,sehir,ilce,kargo_takip_kodu,urun_bilgisi,iade_kodu) end as search_text,public.seller_order_phase(kargo_durumu,"isDelivered","shipmentStatusCode","shipmentStatus",teslimat_aciklama,notlar) as s from public.gazi_siparisler o where public.seller_owner_phone(siparis_alan,siparis_tel)=phone and coalesce(kargo_durumu,'')<>'Silindi'
 ), filtered as (select * from owned where (p_filter='all' or (p_filter='cargo_returns' and (has_return_label or s='returning')) or (p_filter='cargo_prepared' and (s='prepared' or (s='shipped' and (awaiting_handover or carrier_code=1 or (carrier_code is null and carrier_text in ('','gonderi hazirlandi','dhl siparis kaydi olusturuldu; barkod bekleniyor')))))) or (p_filter='cargo_transit' and s in ('shipped','arrived') and (carrier_code in (2,3) or carrier_text ~ '(transfer|transit|yolda|varis)')) or (p_filter='handover' and awaiting_handover) or (p_filter='return_label' and has_return_label) or s=p_filter or (p_filter='problem' and s in ('undelivered','support')) or (p_filter='in_transit' and s in ('shipped','arrived','distribution'))) and (trim(coalesce(p_search,''))='' or search_text ilike '%'||left(p_search,100)||'%')),
 page as (select o from public.gazi_siparisler o join (select siparis_no from filtered order by split_sort desc,siparis_no asc offset p_offset limit 30) f using(siparis_no) order by coalesce(o.bolunme_ana_siparis_no,o.siparis_no) desc,o.siparis_no asc)
 select jsonb_build_object('phone',phone,'counts',(select jsonb_build_object('all',count(*),'all_parcels',coalesce(sum(parcel_count),0),'handover',count(*) filter(where awaiting_handover),'handover_parcels',coalesce(sum(parcel_count) filter(where awaiting_handover),0),'return_label',count(*) filter(where has_return_label),'return_label_parcels',coalesce(sum(parcel_count) filter(where has_return_label),0),'pending',count(*) filter(where s='pending'),'pending_parcels',coalesce(sum(parcel_count) filter(where s='pending'),0),'prepared',count(*) filter(where s='prepared'),'prepared_parcels',coalesce(sum(parcel_count) filter(where s='prepared'),0),'shipped',count(*) filter(where s='shipped'),'shipped_parcels',coalesce(sum(parcel_count) filter(where s='shipped'),0),'delivered',count(*) filter(where s='delivered'),'delivered_parcels',coalesce(sum(parcel_count) filter(where s='delivered'),0),'problem',count(*) filter(where s in ('undelivered','support')),'problem_parcels',coalesce(sum(parcel_count) filter(where s in ('undelivered','support')),0),'arrived',count(*) filter(where s='arrived'),'arrived_parcels',coalesce(sum(parcel_count) filter(where s='arrived'),0),'distribution',count(*) filter(where s='distribution'),'distribution_parcels',coalesce(sum(parcel_count) filter(where s='distribution'),0),'undelivered',count(*) filter(where s='undelivered'),'undelivered_parcels',coalesce(sum(parcel_count) filter(where s='undelivered'),0),'support',count(*) filter(where s='support'),'support_parcels',coalesce(sum(parcel_count) filter(where s='support'),0),'returning',count(*) filter(where s='returning'),'returning_parcels',coalesce(sum(parcel_count) filter(where s='returning'),0),'cancelled',count(*) filter(where s='cancelled'),'cancelled_parcels',coalesce(sum(parcel_count) filter(where s='cancelled'),0)) from owned),'total',(select count(*) from filtered),'orders',coalesce((select jsonb_agg(public.seller_order_safe(o) order by coalesce((o).bolunme_ana_siparis_no,(o).siparis_no) desc,(o).siparis_no asc) from page),'[]'::jsonb)) into result;
 return result;
end; $function$
;
CREATE OR REPLACE FUNCTION public.gazi_operation_counts()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
WITH flags AS (
 SELECT case when trim(kargo_adet) ~ '^[0-9]{1,9}$' then trim(kargo_adet)::bigint else 0 end as parcels,
 kargo_durumu='Bekliyor' as prepare,
 kargo_durumu='Kargolandı' AND "isDelivered" IS NOT TRUE
 AND ("shipmentStatusCode" IS NULL OR "shipmentStatusCode"=1)
 AND coalesce("shipmentStatus",'') IN ('','Gönderi_Hazırlandı','Gönderi Hazırlandı','DHL sipariş kaydı oluşturuldu; barkod bekleniyor') as created,
 (coalesce(kargo_zpl,'')<>'' OR coalesce(zpl_base64 LIKE 'JVBER%',false)) as saved,
 etiket_yazdirma_sayisi,
 ("shipmentStatusCode" IN (6,8) OR ("shipmentStatusCode" IS NULL AND "shipmentStatus" IN ('Teslim_Edilemedi','Teslim Edilemedi','Destek_Gerekiyor','Destek Gerekiyor'))) as attention
 FROM public.gazi_siparisler WHERE (select public.seller_is_gazi_admin()) AND coalesce(kargo_durumu,'')<>'Silindi'
), queues AS (
 SELECT parcels,prepare,created AND (NOT saved OR etiket_yazdirma_sayisi IS NULL OR etiket_yazdirma_sayisi=0) as label,created AND saved as handover,attention FROM flags
)
SELECT jsonb_build_object(
 'prepare',count(*) filter(where prepare),'prepare_parcels',coalesce(sum(parcels) filter(where prepare),0),
 'label',count(*) filter(where label),'label_parcels',coalesce(sum(parcels) filter(where label),0),
 'handover',count(*) filter(where handover),'handover_parcels',coalesce(sum(parcels) filter(where handover),0),
 'attention',count(*) filter(where attention),'attention_parcels',coalesce(sum(parcels) filter(where attention),0)
) FROM queues;
$function$;
REVOKE ALL ON FUNCTION public.gazi_operation_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gazi_operation_counts() TO authenticated;

