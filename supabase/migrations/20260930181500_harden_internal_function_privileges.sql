-- Close legacy direct-RPC paths that can bypass the platform back-office
-- authorization boundary. These functions are either server-only helpers or
-- trigger functions; browser roles must never execute them directly.

revoke all on function public.admin_grant_subscription(uuid, text, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_grant_subscription(uuid, text, integer, timestamptz)
  to service_role;

revoke all on function public.claim_order_confirmation_email(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_order_confirmation_email(uuid)
  to service_role;

revoke all on function public.log_email_once(uuid, text)
  from public, anon, authenticated;
grant execute on function public.log_email_once(uuid, text)
  to service_role;

revoke all on function public.mark_order_confirmation_email_error(uuid, text)
  from public, anon, authenticated;
grant execute on function public.mark_order_confirmation_email_error(uuid, text)
  to service_role;

revoke all on function public.mark_order_confirmation_email_sent(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_order_confirmation_email_sent(uuid)
  to service_role;

revoke all on function public.rpc_create_invoice_peppol(jsonb)
  from public, anon, authenticated;
grant execute on function public.rpc_create_invoice_peppol(jsonb)
  to service_role;

revoke all on function public.rpc_update_invoice_peppol_status(jsonb)
  from public, anon, authenticated;
grant execute on function public.rpc_update_invoice_peppol_status(jsonb)
  to service_role;

revoke all on function public.check_in_ticket_internal(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.check_in_ticket_internal(uuid, uuid)
  to service_role;

revoke all on function public.handle_new_auth_user()
  from public, anon, authenticated;

revoke all on function public.rls_auto_enable()
  from public, anon, authenticated;

-- This organizer mutation has its own auth/org-membership checks and remains
-- available to authenticated users, but there is no reason for anon to call it.
revoke all on function public.admin_delete_order(uuid) from public, anon;
grant execute on function public.admin_delete_order(uuid) to authenticated, service_role;
