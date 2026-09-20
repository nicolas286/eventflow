export class BodyTooLargeError extends Error {
  readonly status = 413;
  constructor() {
    super("PAYLOAD_TOO_LARGE");
  }
}

/** Read at most maxBytes even when Content-Length is absent or untrusted. */
export async function readLimitedText(
  req: Request,
  maxBytes = 65_536,
): Promise<string> {
  if (Number(req.headers.get("content-length")) > maxBytes) {
    throw new BodyTooLargeError();
  }
  if (!req.body) return "";
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new BodyTooLargeError();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function readLimitedJson(
  req: Request,
  maxBytes = 65_536,
): Promise<unknown> {
  return JSON.parse(await readLimitedText(req, maxBytes));
}
