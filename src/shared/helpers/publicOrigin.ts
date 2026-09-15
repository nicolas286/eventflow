export function getPublicOrigin() {
  const configured = import.meta.env.VITE_PUBLIC_BASE_URL?.trim();
  const url = new URL(configured || window.location.origin);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid public URL');
  return url.origin;
}
