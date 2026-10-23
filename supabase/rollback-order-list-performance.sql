BEGIN;
SET LOCAL lock_timeout='2s';
CREATE OR REPLACE VIEW public.gazi_order_list WITH (security_invoker=true) AS  SELECT siparis_no,
    siparis_tel,
    ad_soyad,
    musteri_tel,
    adres,
    urun_bilgisi,
    sehir,
    toplam_tutar,
    odeme_sekli,
    notlar,
    tarih,
    musteri_no,
    firma,
    siparis_alan,
    ilce,
    kargo_durumu,
    orderinvoiceid,
    orderinvoicedetailid,
    shipperbranchcode,
    kargo_adet,
    sehir_kodu,
    ilce_kodu,
    kargo_siparis_no,
    kargo_takip_kodu,
    kargo_qr_kod,
    invoiceid,
    kargo_kg,
    "left"(zpl_base64, 5) AS zpl_base64,
    print,
    iptal_nedeni,
    iptal_tarihi,
    "shipmentStatus",
    kargo_takip_url,
    kargo_gunc_saat,
    teslimat_aciklama,
    gonder_hata_bilgisi,
    "shipmentStatusCode",
    secilen_urunler,
    "isDelivered",
        CASE
            WHEN kargo_api_yanit IS JSON OBJECT THEN jsonb_build_object('environment', kargo_api_yanit::jsonb -> 'environment'::text, 'tracking', kargo_api_yanit::jsonb -> 'tracking'::text)::text
            ELSE kargo_api_yanit
        END AS kargo_api_yanit,
        CASE
            WHEN kargo_zpl IS NULL OR btrim(kargo_zpl) = ''::text THEN kargo_zpl
            ELSE '[stored]'::text
        END AS kargo_zpl,
    iade_kodu,
    iade_etiket_url,
    iade_durumu,
    iade_tarihi,
    subeden_teslim,
    teslim_subesi,
    teslim_sekli_kontrol,
    etiket_yazdirma_sayisi,
    etiket_son_yazdirma,
    etiket_olusturma_tarihi,
    sube_etiket_durumu,
    sube_etiket_tarihi,
    bolunme_grubu,
    bolunme_ana_siparis_no,
    bolunme_sira,
    COALESCE(bolunme_ana_siparis_no, siparis_no) AS liste_sira_no,
    max(etiket_olusturma_tarihi) OVER (PARTITION BY (COALESCE(bolunme_ana_siparis_no, siparis_no))) AS liste_etiket_tarihi
   FROM gazi_siparisler o;
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
 select siparis_no,"shipmentStatusCode" as carrier_code,translate(lower(replace(coalesce("shipmentStatus",''),'_',' ')),'ışğüöç','isguoc') as carrier_text,coalesce(bolunme_ana_siparis_no,siparis_no) as split_sort,public.seller_awaiting_dhl_handover(o) as awaiting_handover,nullif(trim(iade_kodu),'') is not null as has_return_label,case when trim(coalesce(p_search,''))='' then null else concat_ws(' ',siparis_no,ad_soyad,musteri_tel,sehir,ilce,kargo_takip_kodu,urun_bilgisi,iade_kodu) end as search_text,public.seller_order_phase(kargo_durumu,"isDelivered","shipmentStatusCode","shipmentStatus",teslimat_aciklama,notlar) as s from public.gazi_siparisler o where coalesce(kargo_durumu,'')<>'Silindi'
 ), filtered as (select * from owned where (p_filter='all' or (p_filter='cargo_returns' and (has_return_label or s='returning')) or (p_filter='cargo_prepared' and (s='prepared' or (s='shipped' and (awaiting_handover or carrier_code=1 or (carrier_code is null and carrier_text in ('','gonderi hazirlandi','dhl siparis kaydi olusturuldu; barkod bekleniyor')))))) or (p_filter='cargo_transit' and s in ('shipped','arrived') and (carrier_code in (2,3) or carrier_text ~ '(transfer|transit|yolda|varis)')) or (p_filter='handover' and awaiting_handover) or (p_filter='return_label' and has_return_label) or s=p_filter or (p_filter='problem' and s in ('undelivered','support')) or (p_filter='in_transit' and s in ('shipped','arrived','distribution'))) and (trim(coalesce(p_search,''))='' or search_text ilike '%'||left(p_search,100)||'%')),
 page as (select o from public.gazi_siparisler o join (select siparis_no from filtered order by split_sort desc,siparis_no asc offset p_offset limit 30) f using(siparis_no) order by coalesce(o.bolunme_ana_siparis_no,o.siparis_no) desc,o.siparis_no asc)
 select jsonb_build_object('phone',phone,'counts',(select jsonb_build_object('all',count(*),'handover',count(*) filter(where awaiting_handover),'return_label',count(*) filter(where has_return_label),'pending',count(*) filter(where s='pending'),'prepared',count(*) filter(where s='prepared'),'shipped',count(*) filter(where s='shipped'),'delivered',count(*) filter(where s='delivered'),'problem',count(*) filter(where s in ('undelivered','support')),'arrived',count(*) filter(where s='arrived'),'distribution',count(*) filter(where s='distribution'),'undelivered',count(*) filter(where s='undelivered'),'support',count(*) filter(where s='support'),'returning',count(*) filter(where s='returning'),'cancelled',count(*) filter(where s='cancelled')) from owned),'total',(select count(*) from filtered),'orders',coalesce((select jsonb_agg(public.seller_order_safe(o) || jsonb_build_object('seller_phone',public.seller_owner_phone((o).siparis_alan,(o).siparis_tel)) order by coalesce((o).bolunme_ana_siparis_no,(o).siparis_no) desc,(o).siparis_no asc) from page),'[]'::jsonb)) into result;
 return result;
end; $function$;
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
 select siparis_no,"shipmentStatusCode" as carrier_code,translate(lower(replace(coalesce("shipmentStatus",''),'_',' ')),'ışğüöç','isguoc') as carrier_text,coalesce(bolunme_ana_siparis_no,siparis_no) as split_sort,public.seller_awaiting_dhl_handover(o) as awaiting_handover,nullif(trim(iade_kodu),'') is not null as has_return_label,case when trim(coalesce(p_search,''))='' then null else concat_ws(' ',siparis_no,ad_soyad,musteri_tel,sehir,ilce,kargo_takip_kodu,urun_bilgisi,iade_kodu) end as search_text,public.seller_order_phase(kargo_durumu,"isDelivered","shipmentStatusCode","shipmentStatus",teslimat_aciklama,notlar) as s from public.gazi_siparisler o where public.seller_owner_phone(siparis_alan,siparis_tel)=phone and coalesce(kargo_durumu,'')<>'Silindi'
 ), filtered as (select * from owned where (p_filter='all' or (p_filter='cargo_returns' and (has_return_label or s='returning')) or (p_filter='cargo_prepared' and (s='prepared' or (s='shipped' and (awaiting_handover or carrier_code=1 or (carrier_code is null and carrier_text in ('','gonderi hazirlandi','dhl siparis kaydi olusturuldu; barkod bekleniyor')))))) or (p_filter='cargo_transit' and s in ('shipped','arrived') and (carrier_code in (2,3) or carrier_text ~ '(transfer|transit|yolda|varis)')) or (p_filter='handover' and awaiting_handover) or (p_filter='return_label' and has_return_label) or s=p_filter or (p_filter='problem' and s in ('undelivered','support')) or (p_filter='in_transit' and s in ('shipped','arrived','distribution'))) and (trim(coalesce(p_search,''))='' or search_text ilike '%'||left(p_search,100)||'%')),
 page as (select o from public.gazi_siparisler o join (select siparis_no from filtered order by split_sort desc,siparis_no asc offset p_offset limit 30) f using(siparis_no) order by coalesce(o.bolunme_ana_siparis_no,o.siparis_no) desc,o.siparis_no asc)
 select jsonb_build_object('phone',phone,'counts',(select jsonb_build_object('all',count(*),'handover',count(*) filter(where awaiting_handover),'return_label',count(*) filter(where has_return_label),'pending',count(*) filter(where s='pending'),'prepared',count(*) filter(where s='prepared'),'shipped',count(*) filter(where s='shipped'),'delivered',count(*) filter(where s='delivered'),'problem',count(*) filter(where s in ('undelivered','support')),'arrived',count(*) filter(where s='arrived'),'distribution',count(*) filter(where s='distribution'),'undelivered',count(*) filter(where s='undelivered'),'support',count(*) filter(where s='support'),'returning',count(*) filter(where s='returning'),'cancelled',count(*) filter(where s='cancelled')) from owned),'total',(select count(*) from filtered),'orders',coalesce((select jsonb_agg(public.seller_order_safe(o) order by coalesce((o).bolunme_ana_siparis_no,(o).siparis_no) desc,(o).siparis_no asc) from page),'[]'::jsonb)) into result;
 return result;
end; $function$;
DROP INDEX IF EXISTS public.gazi_split_list_group_idx;
NOTIFY pgrst,'reload schema';
COMMIT;
