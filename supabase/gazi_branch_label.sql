alter table public.gazi_siparisler add column if not exists sube_etiket_durumu text;
alter table public.gazi_siparisler add column if not exists sube_etiket_tarihi timestamptz;
create table if not exists public.gazi_branch_label_requests (
 siparis_no integer primary key references public.gazi_siparisler(siparis_no),
 status text not null check(status in ('sending','sent','uncertain','failed','historical')),
 group_jid text not null default '120363408432692208@g.us',
 requested_by uuid, created_at timestamptz not null default now(), sent_at timestamptz,
 message_id text, error text
);
alter table public.gazi_branch_label_requests enable row level security;
revoke all on public.gazi_branch_label_requests from anon,authenticated;
grant all on public.gazi_branch_label_requests to service_role;
create or replace function public.gazi_branch_label_internal(p_id integer,p_operation text,p_user uuid default null,p_message_id text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare o public.gazi_siparisler; r public.gazi_branch_label_requests;
begin
 select * into o from public.gazi_siparisler where siparis_no=p_id for update;
 if not found then raise exception 'Sipariş bulunamadı'; end if;
 select * into r from public.gazi_branch_label_requests where siparis_no=p_id;
 if p_operation='begin' then
  if r.status is not null and r.status<>'failed' then return jsonb_build_object('existing',true,'status',r.status); end if;
  if o.kargo_api_yanit like '%"environment":"test"%' then raise exception 'Test kaydı iletilemez'; end if;
  if o.kargo_durumu<>'Kargolandı' or coalesce(o."isDelivered",false) or coalesce(o."shipmentStatusCode",1)<>1 then raise exception 'Yalnızca çıkış yapmamış Kargolandı siparişleri iletilebilir'; end if;
  if coalesce(o.kargo_zpl,'')<>'' or coalesce(o.zpl_base64,'')<>'' then raise exception 'Siparişin etiketi zaten kayıtlı'; end if;
  insert into public.gazi_branch_label_requests(siparis_no,status,requested_by) values(p_id,'sending',p_user)
  on conflict(siparis_no) do update set status='sending',requested_by=p_user,error=null;
  update public.gazi_siparisler set sube_etiket_durumu='sending' where siparis_no=p_id;
  return jsonb_build_object('existing',false,'order',to_jsonb(o));
 elsif p_operation='confirm' then
  if r.status is null or r.status='failed' then raise exception 'Önce şubeye iletin'; end if;
  update public.gazi_branch_label_requests set status='historical' where siparis_no=p_id;
  update public.gazi_siparisler set sube_etiket_durumu='historical',sube_etiket_tarihi=now() where siparis_no=p_id;
  return jsonb_build_object('success',true,'status','historical');
 elsif p_operation in ('sent','uncertain','failed') then
  if r.status<>'sending' then raise exception 'Aktif gönderim bulunamadı'; end if;
  update public.gazi_branch_label_requests set status=p_operation,message_id=p_message_id,sent_at=case when p_operation='sent' then now() else null end where siparis_no=p_id;
  update public.gazi_siparisler set sube_etiket_durumu=p_operation,sube_etiket_tarihi=case when p_operation='sent' then now() else null end where siparis_no=p_id;
  return jsonb_build_object('success',true);
 end if;
 raise exception 'İşlem geçersiz';
end $$;
revoke all on function public.gazi_branch_label_internal(integer,text,uuid,text) from public,anon,authenticated;
grant execute on function public.gazi_branch_label_internal(integer,text,uuid,text) to service_role;
