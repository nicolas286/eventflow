import { assert, assertEquals, assertRejects } from "@std/assert";
import { generateTicketsPdf } from "../_shared/services/ticket-confirmation/ticketsPdf.ts";
import { buildPdfTickets } from "../_shared/services/ticket-confirmation/db.ts";
import { parseSendReminderMailPayload } from "../_shared/services/order-reminders/sendReminderMail.contracts.ts";
import { ResponseError } from "../_shared/errors.ts";

Deno.test("internal ticket PDF retains QR rendering and tolerates unsupported Unicode", async () => {
  const tickets = buildPdfTickets({
    ticketRows: [{
      id: "ticket",
      product_id: "product",
      order_item_id: "item",
      ticket_index: 1,
      qr_token: "synthetic-qr-token",
      admits_count: 1,
    }],
    attendeeRows: [{ id: "attendee", product_id: "product" }],
    answersByAttendeeId: new Map([["attendee", [{
      key: "first_name",
      label: "Prénom",
      value: "Élodie 🎉",
    }]]]),
    productMetaById: {
      productMetaById: new Map([["product", { createsAttendees: true }]]),
      orderItemMetaById: new Map([["item", {
        productNameSnapshot: "Entrée 🎟",
        unitPriceCents: 1200,
      }]]),
    },
  });
  assertEquals(tickets[0].attendee_summary_lines, ["Prénom : Élodie 🎉"]);
  const pdf = await generateTicketsPdf({
    orderId: "synthetic-order",
    eventTitle: "Événement 🎉",
    startsAt: null,
    location: null,
    currency: "EUR",
    tickets,
  });
  assertEquals(pdf.contentType, "application/pdf");
  assertEquals(pdf.filename, "billets-synthetic-order.pdf");
  assert(atob(pdf.contentBase64).startsWith("%PDF-"));
});

Deno.test("reminder worker retains empty cron body and defaults manual runs to dry-run", async () => {
  assertEquals(
    await parseSendReminderMailPayload(
      new Request("https://edge.test/workers/reminders", { method: "POST" }),
    ),
    { kind: "cron", data: { mode: "cron" } },
  );
  const orderId = "11111111-1111-4111-8111-111111111111";
  assertEquals(
    await parseSendReminderMailPayload(
      new Request("https://edge.test/workers/reminders", {
        method: "POST",
        body: JSON.stringify({ mode: "manual", orderId }),
      }),
    ),
    { kind: "manual", data: { mode: "manual", orderId, debug: true } },
  );
});

Deno.test("reminder worker rejects oversized payloads before parsing", async () => {
  const error = await assertRejects(() =>
    parseSendReminderMailPayload(
      new Request("https://edge.test/workers/reminders", {
        method: "POST",
        body: " ".repeat(4097),
      }),
    )
  );
  assert(error instanceof ResponseError);
  assertEquals(error.status, 413);
  assertEquals(error.code, "PAYLOAD_TOO_LARGE");
});
