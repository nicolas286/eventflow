// netlify/functions/share-event.js
import {
  publicEventRequestSchema,
  publicEventShareSchema,
} from "../../shared/schemas/public-catalog.ts";

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeSlice(s, n = 160) {
  const t = String(s ?? "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function isMetaBot(headers) {
  const ua = String(
    headers?.["user-agent"] || headers?.["User-Agent"] || "",
  ).toLowerCase();
  return ua.includes("facebookexternalhit") || ua.includes("facebot");
}

export const handler = async (event) => {
  try {
    // /share/o/:orgSlug/e/:eventSlug
    const path = event.path || "";
    const m = path.match(/^\/share\/o\/([^/]+)\/e\/([^/]+)\/?$/);
    let orgSlug;
    let eventSlug;
    try {
      orgSlug = m?.[1] ? decodeURIComponent(m[1]) : null;
      eventSlug = m?.[2] ? decodeURIComponent(m[2]) : null;
    } catch {
      return { statusCode: 400, body: "Invalid params" };
    }

    if (!orgSlug || !eventSlug) {
      return { statusCode: 400, body: "Missing params" };
    }

    if (!process.env.PUBLIC_BASE_URL)
      return { statusCode: 500, body: "Missing public URL" };
    const baseUrl = new URL(process.env.PUBLIC_BASE_URL).origin;
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnon) {
      return { statusCode: 500, body: "Missing Supabase env" };
    }

    const input = publicEventRequestSchema.safeParse({ orgSlug, eventSlug });
    if (!input.success) return { statusCode: 400, body: "Invalid params" };
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/functions/v1/events/public/share`,
      {
        method: "POST",
        headers: { apikey: supabaseAnon, "content-type": "application/json" },
        body: JSON.stringify(input.data),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) {
      const statusCode = [400, 404, 429, 503].includes(response.status)
        ? response.status
        : 502;
      return {
        statusCode,
        headers: {
          "cache-control": "no-store",
          ...(response.headers.get("retry-after")
            ? { "retry-after": response.headers.get("retry-after") }
            : {}),
        },
        body: statusCode === 404 ? "Event not found" : "Catalog unavailable",
      };
    }
    const metadata = publicEventShareSchema.parse(await response.json());
    const title = `${metadata.eventTitle} \u2013 ${metadata.orgName}`;
    const desc = safeSlice(
      metadata.eventDescription ||
        metadata.orgDescription ||
        "Infos et billets.",
      160,
    );
    const ogImage = metadata.bannerUrl || `${baseUrl}/og/default.jpg`;

    const targetUrl = `${baseUrl}/o/${encodeURIComponent(orgSlug)}/e/${encodeURIComponent(eventSlug)}/billets`;
    const shareUrl = `${baseUrl}/share/o/${encodeURIComponent(orgSlug)}/e/${encodeURIComponent(eventSlug)}`;

    const bot = isMetaBot(event.headers);

    // ✅ Meta/Facebot : on évite la redirection automatique (sinon il “suit” et perd les OG)
    const redirectTags = bot
      ? ""
      : `
<meta http-equiv="refresh" content="0;url=${esc(targetUrl)}"/>
<script>window.location.replace(${JSON.stringify(targetUrl)});</script>
`;

    const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<link rel="canonical" href="${esc(targetUrl)}"/>

<meta property="og:type" content="website"/>
<meta property="og:site_name" content="Eventflow"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:url" content="${esc(shareUrl)}"/>
<meta property="og:image" content="${esc(ogImage)}"/>
<meta property="og:image:secure_url" content="${esc(ogImage)}"/>
<meta property="og:image:type" content="image/jpeg"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>

<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(desc)}"/>
<meta name="twitter:image" content="${esc(ogImage)}"/>

${redirectTags}
</head>
<body>${bot ? "OK" : "Redirecting…"}</body>
</html>`;

    const len = Buffer.byteLength(html, "utf8");

    return {
      statusCode: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(len),
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
        pragma: "no-cache",
        expires: "0",
        "x-robots-tag": "noindex",
        "x-ef-share": "1",
      },
      body: html,
    };
  } catch (e) {
    return { statusCode: 500, body: "Server error" };
  }
};
