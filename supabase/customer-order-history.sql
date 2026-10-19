-- Uses the caller's existing RLS: sellers see only their own orders.
create or replace function public.gazi_customer_order_history(p_order_ids integer[])
returns jsonb
language plpgsql stable security invoker
set search_path = ''
set statement_timeout = '10s'
as $$
declare result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Oturum gerekli.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_order_ids), 0) > 100 then
    raise exception 'En fazla 100 sipariş sorgulanabilir.';
  end if;
  with visible as materialized (
    select o.siparis_no, o.tarih,
      case
        when length(p.digits) between 10 and 14 and right(p.digits, 10) ~ '^5[0-9]{9}$'
          then 'tel:' || right(p.digits, 10)
        when o.musteri_no > 0 then 'customer:' || o.musteri_no::text
        else 'order:' || o.siparis_no::text
      end as customer_key
    from public.gazi_siparisler o
    cross join lateral (select regexp_replace(coalesce(o.musteri_tel, ''), '[^0-9]', '', 'g') as digits) p
    where coalesce(o.kargo_durumu, '') <> 'Silindi'
  ), requested as (
    select * from visible where siparis_no = any(p_order_ids)
  ), numbered as (
    select v.*, row_number() over (partition by v.customer_key order by v.tarih asc nulls last, v.siparis_no asc) as ordinal
    from visible v
    where v.customer_key in (select customer_key from requested)
  ), histories as (
    select customer_key, count(*) as total,
      jsonb_agg(jsonb_build_object('siparis_no', siparis_no, 'tarih', tarih) order by ordinal desc) as orders
    from numbered group by customer_key
  )
  select coalesce(jsonb_object_agg(r.siparis_no::text,
    jsonb_build_object('ordinal', n.ordinal, 'total', h.total, 'orders', h.orders)), '{}'::jsonb)
  into result
  from requested r join numbered n using (siparis_no, customer_key)
  join histories h using (customer_key);
  return result;
end;
$$;
revoke all on function public.gazi_customer_order_history(integer[]) from public, anon;
grant execute on function public.gazi_customer_order_history(integer[]) to authenticated;
