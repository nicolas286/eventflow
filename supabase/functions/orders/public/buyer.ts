import type { RegisterPayload } from "./registerTickets.contracts.ts";
export function toNonEmptyString(v: unknown) {
  const s = typeof v === "string" ? v.trim() : String(v ?? "").trim();
  return s ? s : null;
}
export function buildBuyer(body: RegisterPayload) {
  const explicitEmail = toNonEmptyString(body.buyer?.email);
  const explicitName = toNonEmptyString(body.buyer?.name);
  const explicitPhone = toNonEmptyString(body.buyer?.phone);
  if (explicitEmail || explicitName || explicitPhone) {
    return {
      email: explicitEmail,
      name: explicitName,
      phone: explicitPhone,
      is_attendee: typeof body.buyer?.isAttendee === "boolean" ? body.buyer.isAttendee : false
    };
  }
  const legacyEmail = toNonEmptyString(body.buyerEmail);
  return {
    email: legacyEmail,
    name: null,
    phone: null,
    is_attendee: legacyEmail ? true : null
  };
}
