const DEFAULT_REDACTED_KEYS = [
  "apikey",
  "authorization",
  "booking_token",
  "bookingtoken",
  "cookie",
  "password",
  "secret",
  "token",
  "credential",
  "privatekey",
  "servicerolekey",
  "connectionstring",
] as const;

export interface SerializeErrorOptions {
  maxDepth?: number;
  maxEntries?: number;
  maxStringLength?: number;
  redactedKeys?: readonly string[];
}

type NormalizedOptions = Required<SerializeErrorOptions>;

function normalizeOptions(options: SerializeErrorOptions): NormalizedOptions {
  return {
    maxDepth: options.maxDepth ?? 5,
    maxEntries: options.maxEntries ?? 50,
    maxStringLength: options.maxStringLength ?? 4_000,
    redactedKeys: [...DEFAULT_REDACTED_KEYS, ...(options.redactedKeys ?? [])],
  };
}

/** Pattern matching complements field-name redaction; arbitrary unlabelled secrets remain unrecognizable. */
export function redactLogText(value: string): string {
  return value
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
      "[REDACTED]",
    )
    .replace(
      /\b(?:(?:sk|rk)_(?:live|test)_|whsec_|sb_secret_)[A-Za-z0-9_-]+/g,
      "[REDACTED]",
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[REDACTED]",
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 [REDACTED]")
    .replace(
      /(\b(?:[\w-]*(?:secret|token|password|credential)|api[_-]?key|service[_-]?role[_-]?key|authorization|cookie)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s&,;"'}\]]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}

function truncate(value: string, maxLength: number): string {
  const safe = redactLogText(value);
  return safe.length <= maxLength
    ? safe
    : `${safe.slice(0, maxLength)}…[truncated]`;
}

function isRedactedKey(key: string, options: NormalizedOptions): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return options.redactedKeys.some((value) =>
    normalized.includes(value.toLowerCase().replace(/[^a-z0-9]/g, ""))
  );
}

function toSafeValue(
  value: unknown,
  options: NormalizedOptions,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (typeof value === "string") {
    return truncate(value, options.maxStringLength);
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value === "bigint" ||
    typeof value === "symbol" ||
    typeof value === "function"
  ) {
    return typeof value === "function"
      ? "[Function]"
      : truncate(String(value), options.maxStringLength);
  }

  if (depth >= options.maxDepth) return "[MaxDepth]";
  if (value instanceof Error) {
    return serializeErrorValue(value, options, seen, depth);
  }
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, options.maxEntries).map((child) =>
      toSafeValue(child, options, seen, depth + 1)
    );
  }

  const output: Record<string, unknown> = {};

  const entries = value instanceof Headers
    ? Array.from(value.entries())
    : Object.entries(value);
  for (const [key, child] of entries.slice(0, options.maxEntries)) {
    Object.defineProperty(output, truncate(key, options.maxStringLength), {
      enumerable: true,
      configurable: true,
      value: isRedactedKey(key, options)
        ? "[REDACTED]"
        : toSafeValue(child, options, seen, depth + 1),
    });
  }

  return output;
}

function serializeErrorValue(
  error: unknown,
  options: NormalizedOptions,
  seen: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  if (error instanceof Error) {
    if (seen.has(error)) return { message: "[Circular]" };
    seen.add(error);

    return {
      name: truncate(error.name, options.maxStringLength),
      message: truncate(error.message, options.maxStringLength),
      stack: error.stack
        ? truncate(error.stack, options.maxStringLength)
        : undefined,
      cause: error.cause !== undefined && depth < options.maxDepth
        ? serializeErrorValue(error.cause, options, seen, depth + 1)
        : undefined,
    };
  }

  if (typeof error === "object" && error !== null) {
    const object = error as Record<string, unknown>;

    return {
      message: typeof object.message === "string"
        ? truncate(object.message, options.maxStringLength)
        : "Unknown object error",
      code: toSafeValue(object.code ?? null, options, seen, depth),
      details: toSafeValue(object.details ?? null, options, seen, depth),
      hint: toSafeValue(object.hint ?? null, options, seen, depth),
      raw: toSafeValue(object, options, seen, depth),
    };
  }

  return { message: truncate(String(error), options.maxStringLength) };
}

export function serializeError(
  error: unknown,
  options: SerializeErrorOptions = {},
): Record<string, unknown> {
  return serializeErrorValue(
    error,
    normalizeOptions(options),
    new WeakSet(),
    0,
  );
}

export function redactLogData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const safe = toSafeValue(data, normalizeOptions({}), new WeakSet(), 0);
  return typeof safe === "object" && safe !== null
    ? Object.fromEntries(Object.entries(safe))
    : {};
}
