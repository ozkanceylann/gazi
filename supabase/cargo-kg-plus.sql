
create or replace function public.cargo_kg_plus(p_raw text, p_count text)
returns text language plpgsql immutable set search_path to '' as $$
declare raw text; n integer; parts text[]; piece text; result text[]:='{}'; weight numeric;
begin
 if p_raw is null or trim(p_raw)='' then return p_raw; end if;
 if coalesce(p_count,'') !~ '^[0-9]{1,3}$' then return p_raw; end if;
 n:=p_count::integer; if n<1 or n>100 then return p_raw; end if;
 raw:=trim(regexp_replace(p_raw,'kg','','gi'));
 if position('+' in raw)>0 then parts:=string_to_array(raw,'+');
 elsif n=1 and raw ~ '^[0-9]+([.,][0-9]+)?$' then parts:=array[raw];
 else parts:=regexp_split_to_array(raw,'[,|/;[:space:]]+|(?<=[0-9])-(?=[0-9])'); end if;
 foreach piece in array parts loop
  piece:=trim(piece);
  if piece !~ '^[0-9]+([.,][0-9]+)?$' then return p_raw; end if;
  weight:=replace(piece,',','.')::numeric;
  if weight<=0 then return p_raw; end if;
  result:=array_append(result,case when weight=trunc(weight) then trunc(weight)::text else trim(trailing '.' from trim(trailing '0' from weight::text)) end);
 end loop;
 if position('+' in raw)=0 and cardinality(result)=1 and n>1 then result:=array_fill(result[1],array[n]); end if;
 -- Preserve all recorded weights even when a historical parcel count is wrong.
 -- Shipping validators reject that mismatch instead of silently dropping or inventing parcels.
 return array_to_string(result,'+');
end;$$;
revoke all on function public.cargo_kg_plus(text,text) from public,anon;
grant execute on function public.cargo_kg_plus(text,text) to authenticated,service_role;
create or replace function public.normalize_cargo_kg_plus()
returns trigger language plpgsql set search_path to '' as $$
begin new.kargo_kg:=public.cargo_kg_plus(new.kargo_kg,new.kargo_adet);return new;end;$$;
revoke all on function public.normalize_cargo_kg_plus() from public,anon;
grant execute on function public.normalize_cargo_kg_plus() to authenticated,service_role;
do $install$
declare t record;
begin
 for t in select c.table_name from information_schema.columns c join information_schema.tables x using(table_catalog,table_schema,table_name)
   where c.table_schema='public' and c.column_name='kargo_kg' and x.table_type='BASE TABLE' loop
   execute format('drop trigger if exists normalize_cargo_kg_plus on public.%I',t.table_name);
   execute format('create trigger normalize_cargo_kg_plus before insert or update of kargo_kg,kargo_adet on public.%I for each row execute function public.normalize_cargo_kg_plus()',t.table_name);
 end loop;
end;$install$;
 then parts:=array[raw];
 else parts:=regexp_split_to_array(raw,'[,|/;[:space:]]+|(?<=[0-9])-(?=[0-9])'); end if;
 foreach piece in array parts loop
  piece:=trim(piece);
  if piece !~ '^[0-9]+([.,][0-9]+)?$' then return p_raw; end if;
  weight:=replace(piece,',','.')::numeric;
  if weight<=0 then return p_raw; end if;
  result:=array_append(result,case when weight=trunc(weight) then trunc(weight)::text else trim(trailing '.' from trim(trailing '0' from weight::text)) end);
 end loop;
 if position('+' in raw)=0 and cardinality(result)=1 and n>1 then result:=array_fill(result[1],array[n]); end if;
 if cardinality(result)<>n then return p_raw; end if;
 return array_to_string(result,'+');
end;$$;
revoke all on function public.cargo_kg_plus(text,text) from public,anon;
grant execute on function public.cargo_kg_plus(text,text) to authenticated,service_role;
create or replace function public.normalize_cargo_kg_plus()
returns trigger language plpgsql set search_path to '' as $$
begin new.kargo_kg:=public.cargo_kg_plus(new.kargo_kg,new.kargo_adet);return new;end;$$;
revoke all on function public.normalize_cargo_kg_plus() from public,anon;
grant execute on function public.normalize_cargo_kg_plus() to authenticated,service_role;
do $install$
declare t record;
begin
 for t in select c.table_name from information_schema.columns c join information_schema.tables x using(table_catalog,table_schema,table_name)
   where c.table_schema='public' and c.column_name='kargo_kg' and x.table_type='BASE TABLE' loop
   execute format('drop trigger if exists normalize_cargo_kg_plus on public.%I',t.table_name);
   execute format('create trigger normalize_cargo_kg_plus before insert or update of kargo_kg,kargo_adet on public.%I for each row execute function public.normalize_cargo_kg_plus()',t.table_name);
 end loop;
end;$install$;

create schema if not exists cargo_format_private;
revoke all on schema cargo_format_private from public,anon,authenticated;
create table if not exists cargo_format_private.kg_plus_backup (
 table_name text not null, siparis_no text not null, old_kg text, new_kg text, saved_at timestamptz not null default now(),
 primary key(table_name,siparis_no)
);
do $convert$
declare t record;
begin
 for t in select c.table_name from information_schema.columns c join information_schema.tables x using(table_catalog,table_schema,table_name)
   where c.table_schema='public' and c.column_name='kargo_kg' and x.table_type='BASE TABLE' loop
  execute format('insert into cargo_format_private.kg_plus_backup(table_name,siparis_no,old_kg,new_kg)
    select %L,siparis_no::text,kargo_kg,public.cargo_kg_plus(kargo_kg,kargo_adet) from public.%I
    where kargo_kg is distinct from public.cargo_kg_plus(kargo_kg,kargo_adet) on conflict do nothing',t.table_name,t.table_name);
 end loop;
 for t in select c.table_name from information_schema.columns c join information_schema.tables x using(table_catalog,table_schema,table_name)
   where c.table_schema='public' and c.column_name='kargo_kg' and x.table_type='BASE TABLE' loop
  execute format('update public.%I set kargo_kg=public.cargo_kg_plus(kargo_kg,kargo_adet)
    where kargo_kg is distinct from public.cargo_kg_plus(kargo_kg,kargo_adet)',t.table_name);
 end loop;
end;$convert$;

