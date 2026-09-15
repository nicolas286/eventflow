-- STAGING ONLY. The runner must check its linked project reference before execution.
-- No production data or credentials are used here.
BEGIN;
UPDATE private.app_environment
SET public_assets_base_url = 'https://cpcmcxerrsnnjncrhldr.supabase.co/storage/v1/object/public/public-assets'
WHERE singleton = true;

INSERT INTO storage.buckets (id, name, public)
VALUES ('mail-previews', 'mail-previews', false)
ON CONFLICT (id) DO NOTHING;

-- Execute the same expiry RPC locally in this database; no remote HTTP endpoint.
SELECT cron.schedule('expire-orders', '*/2 * * * *', 'SELECT public.expire_orders(200)');
COMMIT;
