// netlify/functions/share-event.js
const { createClient } = require("@supabase/supabase-js");

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
  const ua = String(headers?.["user-agent"] || headers?.["User-Agent"] || "").toLowerCase();
  return ua.includes("facebookexternalhit") || ua.includes("facebot");
}

exports.handler = async (event) => {
  try {
    // /share/o/:orgSlug/e/:eventSlug
    const path = event.path || "";
    const m = path.match(/^\/share\/o\/([^/]+)\/e\/([^/]+)\/?$/);
    const orgSlug = m?.[1];
    const eventSlug = m?.[2];

    if (!orgSlug || !eventSlug) {
      return { statusCode: 400, body: "Missing params" };
    }

    if (!process.env.PUBLIC_BASE_URL) return { statusCode: 500, body: "Missing public URL" };
    const baseUrl = new URL(process.env.PUBLIC_BASE_URL).origin;
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnon) {
      return { statusCode: 500, body: "Missing Supabase env" };
    }

    const supabase = createClient(supabaseUrl, supabaseAnon);

    // 1) org via RPC public
    const { data: org, error: orgErr } = await supabase.rpc("get_public_org_by_slug", {
      p_slug: orgSlug,
    });
    if (orgErr || !org) return { statusCode: 404, body: "Org not found" };

    // 2) events overview via RPC public
    const { data: overview, error: ovErr } = await supabase.rpc("get_public_org_events_overview", {
      p_org_slug: orgSlug,
    });
    if (ovErr || !overview) return { statusCode: 404, body: "Events not found" };

    // ⚠️ adapte si ta shape est différente
    const events = overview?.events ?? overview?.data?.events ?? [];
    const ev = Array.isArray(events) ? events.find((x) => String(x?.slug) === eventSlug) : null;
    if (!ev) return { statusCode: 404, body: "Event not found" };

    const orgName = org?.name ?? "Eventflow";
    const orgDesc = org?.description ?? "";

    const evTitle = ev?.title ?? "Événement";
    const evDesc = ev?.description ?? "";

    const title = `${evTitle} – ${orgName}`;
    const desc = safeSlice(evDesc || orgDesc || "Infos et billets.", 160);

    const ogImage =
      ev?.bannerUrl ||
      ev?.banner_url ||
      org?.bannerUrl ||
      org?.banner_url ||
      `${baseUrl}/og/default.jpg`;

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
