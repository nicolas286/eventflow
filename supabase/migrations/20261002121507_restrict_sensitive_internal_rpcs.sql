-- Internal email coordination and operator subscription grants are server-only.
-- REVOKE PUBLIC alone does not remove grants inherited from default ACLs.
-- Keep the operator helper: external/platform consumers are not proven absent.
BEGIN;
REVOKE ALL ON FUNCTION public.admin_grant_subscription(uuid,text,integer,timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_order_confirmation_email(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_email_once(uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_order_confirmation_email_error(uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_order_confirmation_email_sent(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_grant_subscription(uuid,text,integer,timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_order_confirmation_email(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_email_once(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_order_confirmation_email_error(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_order_confirmation_email_sent(uuid) TO service_role;
COMMIT;
