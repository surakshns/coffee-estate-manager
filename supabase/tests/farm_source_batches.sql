begin;
do $$ declare batch jsonb; result jsonb; rejected boolean;begin
  batch:=jsonb_build_object('updates',jsonb_build_array(jsonb_build_object('source_id','spices-board-prices','source_name','Untrusted name','source_url','https://www.indianspices.com/marketing/price/domestic/current-market-price','source_type','other','source_authority_level',4,'retrieved_at',now(),'raw_source_reference','TEST SYNTHETIC fixture','verification_status','OFFICIAL_CONFIRMED','title','Test pepper quote','summary','Test fixture only','category','prices','crops',array['PEPPER'],'dedupe_key',repeat('a',64),'details','{}'::jsonb)),
    'prices',jsonb_build_array(jsonb_build_object('source_id','spices-board-prices','update_key',repeat('a',64),'crop','PEPPER','market','Test market','unit','INR/kg','price_date','2026-10-05','price_kind','indicative','source_url','https://www.indianspices.com/marketing/price/domestic/current-market-price','retrieved_at',now(),'average_price',100)),'forecasts','[]'::jsonb);
  result:=public.persist_farm_source_batch('spices-board-prices',batch);
  if result->>'inserted'<>'1' then raise exception 'First source batch was not inserted.';end if;
  result:=public.persist_farm_source_batch('spices-board-prices',batch);
  if result->>'updated'<>'1' or (select count(*) from public.market_prices where source_id='spices-board-prices')<>1 then raise exception 'Source batch deduplication failed.';end if;
  if exists(select 1 from public.official_updates where source_id='spices-board-prices' and (source_name<>'Spices Board India' or source_authority_level<>1)) then raise exception 'Caller could override publisher authority.';end if;
  rejected:=false;
  begin perform public.persist_farm_source_batch('spices-board-prices',jsonb_set(jsonb_set(batch,'{updates,0,title}','"Invalid replacement"'),'{prices,0,average_price}','-1'));
  exception when check_violation then rejected:=true;end;
  if not rejected or (select title from public.official_updates where dedupe_key=repeat('a',64))<>'Test pepper quote' then raise exception 'Failed batch changed previous valid data.';end if;
  perform public.persist_farm_source_batch('spices-board-prices','{"updates":[],"prices":[],"forecasts":[]}');
  if (select count(*) from public.market_prices where source_id='spices-board-prices')<>1 then raise exception 'Empty batch deleted existing prices.';end if;
  if not public.claim_farm_source('coffee-board-market') or public.claim_farm_source('coffee-board-market') then raise exception 'Source lease did not prevent overlapping polls.';end if;
  perform public.finish_farm_source('coffee-board-market',false);
  if public.claim_farm_source('coffee-board-market') then raise exception 'Failed source bypassed minimum polling interval.';end if;
  if public.claim_farm_source('ksndmc-observed') then raise exception 'Disabled source was claimed.';end if;
end $$;
rollback;
