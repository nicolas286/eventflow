do $$
declare
  v_status jsonb;
begin
  select public.get_deployment_cron_status()
  into v_status;

  if (v_status ->> 'reminder_jobs')::integer <> 1
    or (v_status ->> 'reminder_workers_jobs')::integer <> 1
    or (v_status ->> 'legacy_reminder_jobs')::integer <> 0
    or (v_status ->> 'renewal_jobs')::integer <> 1
  then
    raise exception 'Invalid Eventflow cron configuration: %', v_status;
  end if;

  raise notice 'Eventflow cron configuration is ready: %', v_status;
end;
$$;
