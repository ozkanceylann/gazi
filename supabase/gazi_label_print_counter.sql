alter table public.gazi_siparisler add column if not exists etiket_yazdirma_sayisi integer not null default 0 check (etiket_yazdirma_sayisi >= 0), add column if not exists etiket_son_yazdirma timestamptz;
create or replace function public.gazi_record_label_print(p_siparis_no bigint)
returns integer language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
 if auth.uid() is null or not public.seller_is_gazi_admin() then raise exception 'Gazi yönetici yetkisi gerekli' using errcode='42501'; end if;
 update public.gazi_siparisler set etiket_yazdirma_sayisi=etiket_yazdirma_sayisi+1,etiket_son_yazdirma=clock_timestamp()
 where siparis_no=p_siparis_no and kargo_durumu='Kargolandı' and orderinvoiceid is not null
 returning etiket_yazdirma_sayisi into n;
 if not found then raise exception 'Aktif kargo kaydı bulunamadı'; end if;
 return n;
end $$;
revoke all on function public.gazi_record_label_print(bigint) from public, anon;
grant execute on function public.gazi_record_label_print(bigint) to authenticated;
comment on column public.gazi_siparisler.etiket_yazdirma_sayisi is 'Bu özellikten itibaren başarıyla açılan normal veya tek paket kargo etiketi PDF sayısı; fiziksel baskı teyidi değildir.';
notify pgrst,'reload schema';