import type { SupabaseClient } from "@supabase/supabase-js";
import { json } from "../_shared/app/http.ts";

function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function expireOrders(req: Request, admin: SupabaseClient) {
  const expected = Deno.env.get("CRON_SECRET")?.trim();
  if (!expected) return json(req, { ok: false, error: "CONFIG_MISSING" }, 500);
  const got = req.headers.get("x-cron-secret")?.trim() ?? "";
  if (!got || !safeEq(got, expected)) {
    return json(req, { ok: false, error: "Unauthorized" }, 401);
  }
  const { data, error } = await admin.rpc("expire_orders", { p_limit: 200 });
  if (error) {
    return json(req, {
      ok: false,
      error: "RPC_EXPIRE_ORDERS_FAILED",
      details: error.message,
    }, 400);
  }
  return json(req, {
    ok: true,
    expiredCount: Array.isArray(data) ? data.length : null,
    data,
  });
}
