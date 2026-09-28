import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
function isValidUuid(v) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
}
function toNonEmpty(v) {
  const s = (v ?? "").trim();
  return s ? s : null;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", {
      headers: corsHeaders,
    });
  if (req.method !== "GET")
    return json(
      {
        error: "Method not allowed",
      },
      405,
    );
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
    if (!supabaseUrl || !serviceKey)
      return json(
        {
          error: "server_misconfigured",
        },
        500,
      );
    const url = new URL(req.url);
    const orderId = url.searchParams.get("orderId");
    const bookingToken = toNonEmpty(
      url.searchParams.get("token") ?? url.searchParams.get("bookingToken"),
    );
    if (!isValidUuid(orderId))
      return json(
        {
          error: "INVALID_ORDER_ID",
        },
        400,
      );
    if (!bookingToken)
      return json(
        {
          error: "MISSING_TOKEN",
        },
        401,
      );
    const admin = createClient(supabaseUrl, serviceKey);
    // ✅ check: order + booking_token match
    const { data: oRow, error: oErr } = await admin
      .from("orders")
      .select("id, status, total_cents, currency")
      .eq("id", orderId)
      .eq("booking_token", bookingToken)
      .maybeSingle();
    if (oErr)
      return json(
        {
          error: "DB_ERROR",
          details: oErr.message,
        },
        500,
      );
    if (!oRow)
      return json(
        {
          error: "NOT_FOUND",
        },
        404,
      );
    // Optionnel: paiement status (sans raw)
    const { data: pRow } = await admin
      .from("payments")
      .select("status")
      .eq("order_id", orderId)
      .eq("is_refund", false)
      .order("created_at", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();
    return json({
      id: oRow.id,
      status: oRow.status,
      totalCents: oRow.total_cents ?? null,
      currency: oRow.currency ?? null,
      paymentStatus: pRow?.status ?? null,
    });
  } catch (e) {
    return json(
      {
        error: "Unexpected error",
        details: String(e),
      },
      500,
    );
  }
});
