-- Business reference data observed in production on 2026-09-15.
-- Safe on production: existing plan settings are never overwritten.
INSERT INTO public.plan_limits (
  plan, max_events_per_year, max_registrations_per_event,
  max_products_per_event, max_form_fields, max_admins, branding_required,
  custom_domain_allowed, api_access, advanced_analytics, promo_codes, automated_emails
) VALUES
  ('free', 1, 50, 10, 100, 1, true, false, false, false, false, false),
  ('starter', 5, NULL, 10, 100, 1, false, false, false, false, false, false),
  ('pro', NULL, NULL, 10, 100, 1, false, false, false, false, false, false)
ON CONFLICT (plan) DO NOTHING;
