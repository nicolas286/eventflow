import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
    },
  });
}
function getAuthHeader(req: Request) {
  // Supabase JS met généralement: Authorization: Bearer <jwt>
  return req.headers.get("authorization") ?? "";
}
function isUuid(v: unknown) {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
}
Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    if (req.method !== "POST")
      return json(
        {
          error: "Method not allowed",
        },
        405,
      );
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey)
      return json(
        {
          error: "CONFIG_MISSING",
        },
        500,
      );
    const authHeader = getAuthHeader(req);
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json(
        {
          error: "UNAUTHORIZED",
        },
        401,
      );
    }
    const body = await req.json().catch(() => null);
    const invoiceId = String(body?.invoice_id ?? "").trim();
    if (!invoiceId || !isUuid(invoiceId))
      return json(
        {
          error: "invoice_id invalid",
        },
        400,
      );
    // Client "user" (RLS + auth.uid() OK)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });
    // Client service (bypass RLS, pour lire invoice et signer url)
    const admin = createClient(supabaseUrl, serviceKey);
    // 1) lire la facture (service role)
    const { data: inv, error: invErr } = await admin
      .from("invoices")
      .select("id, org_id, pdf_path")
      .eq("id", invoiceId)
      .maybeSingle();
    if (invErr)
      return json(
        {
          error: "DB_ERROR",
          details: invErr.message,
        },
        500,
      );
    if (!inv?.id)
      return json(
        {
          error: "NOT_FOUND",
        },
        404,
      );
    // 2) check org membership (via user, en s’appuyant sur auth.uid())
    const { data: isMember, error: memErr } = await userClient.rpc(
      "is_org_member",
      {
        p_org_id: inv.org_id,
      },
    );
    if (memErr)
      return json(
        {
          error: "MEMBERSHIP_CHECK_FAILED",
          details: memErr.message,
        },
        500,
      );
    if (!isMember)
      return json(
        {
          error: "FORBIDDEN",
        },
        403,
      );
    // 3) Les renouvellements créés par pg_cron n'ont pas encore de PDF.
    // On le matérialise au premier téléchargement, après le contrôle d'accès.
    let pdfPath = inv.pdf_path;
    if (!pdfPath) {
      const { error: generateError } = await admin.functions.invoke(
        "generate-invoice-pdf",
        {
          body: {
            invoice_id: invoiceId,
          },
        },
      );
      if (generateError)
        return json(
          {
            error: "PDF_GENERATION_FAILED",
          },
          502,
        );
      const { data: refreshed, error: refreshError } = await admin
        .from("invoices")
        .select("pdf_path")
        .eq("id", invoiceId)
        .maybeSingle();
      if (refreshError || !refreshed?.pdf_path)
        return json(
          {
            error: "PDF_NOT_READY",
          },
          409,
        );
      pdfPath = refreshed.pdf_path;
    }
    // 4) signed url (1-5 minutes, comme tu veux)
    const expiresIn = 120; // 2 min
    const { data: signed, error: signErr } = await admin.storage
      .from("invoices")
      .createSignedUrl(pdfPath, expiresIn);
    if (signErr || !signed?.signedUrl) {
      return json(
        {
          error: "SIGN_FAILED",
          details: signErr?.message ?? "no_signed_url",
        },
        500,
      );
    }
    return json(
      {
        url: signed.signedUrl,
        expiresIn,
      },
      200,
    );
  } catch (e) {
    console.error("[get-invoice-pdf-url]", e);
    return json(
      {
        error: "UNEXPECTED",
      },
      500,
    );
  }
});
