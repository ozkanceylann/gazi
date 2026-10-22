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
 execute 'create or replace view public.gazi_order_list with (security_invoker=true) as select '||columns_sql||', coalesce(o.bolunme_ana_siparis_no,o.siparis_no) as liste_sira_no, max(o.etiket_olusturma_tarihi) over (partition by coalesce(o.bolunme_ana_siparis_no,o.siparis_no)) as liste_etiket_tarihi from public.gazi_siparisler o';
end;
$view$;
revoke all on public.gazi_order_list from public,anon,authenticated;
grant select on public.gazi_order_list to authenticated;
notify pgrst,'reload schema';
