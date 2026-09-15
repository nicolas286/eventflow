import { assertMollieApiKey } from "../_shared/environment-safety.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}
async function parseWebhookId(req) {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const b = await req.json().catch(()=>null);
    return b?.id ?? null;
  }
  const text = await req.text();
  const params = new URLSearchParams(text);
  return params.get("id");
}
function addMonthsISO(dateIso, months) {
  const d = new Date(dateIso);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d.toISOString();
}
/* ---------------- Mollie helpers ---------------- */ async function mollieGet(mollieKey, url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${mollieKey}`
    }
  });
  const txt = await res.text().catch(()=>"");
  let data = null;
  try {
    data = txt ? JSON.parse(txt) : null;
  } catch  {
    data = txt;
  }
  return {
    res,
    data,
    rawText: txt
  };
}
function listItems(listResp) {
  const emb = listResp?._embedded;
  if (!emb) return [];
  const firstKey = Object.keys(emb)[0];
  const items = emb?.[firstKey];
  return Array.isArray(items) ? items : [];
}
function extractIdFromHref(href, prefix) {
  const s = typeof href === "string" ? href : "";
  const m = s.match(new RegExp(`(${prefix}_[a-zA-Z0-9]+)`));
  return m?.[1] ?? null;
}
function getPaymentIdsFromPay(pay) {
  const subscriptionId = pay?.subscriptionId ?? extractIdFromHref(pay?._links?.subscription?.href, "sub") ?? null;
  const customerId = pay?.customerId ?? extractIdFromHref(pay?._links?.customer?.href, "cst") ?? null;
  return {
    subscriptionId,
    customerId
  };
}
function scorePayments(payments) {
  return payments.map((p)=>{
    const status = String(p?.status ?? "").toLowerCase();
    const seq = String(p?.sequenceType ?? "").toLowerCase();
    const ts = (p?.paidAt ? Date.parse(String(p.paidAt)) : NaN) || (p?.createdAt ? Date.parse(String(p.createdAt)) : NaN) || 0;
    return {
      p,
      status,
      seq,
      ts
    };
  }).sort((a, b)=>(b.ts ?? 0) - (a.ts ?? 0));
}
function isFinalBadStatus(st) {
  return [
    "failed",
    "canceled",
    "cancelled",
    "expired"
  ].includes(st);
}
/* ---------------- Handler ---------------- */ Deno.serve(async (req)=>{
  try {
    if (req.method !== "POST") return json({
      error: "Method not allowed"
    }, 405);
    const mollieKey = Deno.env.get("MOLLIE_API_KEY");
    assertMollieApiKey(mollieKey);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!mollieKey || !supabaseUrl || !serviceKey) {
      return json({
        error: "Server misconfigured"
      }, 500);
    }
    const hookId = await parseWebhookId(req);
    if (!hookId) return json({
      ok: true,
      ignored: true,
      reason: "missing_id"
    }, 200);
    const admin = createClient(supabaseUrl, serviceKey);
    // -------------------------------
    // 0) Normalize: accept sub_ OR tr_
    // -------------------------------
    let subscriptionId = null;
    let customerId = null;
    let paymentFromHook = null;
    if (hookId.startsWith("tr_")) {
      const payFetch = await mollieGet(mollieKey, `https://api.mollie.com/v2/payments/${hookId}`);
      if (!payFetch.res.ok) {
        console.error("[sub-webhook] fetch payment failed", payFetch.rawText);
        return json({
          ok: false,
          retry: true,
          reason: "mollie_fetch_payment_failed"
        }, 500);
      }
      paymentFromHook = payFetch.data;
      const ids = getPaymentIdsFromPay(paymentFromHook);
      subscriptionId = ids.subscriptionId;
      customerId = ids.customerId;
      console.error("[sub-webhook] hook=tr_", {
        hookId,
        payId: paymentFromHook?.id,
        status: paymentFromHook?.status,
        sequenceType: paymentFromHook?.sequenceType,
        subscriptionId,
        customerId,
        meta: paymentFromHook?.metadata
      });
      if (!subscriptionId) {
        // pas un paiement d'abonnement → on ignore
        return json({
          ok: true,
          ignored: true,
          reason: "payment_has_no_subscription_id"
        }, 200);
      }
    } else if (hookId.startsWith("sub_")) {
      subscriptionId = hookId;
      console.error("[sub-webhook] hook=sub_", {
        subscriptionId
      });
    } else {
      console.error("[sub-webhook] unknown hook id", hookId);
      return json({
        ok: true,
        ignored: true,
        reason: "unknown_id_format"
      }, 200);
    }
    // -------------------------------
    // 1) DB lookup mapping by subscriptionId
    // -------------------------------
    const { data: srow, error: sErr } = await admin.from("subscriptions").select("org_id, mollie_customer_id").eq("mollie_subscription_id", subscriptionId).maybeSingle();
    if (sErr || !srow?.org_id) {
      // webhook peut arriver avant persistance DB → retry
      console.error("[sub-webhook] org not found yet -> retry", {
        subscriptionId,
        sErr: sErr?.message
      });
      return json({
        ok: false,
        retry: true,
        reason: "org_not_found_for_subscription"
      }, 500);
    }
    const orgId = srow.org_id;
    // customerId: prefer Mollie payload, else DB
    customerId = customerId ?? srow.mollie_customer_id ?? null;
    if (!customerId) {
      console.error("[sub-webhook] customer_id missing -> retry", {
        orgId,
        subscriptionId
      });
      return json({
        ok: false,
        retry: true,
        reason: "customer_id_missing"
      }, 500);
    }
    // -------------------------------
    // 2) fetch subscription -> apply state
    // -------------------------------
    let periodEnd = null;
    const subFetch = await mollieGet(mollieKey, `https://api.mollie.com/v2/customers/${customerId}/subscriptions/${subscriptionId}`);
    if (!subFetch.res.ok) {
      console.error("[sub-webhook] fetch subscription failed -> retry", subFetch.rawText);
      return json({
        ok: false,
        retry: true,
        reason: "mollie_fetch_subscription_failed"
      }, 500);
    }
    const sub = subFetch.data;
    const subStatus = String(sub?.status ?? "pending").toLowerCase();
    periodEnd = sub?.nextPaymentDate ? new Date(String(sub.nextPaymentDate)).toISOString() : null;
    const { error: applyErr } = await admin.rpc("apply_subscription_state", {
      p_org_id: orgId,
      p_provider: "mollie",
      p_customer_id: customerId,
      p_subscription_id: subscriptionId,
      p_status: subStatus,
      p_current_period_end: periodEnd,
      p_raw: sub
    });
    if (applyErr) console.error("[sub-webhook] apply_subscription_state failed", applyErr);
    // -------------------------------
    // 3) pick payment to invoice (paid, not first, not already invoiced)
    // -------------------------------
    // Case A: webhook is tr_ -> we prefer that exact payment
    if (paymentFromHook) {
      const st = String(paymentFromHook?.status ?? "").toLowerCase();
      const seq = String(paymentFromHook?.sequenceType ?? "").toLowerCase();
      const pid = String(paymentFromHook?.id ?? "");
      // on ne facture jamais le "first" ici
      if (seq === "first") {
        return json({
          ok: true,
          ignored: true,
          reason: "sequence_first_not_invoiced_here",
          paymentId: pid
        }, 200);
      }
      if (!pid) return json({
        ok: false,
        retry: true,
        reason: "payment_id_missing"
      }, 500);
      if ([
        "open",
        "pending"
      ].includes(st)) return json({
        ok: false,
        retry: true,
        reason: `status_${st}`
      }, 500);
      if (isFinalBadStatus(st)) return json({
        ok: true,
        invoiced: false,
        reason: `final_status_${st}`
      }, 200);
      if (st !== "paid") return json({
        ok: false,
        retry: true,
        reason: `unhandled_status_${st}`
      }, 500);
      // déjà facturé ?
      const { data: already } = await admin.from("invoices").select("id").eq("mollie_payment_id", pid).maybeSingle();
      if (already?.id) {
        return json({
          ok: true,
          reused: true,
          reason: "already_invoiced",
          invoiceId: already.id,
          paymentId: pid
        }, 200);
      }
      // facture
      const computedPeriodEnd = periodEnd ?? (paymentFromHook?.paidAt ? new Date(String(paymentFromHook.paidAt)).toISOString() : null);
      const computedPeriodStart = computedPeriodEnd ? addMonthsISO(computedPeriodEnd, -1) : null;
      const { data: invoice, error: invErr } = await admin.rpc("rpc_create_invoice_from_mollie_payment", {
        p_input: {
          org_id: orgId,
          mollie_payment_id: pid,
          mollie_subscription_id: subscriptionId,
          currency: paymentFromHook?.amount?.currency ?? "EUR",
          total_value: paymentFromHook?.amount?.value ?? null,
          paid_at: paymentFromHook?.paidAt ? new Date(String(paymentFromHook.paidAt)).toISOString() : new Date().toISOString(),
          period_start: computedPeriodStart,
          period_end: computedPeriodEnd,
          raw: paymentFromHook
        }
      });
      if (invErr) {
        console.error("[sub-webhook] invoice rpc failed -> retry", invErr);
        return json({
          ok: false,
          retry: true,
          reason: "invoice_rpc_failed"
        }, 500);
      }
      const invoiceId = invoice?.id ?? null;
      if (invoiceId) {
        admin.functions.invoke("generate-invoice-pdf", {
          body: {
            invoice_id: invoiceId
          }
        }).catch(console.error);
        admin.functions.invoke("send-invoice-to-billit", {
          body: {
            invoice_id: invoiceId
          }
        }).catch(console.error);
      }
      return json({
        ok: true,
        orgId,
        subscriptionId,
        paymentId: pid,
        invoiced: Boolean(invoiceId),
        invoiceId
      }, 200);
    }
    // Case B: webhook is sub_ -> list payments and pick best candidate
    const payList = await mollieGet(mollieKey, `https://api.mollie.com/v2/customers/${customerId}/subscriptions/${subscriptionId}/payments?limit=20`);
    if (!payList.res.ok) {
      console.error("[sub-webhook] cannot list subscription payments -> retry", payList.rawText);
      return json({
        ok: false,
        retry: true,
        reason: "cannot_list_subscription_payments"
      }, 500);
    }
    const items = listItems(payList.data);
    const scored = scorePayments(items);
    // check what is already invoiced (batch)
    const ids = scored.map((x)=>String(x.p?.id ?? "")).filter(Boolean);
    const { data: existingInvoices, error: invReadErr } = await admin.from("invoices").select("mollie_payment_id").in("mollie_payment_id", ids.length ? ids : [
      "__none__"
    ]);
    if (invReadErr) {
      console.error("[sub-webhook] invoices lookup failed -> retry", invReadErr);
      return json({
        ok: false,
        retry: true,
        reason: "invoice_lookup_failed"
      }, 500);
    }
    const invoicedSet = new Set((existingInvoices ?? []).map((r)=>String(r.mollie_payment_id)));
    const candidate = scored.find(({ p, status, seq })=>{
      const pid = String(p?.id ?? "");
      if (!pid) return false;
      if (invoicedSet.has(pid)) return false;
      if (seq === "first") return false;
      return status === "paid";
    });
    if (!candidate) {
      console.error("[sub-webhook] no paid recurring payment not invoiced yet -> retry", {
        orgId,
        subscriptionId,
        totalPaymentsSeen: scored.length,
        invoicedKnown: invoicedSet.size
      });
      return json({
        ok: false,
        retry: true,
        reason: "no_invoice_candidate_yet"
      }, 500);
    }
    const pay = candidate.p;
    const paymentId = String(pay?.id ?? "");
    const computedPeriodEnd = periodEnd ?? (pay?.paidAt ? new Date(String(pay.paidAt)).toISOString() : null);
    const computedPeriodStart = computedPeriodEnd ? addMonthsISO(computedPeriodEnd, -1) : null;
    const { data: invoice, error: invErr } = await admin.rpc("rpc_create_invoice_from_mollie_payment", {
      p_input: {
        org_id: orgId,
        mollie_payment_id: paymentId,
        mollie_subscription_id: subscriptionId,
        currency: pay?.amount?.currency ?? "EUR",
        total_value: pay?.amount?.value ?? null,
        paid_at: pay?.paidAt ? new Date(String(pay.paidAt)).toISOString() : new Date().toISOString(),
        period_start: computedPeriodStart,
        period_end: computedPeriodEnd,
        raw: pay
      }
    });
    if (invErr) {
      console.error("[sub-webhook] invoice rpc failed -> retry", invErr);
      return json({
        ok: false,
        retry: true,
        reason: "invoice_rpc_failed"
      }, 500);
    }
    const invoiceId = invoice?.id ?? null;
    if (invoiceId) {
      admin.functions.invoke("generate-invoice-pdf", {
        body: {
          invoice_id: invoiceId
        }
      }).catch(console.error);
      admin.functions.invoke("send-invoice-to-billit", {
        body: {
          invoice_id: invoiceId
        }
      }).catch(console.error);
    }
    return json({
      ok: true,
      orgId,
      subscriptionId,
      paymentId,
      invoiced: Boolean(invoiceId),
      invoiceId
    }, 200);
  } catch (e) {
    console.error("[sub-webhook] unexpected", e);
    return json({
      ok: false,
      retry: true,
      reason: "unexpected"
    }, 500);
  }
});
