-- PHASE 3 ONLY: binary asset Edge and migrated consumers must be published.
-- Keep outside active migrations; preserve existing public display URLs.
DROP POLICY IF EXISTS "org members can upload their assets" ON storage.objects;
DROP POLICY IF EXISTS "org members can update their assets" ON storage.objects;
DROP POLICY IF EXISTS "org members can delete their assets" ON storage.objects;
-- Preserve public read public-assets and all managed Storage grants/RLS.
-- The existing bucket's settings are deliberately unchanged: the versioned
-- default is 5 MiB and image/*, while deployment may have existing settings.
-- Edge enforces its own 5 MiB cap plus PNG/JPEG/WebP/GIF container validation.
