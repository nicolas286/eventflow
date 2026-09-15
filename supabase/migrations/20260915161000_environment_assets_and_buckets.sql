-- Match existing production buckets without changing their settings on conflict.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('public-assets', 'public-assets', true, 5242880, ARRAY['image/*']),
       ('invoices', 'invoices', false, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE private.app_environment (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  public_assets_base_url text NOT NULL CHECK (public_assets_base_url ~ '^https?://')
);
REVOKE ALL ON private.app_environment FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.app_environment TO service_role;

-- Preserve current production URLs. Bootstrap MUST replace this row on staging
-- before seeding or exposing that project to a frontend.
INSERT INTO private.app_environment (singleton, public_assets_base_url)
VALUES (true, 'https://dixirvllhfkvqoahhfqh.supabase.co/storage/v1/object/public/public-assets');

CREATE FUNCTION public.default_asset_url(asset_path text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT rtrim(public_assets_base_url, '/') || '/' || ltrim(asset_path, '/')
  FROM private.app_environment WHERE singleton = true;
$$;
REVOKE ALL ON FUNCTION public.default_asset_url(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.default_asset_url(text) TO anon, authenticated, service_role;

-- Adapt the current RPC bodies without changing their contracts or rewriting history.
DO $$
DECLARE
  definition text;
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.prosrc LIKE '%https://dixirvllhfkvqoahhfqh.supabase.co/storage/v1/object/public/public-assets/defaults/%'
  LOOP
    definition := pg_get_functiondef(fn.oid);
    definition := replace(definition,
      quote_literal('https://dixirvllhfkvqoahhfqh.supabase.co/storage/v1/object/public/public-assets/defaults/default_logo.webp'),
      'public.default_asset_url(''defaults/default_logo.webp'')');
    definition := replace(definition,
      quote_literal('https://dixirvllhfkvqoahhfqh.supabase.co/storage/v1/object/public/public-assets/defaults/default_banner.webp'),
      'public.default_asset_url(''defaults/default_banner.webp'')');
    EXECUTE definition;
  END LOOP;
END $$;

ALTER TABLE public.organization_profile
  ALTER COLUMN logo_url SET DEFAULT public.default_asset_url('defaults/default_logo.webp'),
  ALTER COLUMN default_event_banner_url SET DEFAULT public.default_asset_url('defaults/default_banner.webp');
