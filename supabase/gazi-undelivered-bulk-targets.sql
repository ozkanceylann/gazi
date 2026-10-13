-- Shared by the manual bulk refresh and hourly DHL workflow.
-- Always include undelivered production shipments, even when today's bulk list is empty.
-- Preserve exact shipment/reference matching and skip ambiguous matches.

create or replace function public.gazi_dhl_detail_targets(p_shipments jsonb)
returns jsonb language plpgsql set search_path to '' as $function$
declare result jsonb;
begin
  if current_user not in ('postgres','service_role') then raise exception 'Service role required'; end if;
  if jsonb_typeof(p_shipments) is distinct from 'array' or jsonb_array_length(p_shipments)>10000 then raise exception 'Invalid shipment list'; end if;
  with pending as materialized (
    select g.siparis_no,trim(g.kargo_takip_kodu) as shipment_id,
      case when g.orderinvoiceid is not null or
        coalesce(public.gazi_dhl_json(g.kargo_api_yanit)->'tracking'->'status'->>'referenceId',
                 public.gazi_dhl_json(g.kargo_api_yanit)->'bulk_tracking'->'status'->>'referenceId')=g.kargo_siparis_no
        then nullif(trim(g.kargo_siparis_no),'') else null end as reference
    from public.gazi_siparisler g
    where coalesce(public.dhl_import_norm(g.kargo_durumu),'') not in ('IPTAL','SILINDI')
      and coalesce(g."isDelivered",false)=false and coalesce(g."shipmentStatusCode",0)<>5
      and trim(coalesce(g.kargo_takip_kodu,'')) ~ '^[0-9]{12}$'
      and coalesce(public.gazi_dhl_json(g.kargo_api_yanit)->>'environment','production')<>'test'
  ), src as materialized (
    select distinct on (shipment_id) shipment_id,reference
    from (
      select trim(s.shipment_id) shipment_id,nullif(trim(s.reference),'') reference,0 priority
      from jsonb_to_recordset(p_shipments) s(shipment_id text,reference text)
      union all select shipment_id,reference,1 from pending
    ) all_sources
    where shipment_id ~ '^[0-9]{12}$'
    order by shipment_id,priority,reference nulls last
  ), matches as (
    select g.siparis_no,s.shipment_id,
      coalesce(s.reference,
        case when g.orderinvoiceid is not null or
          coalesce(public.gazi_dhl_json(g.kargo_api_yanit)->'tracking'->'status'->>'referenceId',
                   public.gazi_dhl_json(g.kargo_api_yanit)->'bulk_tracking'->'status'->>'referenceId')=g.kargo_siparis_no
        then nullif(trim(g.kargo_siparis_no),'') else null end) as query_reference
    from src s join public.gazi_siparisler g
      on trim(g.kargo_takip_kodu)=s.shipment_id or
        (s.reference is not null and trim(g.kargo_siparis_no)=s.reference)
    where coalesce(public.dhl_import_norm(g.kargo_durumu),'') not in ('IPTAL','SILINDI')
      and coalesce(public.gazi_dhl_json(g.kargo_api_yanit)->>'environment','production')<>'test'
  ), uniq as (
    select *,count(*) over(partition by shipment_id) n from matches
  )
  select coalesce(jsonb_agg(jsonb_build_object('siparis_no',siparis_no,'shipment_id',shipment_id,
    'query_reference',query_reference) order by siparis_no),'[]'::jsonb)
  into result from uniq where n=1;
  return jsonb_build_object('targets',result);
end;
$function$;
