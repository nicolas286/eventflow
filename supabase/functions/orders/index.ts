import { handleRegisterTicketsRequest } from "./public/handler.ts";
import { handleAdminOrderRequest } from "./admin/handler.ts";
import { handleReadOrderRequest } from "./read.ts";
import { json } from "../_shared/app/http.ts";

export async function handleOrdersRequest(req: Request): Promise<Response> {
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const base = segments.lastIndexOf("orders");
  const path = segments.slice(base + 1);
  if (base < 0) return json(req, { error: "NOT_FOUND" }, 404);
  if (path.length === 0) return await handleRegisterTicketsRequest(req);
  if (path.length === 1 && path[0] === "admin") return await handleAdminOrderRequest(req);
  if (path.length === 1) return await handleReadOrderRequest(req);
  return json(req, { error: "NOT_FOUND" }, 404);
}

if (import.meta.main) Deno.serve(handleOrdersRequest);
