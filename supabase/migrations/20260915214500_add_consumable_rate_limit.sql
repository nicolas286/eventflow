create or replace function public.consume_rate_limit(
  p_key_hash text,
  p_scope text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  request_count integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_request_count integer;
  v_storage_key text;
begin
  if p_key_hash is null or length(trim(p_key_hash)) = 0 then
    raise exception 'rate limit key hash is required';
  end if;
  if p_scope is null or length(trim(p_scope)) = 0 then
    raise exception 'rate limit scope is required';
  end if;
  if p_limit is null or p_limit <= 0 then
    raise exception 'rate limit must be greater than zero';
  end if;
  if p_window_seconds is null or p_window_seconds <= 0 then
    raise exception 'rate limit window must be greater than zero';
  end if;

  v_storage_key := trim(p_scope) || ':' || trim(p_key_hash);
  v_window_start := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );
  v_window_end := v_window_start + make_interval(secs => p_window_seconds);

  insert into private.rate_limit_hits (
    key,
    window_start,
    hits,
    updated_at
  )
  values (
    v_storage_key,
    v_window_start,
    1,
    v_now
  )
  on conflict (key, window_start)
  do update set
    hits = private.rate_limit_hits.hits + 1,
    updated_at = excluded.updated_at
  returning private.rate_limit_hits.hits into v_request_count;

  return query select
    v_request_count <= p_limit,
    v_request_count,
    case
      when v_request_count <= p_limit then 0
      else greatest(
        1,
        ceil(extract(epoch from (v_window_end - clock_timestamp())))::integer
      )
    end;
end;
$$;

revoke all on function public.consume_rate_limit(text, text, integer, integer)
from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer)
to service_role;

comment on function public.consume_rate_limit(text, text, integer, integer) is
'Consumes a fixed-window rate limit using a caller-provided salted key hash.';
