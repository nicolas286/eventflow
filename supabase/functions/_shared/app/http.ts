import {
  createCors,
  createJsonResponse,
  createRequestGuard,
} from "../modules/http/mod.ts";
import { getAllowedOrigins } from "./config/allowed-origins.ts";

const cors = createCors({
  allowedOrigins: getAllowedOrigins(),
});

export const getCorsHeaders = cors.getHeaders;
export const json = createJsonResponse(cors.getHeaders);
export const handleCorsAndMethod = createRequestGuard({
  getCorsHeaders: cors.getHeaders,
  json,
});
