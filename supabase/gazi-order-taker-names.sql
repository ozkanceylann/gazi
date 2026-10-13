
create table public.gazi_order_takers (
  phone text primary key check (phone ~ '^[0-9]{10,15}$'),
  display_name text check (display_name is null or (char_length(trim(display_name)) between 1 and 80))
);
alter table public.gazi_order_takers enable row level security;
revoke all on public.gazi_order_takers from anon;
grant select,insert,update on public.gazi_order_takers to authenticated;
grant all on public.gazi_order_takers to service_role;
create policy gazi_admin_read on public.gazi_order_takers for select to authenticated
using ((select public.seller_is_gazi_admin()));
create policy gazi_admin_insert on public.gazi_order_takers for insert to authenticated
with check ((select public.seller_is_gazi_admin()));
create policy gazi_admin_update on public.gazi_order_takers for update to authenticated
using ((select public.seller_is_gazi_admin())) with check ((select public.seller_is_gazi_admin()));
insert into public.gazi_order_takers(phone)
select distinct case when length(d)=10 then '90'||d when length(d)=11 and left(d,1)='0' then '90'||substr(d,2) else d end
from (
  select regexp_replace(coalesce(nullif(trim(siparis_tel),''),siparis_alan,''),'[^0-9]','','g') d
  from public.gazi_siparisler
) s where length(d) between 10 and 15 on conflict do nothing;
