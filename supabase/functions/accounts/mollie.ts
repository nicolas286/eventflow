import { z } from "zod";

const mollieSubscriptionSchema = z.object({
  id: z.string().optional(),
  status: z.string().optional(),
});

type MollieCancelFailure = {
  ok: false;
  error:
    | "MOLLIE_SUB_404_WRONG_MAPPING"
    | "MOLLIE_SUB_FETCH_FAILED"
    | "MOLLIE_SUB_ID_MISMATCH"
    | "MOLLIE_CANCEL_404_AFTER_GET"
    | "MOLLIE_CANCEL_SUB_FAILED";
  details?: string;
};

export type MollieCancelResult =
  | { ok: true; alreadyCanceled: boolean }
  | MollieCancelFailure;

async function requestMollie(
  url: string,
  mollieKey: string,
  init: RequestInit,
) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${mollieKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const rawText = await response.text().catch(() => "");
  let data: z.infer<typeof mollieSubscriptionSchema> | null = null;
  try {
    const parsed = rawText
      ? mollieSubscriptionSchema.safeParse(JSON.parse(rawText))
      : null;
    data = parsed?.success ? parsed.data : null;
  } catch {
    data = null;
  }

  return { response, data, rawText };
}

async function getExistingSubscription(params: {
  mollieKey: string;
  customerId: string;
  subscriptionId: string;
}): Promise<{ ok: true; status: string | null } | MollieCancelFailure> {
  const { mollieKey, customerId, subscriptionId } = params;
  const { response, data, rawText } = await requestMollie(
    `https://api.mollie.com/v2/customers/${customerId}/subscriptions/${subscriptionId}`,
    mollieKey,
    { method: "GET" },
  );

  if (response.status === 404) {
    return {
      ok: false,
      error: "MOLLIE_SUB_404_WRONG_MAPPING",
      details: rawText,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: "MOLLIE_SUB_FETCH_FAILED",
      details: rawText,
    };
  }
  if (!data?.id || data.id !== subscriptionId) {
    return { ok: false, error: "MOLLIE_SUB_ID_MISMATCH" };
  }

  return { ok: true, status: data.status ?? null };
}

export async function cancelMollieSubscription(params: {
  mollieKey: string;
  customerId: string;
  subscriptionId: string;
}): Promise<MollieCancelResult> {
  const existing = await getExistingSubscription(params);
  if (!existing.ok) return existing;

  const terminalStatuses = new Set([
    "canceled",
    "cancelled",
    "completed",
    "terminated",
  ]);
  if (terminalStatuses.has((existing.status ?? "").toLowerCase())) {
    return { ok: true, alreadyCanceled: true };
  }

  const { response, rawText } = await requestMollie(
    `https://api.mollie.com/v2/customers/${params.customerId}/subscriptions/${params.subscriptionId}`,
    params.mollieKey,
    { method: "DELETE" },
  );
  if (response.status === 404) {
    return {
      ok: false,
      error: "MOLLIE_CANCEL_404_AFTER_GET",
      details: rawText,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: "MOLLIE_CANCEL_SUB_FAILED",
      details: rawText,
    };
  }

  return { ok: true, alreadyCanceled: false };
}
