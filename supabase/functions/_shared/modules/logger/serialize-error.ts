const DEFAULT_REDACTED_KEYS = [
  "apikey",
  "authorization",
  "booking_token",
  "bookingtoken",
  "cookie",
  "password",
  "secret",
  "token",
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
    redactedKeys: options.redactedKeys ?? DEFAULT_REDACTED_KEYS,
  };
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength)}…[truncated]`;
}

function isRedactedKey(key: string, options: NormalizedOptions): boolean {
  const normalized = key.toLowerCase();
  return options.redactedKeys.some((value) =>
    normalized.includes(value.toLowerCase())
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
    return String(value);
  }

  if (depth >= options.maxDepth) return "[MaxDepth]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, options.maxEntries).map((child) =>
      toSafeValue(child, options, seen, depth + 1)
    );
  }

  const output: Record<string, unknown> = {};

  for (
    const [key, child] of Object.entries(value).slice(0, options.maxEntries)
  ) {
    output[key] = isRedactedKey(key, options)
      ? "[REDACTED]"
      : toSafeValue(child, options, seen, depth + 1);
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
      name: error.name,
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
      code: object.code ?? null,
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
