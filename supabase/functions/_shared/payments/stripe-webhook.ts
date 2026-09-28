export type StripeWebhookEvent = {
  id: string;
  type: string;
  account?: string | null;
  livemode?: boolean;
  data: {
    object: Record<string, unknown>;
  };
};

function parseSignatureHeader(header: string) {
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t") timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }

  return { timestamp, signatures };
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }

  return diff === 0;
}

export async function verifyStripeWebhook(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  options: { toleranceSeconds?: number; nowSeconds?: number } = {},
): Promise<StripeWebhookEvent> {
  if (!signatureHeader || !secret) throw new Error("STRIPE_SIGNATURE_MISSING");

  const { timestamp, signatures } = parseSignatureHeader(signatureHeader);
  if (!timestamp || signatures.length === 0) {
    throw new Error("STRIPE_SIGNATURE_INVALID");
  }

  const toleranceSeconds = options.toleranceSeconds ?? 300;
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new Error("STRIPE_SIGNATURE_EXPIRED");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const expected = toHex(digest);

  if (
    !signatures.some((signature) => constantTimeEquals(signature, expected))
  ) {
    throw new Error("STRIPE_SIGNATURE_INVALID");
  }

  const event = JSON.parse(rawBody) as Partial<StripeWebhookEvent>;
  if (
    typeof event.id !== "string" ||
    typeof event.type !== "string" ||
    typeof event.data !== "object" ||
    event.data === null ||
    typeof event.data.object !== "object" ||
    event.data.object === null
  ) {
    throw new Error("STRIPE_EVENT_INVALID");
  }

  return event as StripeWebhookEvent;
}
