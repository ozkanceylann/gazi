-- AI delivery classification; existing view privileges and row security are preserved.

ALTER TABLE public.tum_siparisler ADD COLUMN subeden_teslim boolean NOT NULL DEFAULT false, ADD COLUMN teslim_subesi text, ADD COLUMN teslim_sekli_kontrol boolean NOT NULL DEFAULT false;

ALTER TABLE public.gazi_siparisler ADD COLUMN subeden_teslim boolean NOT NULL DEFAULT false, ADD COLUMN teslim_subesi text, ADD COLUMN teslim_sekli_kontrol boolean NOT NULL DEFAULT false;

CREATE OR REPLACE VIEW public.gazi_siparisler_giris WITH (security_invoker=true) AS  SELECT siparis_no,
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
    zpl_base64,
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
    "isDelivered", subeden_teslim, teslim_subesi, teslim_sekli_kontrol FROM gazi_siparisler;

CREATE OR REPLACE VIEW public.whatsapp_siparis_giris WITH (security_invoker=true) AS  SELECT siparis_no,
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
    "orderInvoiceId",
    "orderInvoiceDetailId",
    "shipperBranchCode",
    kargo_adet,
    sehir_kodu,
    ilce_kodu,
    kargo_siparis_no,
    kargo_takip_kodu,
    kargo_qr_kod,
    "invoiceId",
    "referenceId",
    kargo_kg,
    zpl_base64,
    print,
    iptal_nedeni,
    iptal_tarihi,
    siparis_sekli,
    secilen_urunler,
    musteri_notu,
    whatsapp_jid,
    whatsapp_message_id,
    whatsapp_participant,
    whatsapp_participant_alt,
    whatsapp_addressing_mode,
    whatsapp_from_me,
    whatsapp_push_name,
    whatsapp_message_text,
    siparis_durumu,
    isleme_alinma_tarihi,
    'Yeni'::text AS kayit_islemi, subeden_teslim, teslim_subesi, teslim_sekli_kontrol FROM tum_siparisler t;

CREATE OR REPLACE FUNCTION public.seller_guard_order_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare allowed text[]:=array['ad_soyad','musteri_tel','adres','sehir','ilce','sehir_kodu','ilce_kodu','urun_bilgisi','toplam_tutar','odeme_sekli','notlar','kargo_adet','kargo_kg','subeden_teslim','teslim_subesi','teslim_sekli_kontrol'];
begin
 if nullif(old.orderinvoiceid,'') is not null and (new.subeden_teslim is distinct from old.subeden_teslim or new.teslim_subesi is distinct from old.teslim_subesi) then new.teslim_sekli_kontrol:=true; end if;
 if auth.jwt()->'app_metadata'->>'role'='seller' then
  if old.kargo_durumu is distinct from 'Bekliyor' or public.seller_owner_phone(old.siparis_alan,old.siparis_tel) is distinct from public.seller_current_phone() then raise exception 'Yalnızca kendi bekleyen siparişinizi düzenleyebilirsiniz.' using errcode='42501'; end if;
  if (to_jsonb(new)-allowed) is distinct from (to_jsonb(old)-allowed) then raise exception 'Sipariş sahipliği ve süreç alanları değiştirilemez.' using errcode='42501'; end if;
 end if;
 return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.sync_gazi_order_to_master()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.tum_siparisler
  set subeden_teslim=new.subeden_teslim,teslim_subesi=new.teslim_subesi,teslim_sekli_kontrol=new.teslim_sekli_kontrol,siparis_tel=new.siparis_tel, ad_soyad=new.ad_soyad, musteri_tel=new.musteri_tel,
      adres=new.adres, urun_bilgisi=new.urun_bilgisi, sehir=new.sehir,
      toplam_tutar=new.toplam_tutar, odeme_sekli=new.odeme_sekli, notlar=new.notlar,
      firma=new.firma, siparis_alan=new.siparis_alan, ilce=new.ilce,
      kargo_durumu=new.kargo_durumu, kargo_adet=new.kargo_adet,
      sehir_kodu=new.sehir_kodu, ilce_kodu=new.ilce_kodu,
      kargo_siparis_no=new.kargo_siparis_no, kargo_takip_kodu=new.kargo_takip_kodu,
      kargo_qr_kod=new.kargo_qr_kod, "invoiceId"=new.invoiceid,
      kargo_kg=new.kargo_kg, zpl_base64=new.zpl_base64, print=new.print,
      iptal_nedeni=new.iptal_nedeni, iptal_tarihi=new.iptal_tarihi,
      secilen_urunler=new.secilen_urunler
  where siparis_no=new.siparis_no;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.gazi_siparisler_giris_kaydet()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_row public.gazi_siparisler%ROWTYPE; v_master public.tum_siparisler%ROWTYPE;
BEGIN
SELECT * INTO STRICT v_master FROM public.tum_siparisler WHERE siparis_no=NEW.siparis_no FOR UPDATE;
NEW."siparis_no":=v_master."siparis_no";
NEW."siparis_tel":=v_master."siparis_tel";
NEW."ad_soyad":=v_master."ad_soyad";
NEW."musteri_tel":=v_master."musteri_tel";
NEW."adres":=v_master."adres";
NEW."urun_bilgisi":=v_master."urun_bilgisi";
NEW."sehir":=v_master."sehir";
NEW."toplam_tutar":=v_master."toplam_tutar";
NEW."odeme_sekli":=v_master."odeme_sekli";
NEW."notlar":=v_master."notlar";
NEW."tarih":=v_master."tarih";
NEW."musteri_no":=v_master."musteri_no";
NEW."siparis_alan":=v_master."siparis_alan";
NEW."ilce":=v_master."ilce";
NEW."kargo_durumu":=v_master."kargo_durumu";
NEW."kargo_adet":=v_master."kargo_adet";
NEW."sehir_kodu":=v_master."sehir_kodu";
NEW."ilce_kodu":=v_master."ilce_kodu";
NEW."kargo_siparis_no":=v_master."kargo_siparis_no";
NEW."kargo_kg":=v_master."kargo_kg";
NEW.subeden_teslim:=v_master.subeden_teslim;
NEW.teslim_subesi:=v_master.teslim_subesi;
NEW.teslim_sekli_kontrol:=v_master.teslim_sekli_kontrol;
INSERT INTO public.gazi_siparisler ("siparis_no","siparis_tel","ad_soyad","musteri_tel","adres","urun_bilgisi","sehir","toplam_tutar","odeme_sekli","notlar","tarih","musteri_no","firma","siparis_alan","ilce","kargo_durumu","kargo_adet","sehir_kodu","ilce_kodu","kargo_siparis_no","kargo_kg",subeden_teslim,teslim_subesi,teslim_sekli_kontrol) VALUES (NEW."siparis_no",NEW."siparis_tel",NEW."ad_soyad",NEW."musteri_tel",NEW."adres",NEW."urun_bilgisi",NEW."sehir",NEW."toplam_tutar",NEW."odeme_sekli",NEW."notlar",NEW."tarih",NEW."musteri_no",NEW."firma",NEW."siparis_alan",NEW."ilce",NEW."kargo_durumu",NEW."kargo_adet",NEW."sehir_kodu",NEW."ilce_kodu",NEW."kargo_siparis_no",NEW."kargo_kg",NEW.subeden_teslim,NEW.teslim_subesi,NEW.teslim_sekli_kontrol)
ON CONFLICT (siparis_no) DO UPDATE SET subeden_teslim=EXCLUDED.subeden_teslim,teslim_subesi=EXCLUDED.teslim_subesi,teslim_sekli_kontrol=EXCLUDED.teslim_sekli_kontrol,"siparis_tel"=EXCLUDED."siparis_tel","ad_soyad"=EXCLUDED."ad_soyad","musteri_tel"=EXCLUDED."musteri_tel","adres"=EXCLUDED."adres","urun_bilgisi"=EXCLUDED."urun_bilgisi","sehir"=EXCLUDED."sehir","toplam_tutar"=EXCLUDED."toplam_tutar","odeme_sekli"=EXCLUDED."odeme_sekli","notlar"=EXCLUDED."notlar","musteri_no"=EXCLUDED."musteri_no","firma"=EXCLUDED."firma","siparis_alan"=EXCLUDED."siparis_alan","ilce"=EXCLUDED."ilce","kargo_adet"=EXCLUDED."kargo_adet","sehir_kodu"=EXCLUDED."sehir_kodu","ilce_kodu"=EXCLUDED."ilce_kodu","kargo_kg"=EXCLUDED."kargo_kg"
RETURNING * INTO v_row;
NEW:=jsonb_populate_record(NEW,to_jsonb(v_row));
RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.whatsapp_siparis_giris_3h()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_phone text; v_id integer; v_row public.tum_siparisler%ROWTYPE;
BEGIN
v_phone:=right(regexp_replace(coalesce(NEW.musteri_tel,''),'[^0-9]','','g'),10);
IF v_phone ~ '^5[0-9]{9}$' THEN
PERFORM pg_advisory_xact_lock(hashtextextended('whatsapp-order-3h:'||v_phone,0));
SELECT t.siparis_no INTO v_id FROM public.tum_siparisler t
WHERE right(regexp_replace(coalesce(t.musteri_tel,''),'[^0-9]','','g'),10)=v_phone
AND t.tarih >= (now() AT TIME ZONE 'GMT+3')-interval '3 hours'
AND t.tarih < (now() AT TIME ZONE 'GMT+3') + interval '1 second'
ORDER BY t.tarih DESC,t.siparis_no DESC LIMIT 1 FOR UPDATE;
END IF;
IF v_id IS NULL THEN
INSERT INTO public.tum_siparisler ("siparis_alan","musteri_tel","ad_soyad","adres","sehir","ilce","urun_bilgisi","toplam_tutar","odeme_sekli","notlar","firma","siparis_tel","kargo_adet","kargo_durumu","kargo_kg","whatsapp_jid","whatsapp_message_id","whatsapp_participant","whatsapp_participant_alt","whatsapp_addressing_mode","whatsapp_push_name","whatsapp_message_text","isleme_alinma_tarihi",subeden_teslim,teslim_subesi,teslim_sekli_kontrol)
VALUES (NEW."siparis_alan",NEW."musteri_tel",NEW."ad_soyad",NEW."adres",NEW."sehir",NEW."ilce",NEW."urun_bilgisi",NEW."toplam_tutar",NEW."odeme_sekli",NEW."notlar",NEW."firma",NEW."siparis_tel",NEW."kargo_adet",NEW."kargo_durumu",NEW."kargo_kg",NEW."whatsapp_jid",NEW."whatsapp_message_id",NEW."whatsapp_participant",NEW."whatsapp_participant_alt",NEW."whatsapp_addressing_mode",NEW."whatsapp_push_name",NEW."whatsapp_message_text",NEW."isleme_alinma_tarihi",coalesce(NEW.subeden_teslim,false),NEW.teslim_subesi,coalesce(NEW.teslim_sekli_kontrol,false)) RETURNING * INTO v_row;
ELSE
UPDATE public.tum_siparisler SET subeden_teslim=coalesce(NEW.subeden_teslim,false),teslim_subesi=NEW.teslim_subesi,teslim_sekli_kontrol=coalesce(NEW.teslim_sekli_kontrol,false),"siparis_alan"=NEW."siparis_alan",
"musteri_tel"=NEW."musteri_tel",
"ad_soyad"=NEW."ad_soyad",
"adres"=NEW."adres",
"sehir"=NEW."sehir",
"ilce"=NEW."ilce",
"urun_bilgisi"=NEW."urun_bilgisi",
"toplam_tutar"=NEW."toplam_tutar",
"odeme_sekli"=NEW."odeme_sekli",
"notlar"=NEW."notlar",
"firma"=NEW."firma",
"siparis_tel"=NEW."siparis_tel",
"kargo_adet"=NEW."kargo_adet",
"kargo_kg"=NEW."kargo_kg",
"whatsapp_jid"=NEW."whatsapp_jid",
"whatsapp_message_id"=NEW."whatsapp_message_id",
"whatsapp_participant"=NEW."whatsapp_participant",
"whatsapp_participant_alt"=NEW."whatsapp_participant_alt",
"whatsapp_addressing_mode"=NEW."whatsapp_addressing_mode",
"whatsapp_push_name"=NEW."whatsapp_push_name",
"whatsapp_message_text"=NEW."whatsapp_message_text",
"isleme_alinma_tarihi"=NEW."isleme_alinma_tarihi" WHERE siparis_no=v_id RETURNING * INTO v_row;
UPDATE public.gazi_siparisler SET subeden_teslim=v_row.subeden_teslim,teslim_subesi=v_row.teslim_subesi,teslim_sekli_kontrol=v_row.teslim_sekli_kontrol,"siparis_alan"=v_row."siparis_alan","musteri_tel"=v_row."musteri_tel","ad_soyad"=v_row."ad_soyad","adres"=v_row."adres","sehir"=v_row."sehir","ilce"=v_row."ilce","urun_bilgisi"=v_row."urun_bilgisi","toplam_tutar"=v_row."toplam_tutar","odeme_sekli"=v_row."odeme_sekli","notlar"=v_row."notlar","siparis_tel"=v_row."siparis_tel","kargo_adet"=v_row."kargo_adet","kargo_kg"=v_row."kargo_kg",sehir_kodu=v_row.sehir_kodu,ilce_kodu=v_row.ilce_kodu WHERE siparis_no=v_id;
UPDATE public.queen_siparisler SET "siparis_alan"=v_row."siparis_alan","musteri_tel"=v_row."musteri_tel","ad_soyad"=v_row."ad_soyad","adres"=v_row."adres","sehir"=v_row."sehir","ilce"=v_row."ilce","urun_bilgisi"=v_row."urun_bilgisi","toplam_tutar"=v_row."toplam_tutar","odeme_sekli"=v_row."odeme_sekli","notlar"=v_row."notlar","siparis_tel"=v_row."siparis_tel","kargo_adet"=v_row."kargo_adet","kargo_kg"=v_row."kargo_kg",sehir_kodu=v_row.sehir_kodu,ilce_kodu=v_row.ilce_kodu WHERE siparis_no=v_id;
UPDATE public.isimsiz_siparisler SET "siparis_alan"=v_row."siparis_alan","musteri_tel"=v_row."musteri_tel","ad_soyad"=v_row."ad_soyad","adres"=v_row."adres","sehir"=v_row."sehir","ilce"=v_row."ilce","urun_bilgisi"=v_row."urun_bilgisi","toplam_tutar"=v_row."toplam_tutar","odeme_sekli"=v_row."odeme_sekli","notlar"=v_row."notlar","siparis_tel"=v_row."siparis_tel","kargo_adet"=v_row."kargo_adet","kargo_kg"=v_row."kargo_kg",sehir_kodu=v_row.sehir_kodu,ilce_kodu=v_row.ilce_kodu WHERE siparis_no=v_id;
SELECT * INTO v_row FROM public.tum_siparisler WHERE siparis_no=v_id;
END IF;
NEW:=jsonb_populate_record(NEW,to_jsonb(v_row));
NEW.kayit_islemi:=CASE WHEN v_id IS NULL THEN 'Yeni' ELSE 'Güncellendi' END;
RETURN NEW;
END; $function$;

NOTIFY pgrst, 'reload schema';
