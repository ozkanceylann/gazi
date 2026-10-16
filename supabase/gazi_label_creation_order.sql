alter table public.gazi_siparisler add column if not exists etiket_olusturma_tarihi timestamptz;
create or replace function public.gazi_stamp_label_creation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
 if nullif(btrim(new.kargo_zpl),'') is not null or coalesce(new.zpl_base64,'') like 'JVBER%' then
  if tg_op='INSERT' then
   new.etiket_olusturma_tarihi=clock_timestamp();
  elsif new.kargo_zpl is distinct from old.kargo_zpl or new.zpl_base64 is distinct from old.zpl_base64 then
   new.etiket_olusturma_tarihi=clock_timestamp();
  end if;
 else
  new.etiket_olusturma_tarihi=null;
 end if;
 return new;
end $$;
revoke all on function public.gazi_stamp_label_creation() from public,anon,authenticated;
create trigger gazi_stamp_label_creation before insert or update of kargo_zpl,zpl_base64 on public.gazi_siparisler for each row execute function public.gazi_stamp_label_creation();
create index if not exists gazi_label_created_order_idx on public.gazi_siparisler (etiket_olusturma_tarihi desc nulls last,siparis_no desc) where kargo_durumu='Kargolandı';
comment on column public.gazi_siparisler.etiket_olusturma_tarihi is 'Etiket içeriği ilk kaydedildiğinde/değiştiğinde oluşur; yalnızca yazdırmada değişmez. Özellik öncesi etiketler için bilinmiyor.';
notify pgrst,'reload schema';