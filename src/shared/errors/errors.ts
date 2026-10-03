/* eslint-disable @typescript-eslint/no-explicit-any */

import type { PostgrestError } from "@supabase/supabase-js";
import { z } from "zod";
import { humanBusinessMessage } from "./businessErrorMessages";
import { EdgeRequestError, humanEdgeRequestMessage } from "./edgeRequestError";
import {
  isEmailRateLimitMessage,
  humanEmailRateLimitMessage,
} from "./emailRateLimit";

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "NETWORK"
  | "UNKNOWN";

export interface AppErrorShape {
  code: AppErrorCode;
  message: string;
  cause?: unknown;
  meta?: Record<string, unknown>;
}

export class AppError extends Error implements AppErrorShape {
  code: AppErrorCode;
  cause?: unknown;
  meta?: Record<string, unknown>;

  constructor(params: AppErrorShape) {
    super(params.message);
    this.name = "AppError";
    this.code = params.code;
    this.cause = params.cause;
    this.meta = params.meta;
  }
}

const APP_ERROR_CODES = new Set<AppErrorCode>([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "CONFLICT",
  "NETWORK",
  "UNKNOWN",
]);

export function isAppError(err: unknown): err is AppError {
  if (err instanceof AppError) return true;

  if (typeof err !== "object" || err === null) return false;

  const anyErr = err as any;

  return (
    anyErr.name === "AppError" &&
    typeof anyErr.message === "string" &&
    typeof anyErr.code === "string" &&
    APP_ERROR_CODES.has(anyErr.code)
  );
}


function looksLikeNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) {
    if (/Failed to fetch/i.test(e.message)) return true;
    if (/NetworkError/i.test(e.message)) return true;
  }

  if (typeof e === "object" && e !== null && "name" in e && (e as any).name === "AbortError") {
    return true;
  }

  return false;
}

function isPostgrestError(e: unknown): e is PostgrestError {
  return (
    typeof e === "object" &&
    e !== null &&
    "message" in e &&
    typeof (e as any).message === "string" &&
    "details" in e &&
    "hint" in e &&
    "code" in e
  );
}

function mapRpcMessageToAppCode(msg: string): AppErrorCode | null {
  const m = msg.trim();

  if (m === "NOT_AUTHENTICATED" || /NOT_AUTHENTICATED/i.test(m)) return "UNAUTHENTICATED";
  if (m === "FORBIDDEN" || /FORBIDDEN/i.test(m)) return "FORBIDDEN";
  if (m === "NOT_FOUND" || /NOT_FOUND/i.test(m)) return "NOT_FOUND";

  if (m === "EVENT_MISMATCH") return "VALIDATION";
  if (m === "TICKET_NOT_FOUND") return "NOT_FOUND";
  if (m === "TICKET_CANCELLED") return "VALIDATION";
  if (m === "TICKET_INVALID") return "VALIDATION";

  if (/^PLAN_LIMIT\b/i.test(m)) return "FORBIDDEN";
  if (/VALIDATION_ERROR/i.test(m) || /VALIDATION\b/i.test(m)) return "VALIDATION";
  if (/CONFLICT/i.test(m)) return "CONFLICT";

  return null;
}


function stripRpcPrefix(raw: string) {
  return raw
    .replace(/^VALIDATION_ERROR:\s*/i, "")
    .replace(/^PLAN_LIMIT:\s*/i, "")
    .trim();
}




type SupabaseAuthErrorLike = {
  message: string;
  code?: string;
  status?: number;
};

function isSupabaseAuthError(e: unknown): e is SupabaseAuthErrorLike {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as any).message === "string" &&
    (
      typeof (e as any).code === "string" ||
      typeof (e as any).status === "number"
    )
  );
}

function mapAuthToAppError(e: SupabaseAuthErrorLike) {
  const code = (e.code || "").toLowerCase();
  const msg = e.message.toLowerCase();

  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) {
    return { code: "UNAUTHENTICATED" as const, message: "Email ou mot de passe incorrect." };
  }

  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) {
    return { code: "FORBIDDEN" as const, message: "Ton email n’a pas encore été confirmé." };
  }

  if (code === "user_already_exists" || msg.includes("user already registered")) {
    return { code: "CONFLICT" as const, message: "Un compte existe déjà avec cet email." };
  }
    if (code === "over_email_send_rate_limit" || isEmailRateLimitMessage(e.message)) {
    return { code: "NETWORK" as const, message: humanEmailRateLimitMessage() };
  }

  return null;
}


function mapSqlStateToAppCode(sqlState: string | null | undefined): AppErrorCode {
  if (!sqlState) return "UNKNOWN";

  if (sqlState === "23505") return "CONFLICT"; // unique_violation
  if (sqlState === "23503") return "CONFLICT"; // foreign_key_violation
  if (sqlState === "23502") return "VALIDATION"; // not_null_violation
  if (sqlState === "23514") return "VALIDATION"; // check_violation
  if (sqlState === "22P02") return "VALIDATION"; // invalid_text_representation
  if (sqlState === "42501") return "FORBIDDEN"; // insufficient_privilege

  return "UNKNOWN";
}

function humanStorageMessage(code: AppErrorCode, fallback: string) {
  if (code === "UNAUTHENTICATED") return "Tu dois être connecté.";
  if (code === "FORBIDDEN") return "Accès refusé.";
  if (code === "NOT_FOUND") return "Fichier introuvable.";
  if (code === "CONFLICT") return "Conflit : fichier déjà existant.";
  if (code === "VALIDATION") return "Requête invalide.";
  return fallback;
}


function humanDbMessage(pe: PostgrestError, fallbackMessage: string): string {
  const sql = pe.code;

  if (sql === "23505") return "Déjà existant : impossible de créer un doublon.";
  if (sql === "23503") return "Référence invalide : une ressource liée n’existe pas.";
  if (sql === "23502" || sql === "23514" || sql === "22P02")
    return "Données invalides. Vérifie les champs et réessaie.";
  if (sql === "42501") return "Accès refusé.";

  return fallbackMessage;
}

type StorageErrorLike = {
  message?: unknown;
  statusCode?: unknown;
  error?: unknown;
  name?: unknown;
};

function isStorageErrorLike(e: unknown): e is StorageErrorLike {
  if (typeof e !== "object" || e === null) return false;
  return "message" in e || "statusCode" in e || "error" in e;
}

function storageRawMessage(e: StorageErrorLike): string {
  return (
    (typeof e.message === "string" && e.message) ||
    (typeof e.error === "string" && e.error) ||
    ""
  );
}

function mapStorageToAppCode(e: StorageErrorLike): AppErrorCode {
  const msg = storageRawMessage(e).toLowerCase();
  const status =
    typeof e.statusCode === "number"
      ? e.statusCode
      : typeof e.statusCode === "string"
        ? Number(e.statusCode)
        : NaN;

  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 400) return "VALIDATION";

  if (/unauthorized|jwt|token/i.test(msg)) return "UNAUTHENTICATED";
  if (/forbidden|permission|not\s*allowed/i.test(msg)) return "FORBIDDEN";
  if (/not\s*found|no\s*such/i.test(msg)) return "NOT_FOUND";
  if (/already\s*exists|duplicate|exists|conflict/i.test(msg)) return "CONFLICT";
  if (/invalid|bad\s*request/i.test(msg)) return "VALIDATION";

  return "UNKNOWN";
}

type IdbErrorLike = {
  name?: unknown;
  message?: unknown;
};

function isDomExceptionLike(e: unknown): e is IdbErrorLike {
  return (
    typeof e === "object" &&
    e !== null &&
    "name" in e &&
    typeof (e as any).name === "string"
  );
}

function mapIdbToAppCode(name: string): AppErrorCode {
  if (name === "QuotaExceededError") return "CONFLICT";
  if (name === "NotFoundError") return "NOT_FOUND";
  if (name === "InvalidStateError") return "VALIDATION";
  if (name === "DataError") return "VALIDATION";
  if (name === "TypeMismatchError") return "VALIDATION";
  if (name === "SecurityError") return "FORBIDDEN";
  if (name === "AbortError") return "NETWORK";
  return "UNKNOWN";
}

type FunctionsErrorLike = {
  name?: unknown;
  message?: unknown;
  context?: unknown; // { status, body }
};

function isFunctionsErrorLike(e: unknown): e is FunctionsErrorLike {
  return typeof e === "object" && e !== null && ("context" in e || "name" in e || "message" in e);
}

function getFnStatus(e: FunctionsErrorLike): number | null {
  const ctx = (e as Record<string, unknown>).context as Record<string, unknown> | undefined;
  const status = ctx?.status;
  return typeof status === "number" ? status : null;
}

function getFnBodyText(e: FunctionsErrorLike): string | null {
  const ctx = (e as any)?.context;
  const body = ctx?.body;

  if (typeof body === "string") {
  try {
    const parsed = JSON.parse(body);

    if (parsed && typeof parsed === "object") {
      return (
        (typeof parsed.message === "string" && parsed.message) ||
        (typeof parsed.error === "string" && parsed.error) ||
        (typeof parsed.details === "string" && parsed.details) ||
        body
      );
    }
  } catch {
    // body string classique
  }

  return body;
}

  // body objet (souvent déjà parsé)
  if (body && typeof body === "object") {
    const msg =
      (typeof body.message === "string" && body.message) ||
      (typeof body.error === "string" && body.error) ||
      (typeof body.details === "string" && body.details) ||
      null;

    if (msg) return msg;

    try {
      const s = JSON.stringify(body);
      return s === "{}" ? null : s;
    } catch {
      return null;
    }
  }

  // sinon, on tente le message global (celui que tu vois)
  if (typeof (e as any).message === "string") return (e as any).message;

  return null;
}

function mapHttpStatusToAppCode(status: number | null): AppErrorCode {
  if (!status) return "UNKNOWN";
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 400 || status === 422) return "VALIDATION";
  if (status >= 500) return "NETWORK"; // serveur / gateway down → côté UX c’est “réessaie”
  return "UNKNOWN";
}

function sanitizeRawMessage(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  if (t === "{}") return null;               // ✅ le cas qui te plombe
  if (t === "null" || t === "undefined") return null;
  return t;
}


export function normalizeError(e: unknown, fallbackMessage: string): AppError {
  if (isAppError(e)) return e;

  if (e instanceof EdgeRequestError) {
    return new AppError({
      code: "NETWORK",
      message: humanEdgeRequestMessage(e),
      meta: { kind: "functions", status: e.status, retryAfterSeconds: e.retryAfterSeconds },
    });
  }

  // ✅ Zod
  if (e instanceof z.ZodError) {
    const first = e.issues?.[0];

    return new AppError({
      code: "VALIDATION",
      message: first?.message ?? fallbackMessage,
      cause: e,
      meta: {
        kind: "zod",
        field: first?.path?.[0] ? String(first.path[0]) : null,
        issues: e.issues,
      },
    });
  }

  if (looksLikeNetworkError(e)) {
    return new AppError({
      code: "NETWORK",
      message:
        "Une erreur temporaire de connexion est survenue. Réessayez dans quelques instants.",
      cause: e,
    });
  }

     if (isSupabaseAuthError(e)) {
    const mapped = mapAuthToAppError(e);
    if (mapped) {
      return new AppError({
        ...mapped,
        cause: e,
        meta: { kind: "auth", rawCode: (e as any).code ?? null, rawMessage: e.message },
      });
    }
  }

    if (isFunctionsErrorLike(e)) {
    const status = getFnStatus(e);

let raw =
  getFnBodyText(e) ??
  (typeof (e as any).message === "string" ? (e as any).message : null);

raw = sanitizeRawMessage(raw);

const rpcCode = raw ? mapRpcMessageToAppCode(raw) : null;
const code = rpcCode ?? mapHttpStatusToAppCode(status);

const business = raw ? humanBusinessMessage(raw) : null;
const cleaned = raw ? stripRpcPrefix(raw) : "";

const message = business ?? (rpcCode ? cleaned : (raw ?? fallbackMessage));

return new AppError({
  code,
  message,
  cause: e,
  meta: { kind: "functions", status, rawMessage: raw },
});
  }


   if (isPostgrestError(e)) {
  const rpcCode = mapRpcMessageToAppCode(e.message);
const code = rpcCode ?? mapSqlStateToAppCode(e.code);

const business = humanBusinessMessage(e.message);
const cleaned = stripRpcPrefix(e.message);

const message =
  business ??
  (rpcCode ? cleaned : humanDbMessage(e, fallbackMessage));



  return new AppError({
    code,
    message,
    cause: e,
    meta: {
      kind: "postgrest",
      sqlstate: e.code ?? null,
      rawMessage: e.message,
      details: e.details ?? null,
      hint: e.hint ?? null,
    },
  });
}



  if (isStorageErrorLike(e)) {
    const code = mapStorageToAppCode(e);
    return new AppError({
      code,
      message: humanStorageMessage(code, fallbackMessage),
      cause: e,
      meta: {
        kind: "storage",
        statusCode: (e as any).statusCode ?? null,
        rawMessage: storageRawMessage(e) || null,
      },
    });
  }

  if (e instanceof Error) {
    const raw = sanitizeRawMessage(e.message);

    const rpcCode = raw ? mapRpcMessageToAppCode(raw) : null;
    const business = raw ? humanBusinessMessage(raw) : null;
    const cleaned = raw ? stripRpcPrefix(raw) : "";

    return new AppError({
      code: rpcCode ?? "UNKNOWN",
      message: business ?? (rpcCode ? cleaned : raw ?? fallbackMessage),
      cause: e,
      meta: {
        kind: "error",
        rawMessage: raw,
      },
    });
  }

  if (isDomExceptionLike(e)) {
    const name = String((e as any).name);
    const code = mapIdbToAppCode(name);

    return new AppError({
      code,
      message: fallbackMessage,
      cause: e,
      meta: {
        kind: "idb",
        domName: name,
        rawMessage: typeof (e as any).message === "string" ? (e as any).message : null,
      },
    });
  }





  return new AppError({
    code: "UNKNOWN",
    message: fallbackMessage,
    cause: e,
  });
}
