import { handleRegisterTicketsRequest } from "./public/handler.ts";
import { handleAdminOrderRequest } from "./admin/handler.ts";
import { handleReadOrderRequest } from "./read.ts";
import { handleMarkBankTransferPaidRequest } from "./admin/mark-bank-transfer-paid.ts";
import { json } from "../_shared/app/http.ts";
import { handleOrderManagementRequest } from "./admin/management.ts";

export async function handleOrdersRequest(req: Request): Promise<Response> {
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const base = segments.lastIndexOf("orders");
  const path = segments.slice(base + 1);
  if (base < 0) return json(req, { error: "NOT_FOUND" }, 404);
  if (path.length === 0) return await handleRegisterTicketsRequest(req);
  if (path.length === 1 && path[0] === "admin") return await handleAdminOrderRequest(req);
  if (path.length === 2 && path[0] === "admin" && [
    "list", "search", "tickets-search", "participants-export", "participant-update",
    "delete", "bank-summaries", "bank-expire", "tickets-list", "ticket-check-in", "ticket-check-in-qr",
  ].includes(path[1])) return await handleOrderManagementRequest(req);
  if (path.length === 3 && path[0] === "admin" && path[2] === "mark-paid") {
    return await handleMarkBankTransferPaidRequest(req);
  }
  if (path.length === 1) return await handleReadOrderRequest(req);
  return json(req, { error: "NOT_FOUND" }, 404);
}

if (import.meta.main) Deno.serve(handleOrdersRequest);
