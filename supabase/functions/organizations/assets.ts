import {
  ASSET_MIME_TYPES,
  assetDeleteRequestSchema,
  assetDeleteResponseSchema,
  type AssetUploadQuery,
  assetUploadQuerySchema,
  assetUploadResponseSchema,
  MAX_ASSET_BYTES,
} from "../../../shared/schemas/organization-assets.ts";
import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";
import {
  BodyTooLargeError,
  readLimitedJson,
} from "../_shared/app/request-body.ts";
import { consumeRequestRateLimit } from "../_shared/app/rate-limit/mod.ts";
import { applicationRateLimits } from "../_shared/app/config/rate-limits.ts";
import { assertOrganizationManager } from "../_shared/organization-access.ts";
import { organizerInput } from "../_shared/organizer-dto.ts";
import {
  badRequest,
  forbidden,
  internal,
  ResponseError,
} from "../_shared/errors.ts";

function assetPath(
  input: AssetUploadQuery,
  assetId: string,
  extension: string,
) {
  const prefix = input.kind === "event_banner"
    ? `events/${input.eventId}/banner`
    : input.kind;
  return `orgs/${input.orgId}/${prefix}/${assetId}.${extension}`;
}
async function readImage(req: Request): Promise<Uint8Array> {
  if (Number(req.headers.get("content-length")) > MAX_ASSET_BYTES) {
    throw new BodyTooLargeError();
  }
  if (!req.body) throw badRequest("ASSET_CONTENT_INVALID");
  const reader = req.body.getReader();
  let bytes: Uint8Array = new Uint8Array(64 * 1024);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const nextSize = size + value.byteLength;
      if (nextSize > MAX_ASSET_BYTES) {
        await reader.cancel();
        throw new BodyTooLargeError();
      }
      if (nextSize > bytes.length) {
        const grown = new Uint8Array(
          Math.min(MAX_ASSET_BYTES, Math.max(nextSize, bytes.length * 2)),
        );
        grown.set(bytes);
        bytes = grown;
      }
      bytes.set(value, size);
      size = nextSize;
    }
  } finally {
    reader.releaseLock();
  }
  return bytes.subarray(0, size);
}
function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}
// Validate bounded container structures, not decoded pixels or full codecs.
// Never decompress untrusted uploads inside the Edge.
function pngValid(bytes: Uint8Array) {
  if (
    bytes.length < 57 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
  ) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let header = false;
  let image = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    const end = offset + length + 12;
    if (end > bytes.length || !/^[A-Za-z]{4}$/.test(type)) return false;
    let crc = 0xffffffff;
    for (let i = offset + 4; i < end - 4; i++) {
      crc ^= bytes[i];
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
    }
    if ((crc ^ 0xffffffff) >>> 0 !== view.getUint32(end - 4)) return false;
    if (!header && type !== "IHDR") return false;
    if (type === "IHDR") {
      if (
        header || length !== 13 || view.getUint32(offset + 8) === 0 ||
        view.getUint32(offset + 12) === 0
      ) return false;
      const depths: Record<number, readonly number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !depths[bytes[offset + 17]]?.includes(bytes[offset + 16]) ||
        bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 ||
        bytes[offset + 20] > 1
      ) return false;
      header = true;
    } else if (type === "IDAT") image ||= length > 0;
    else if (type === "IEND") {
      return image && length === 0 && end === bytes.length;
    } else if (type === "PLTE") {
      if (length === 0 || length > 768 || length % 3) {
        return false;
      }
    } else if (type[0] === type[0].toUpperCase()) return false;
    offset = end;
  }
  return false;
}
function jpegValid(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2;
  let frame = false;
  let scan = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) return frame && scan && offset === bytes.length;
    if (
      marker === undefined || marker === 0 || marker === 0xd8 ||
      marker >= 0xd0 && marker <= 0xd7 || offset + 2 > bytes.length
    ) return false;
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return false;
    if (
      [
        0xc0,
        0xc1,
        0xc2,
        0xc3,
        0xc5,
        0xc6,
        0xc7,
        0xc9,
        0xca,
        0xcb,
        0xcd,
        0xce,
        0xcf,
      ].includes(marker)
    ) {
      if (
        length < 8 || length !== 8 + 3 * bytes[offset + 7] ||
        bytes[offset + 7] === 0 ||
        bytes[offset + 3] * 256 + bytes[offset + 4] === 0 ||
        bytes[offset + 5] * 256 + bytes[offset + 6] === 0
      ) return false;
      frame = true;
    }
    if (marker === 0xda) {
      if (
        !frame || length < 6 || length !== 6 + 2 * bytes[offset + 2] ||
        bytes[offset + 2] === 0
      ) return false;
      scan = true;
      offset += length;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset++;
          continue;
        }
        const next = bytes[offset + 1];
        if (next === 0 || next >= 0xd0 && next <= 0xd7) {
          offset += 2;
          continue;
        }
        break;
      }
    } else offset += length;
  }
  return false;
}
function webpImageChunk(
  bytes: Uint8Array,
  offset: number,
  length: number,
  type: string,
) {
  if (type === "VP8 ") {
    return length >= 10 && !(bytes[offset] & 1) &&
      ascii(bytes, offset + 3, 3) === "\x9d\x01\x2a" &&
      ((bytes[offset + 6] + 256 * bytes[offset + 7]) & 0x3fff) > 0 &&
      ((bytes[offset + 8] + 256 * bytes[offset + 9]) & 0x3fff) > 0;
  }
  return type === "VP8L" && length >= 5 && bytes[offset] === 0x2f &&
    bytes[offset + 4] >> 5 === 0;
}
function webpValid(bytes: Uint8Array) {
  if (
    bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP"
  ) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== bytes.length - 8) return false;
  let offset = 12;
  let image = false;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (end + (length % 2) > bytes.length || (length % 2 && bytes[end] !== 0)) {
      return false;
    }
    if (type === "VP8 " || type === "VP8L") {
      if (!webpImageChunk(bytes, start, length, type)) return false;
      image = true;
    } else if (type === "VP8X" && length !== 10) return false;
    else if (type === "ANIM" && length !== 6) return false;
    else if (type === "ANMF") {
      if (length < 24) return false;
      let chunk = start + 16;
      let frame = false;
      while (chunk + 8 <= end) {
        const childType = ascii(bytes, chunk, 4);
        const childLength = view.getUint32(chunk + 4, true);
        if (
          chunk + 8 + childLength + (childLength % 2) > end ||
          (childLength % 2 && bytes[chunk + 8 + childLength] !== 0)
        ) return false;
        if (childType === "VP8 " || childType === "VP8L") {
          if (!webpImageChunk(bytes, chunk + 8, childLength, childType)) {
            return false;
          }
          frame = true;
        }
        chunk += 8 + childLength + (childLength % 2);
      }
      if (chunk !== end || !frame) return false;
      image = true;
    }
    offset = end + (length % 2);
  }
  return image && offset === bytes.length;
}
function gifValid(bytes: Uint8Array) {
  if (
    bytes.length < 14 || !["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6)) ||
    bytes[6] + 256 * bytes[7] === 0 || bytes[8] + 256 * bytes[9] === 0
  ) return false;
  let offset = 13 + ((bytes[10] & 0x80) ? 3 * (2 << (bytes[10] & 7)) : 0);
  let image = false;
  function blocks() {
    let nonempty = false;
    while (offset < bytes.length) {
      const length = bytes[offset++];
      if (length === 0) return nonempty;
      if (offset + length > bytes.length) return false;
      offset += length;
      nonempty = true;
    }
    return false;
  }
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) return image && offset === bytes.length;
    if (marker === 0x21) {
      if (offset >= bytes.length) return false;
      offset++;
      if (!blocks()) return false;
    } else if (marker === 0x2c) {
      if (
        offset + 9 > bytes.length ||
        bytes[offset + 4] + 256 * bytes[offset + 5] === 0 ||
        bytes[offset + 6] + 256 * bytes[offset + 7] === 0
      ) return false;
      const packed = bytes[offset + 8];
      offset += 9;
      if (packed & 0x80) offset += 3 * (2 << (packed & 7));
      const code = bytes[offset++];
      if (code < 2 || code > 8 || !blocks()) return false;
      image = true;
    } else return false;
  }
  return false;
}
function imageExtension(bytes: Uint8Array, mime: string): string {
  if (mime === "image/png" && pngValid(bytes)) return "png";
  if (mime === "image/jpeg" && jpegValid(bytes)) return "jpg";
  if (mime === "image/webp" && webpValid(bytes)) return "webp";
  if (mime === "image/gif" && gifValid(bytes)) return "gif";
  throw badRequest("ASSET_CONTENT_INVALID");
}

export const handleOrganizationAssetsRequest = createEdgeHandler({
  name: "organization-assets",
  method: "POST",
  auth: "required",
  serviceClient: true,
  onError: ({ req, error, logger }) => {
    if (error instanceof BodyTooLargeError) {
      return json(req, { error: "PAYLOAD_TOO_LARGE" }, 413);
    }
    if (error instanceof SyntaxError) {
      return json(req, { error: "INVALID_JSON" }, 400);
    }
    if (error instanceof ResponseError) {
      return json(req, { error: error.code }, error.status);
    }
    logger.error("asset_operation_failed", { code: "ASSET_OPERATION_FAILED" });
    return json(req, { error: "ASSET_OPERATION_FAILED" }, 500);
  },
}, async ({ req, user, serviceClient, logger }) => {
  const url = new URL(req.url);
  const upload = [
    "/organizations/assets/upload",
    "/functions/v1/organizations/assets/upload",
  ].includes(url.pathname);
  const remove = [
    "/organizations/assets/delete",
    "/functions/v1/organizations/assets/delete",
  ].includes(url.pathname);
  if (!upload && !remove) throw badRequest("UNKNOWN_ROUTE");
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (seen.has(key)) throw badRequest("VALIDATION_ERROR");
    seen.add(key);
  }
  if (remove && seen.size) throw badRequest("VALIDATION_ERROR");
  const input = upload
    ? organizerInput(
      assetUploadQuerySchema,
      Object.fromEntries(url.searchParams),
    )
    : organizerInput(
      assetDeleteRequestSchema,
      await readLimitedJson(req, 4096),
    );
  await assertOrganizationManager(serviceClient, input.orgId, user.id);
  if (input.kind === "event_banner") {
    const { data, error } = await serviceClient.from("events").select("id")
      .eq("org_id", input.orgId).eq("id", input.eventId).maybeSingle();
    if (error) throw internal("ASSET_RESOURCE_LOAD_FAILED");
    if (!data) throw forbidden();
  }
  const quota = await consumeRequestRateLimit({
    req,
    supabase: serviceClient,
    logger,
    key: `user:${user.id}:org:${input.orgId.toLowerCase()}`,
    ...applicationRateLimits.organizerWrite,
  });
  if (!quota.allowed) return quota.response;
  const bucket = serviceClient.storage.from("public-assets");
  if (remove) {
    const deletion = assetDeleteRequestSchema.parse(input);
    const path = assetPath(deletion, deletion.assetId, deletion.extension);
    const { error } = await bucket.remove([path]);
    if (error) throw internal("ASSET_DELETE_FAILED");
    return json(req, assetDeleteResponseSchema.parse({ success: true }));
  }
  const mime =
    req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ??
      "";
  if (!ASSET_MIME_TYPES.some((value) => value === mime)) {
    throw new ResponseError(415, "ASSET_TYPE_NOT_ALLOWED");
  }
  const bytes = await readImage(req);
  const extension = imageExtension(bytes, mime);
  const path = assetPath(input, crypto.randomUUID(), extension);
  const { data, error } = await bucket.upload(path, bytes, {
    contentType: mime,
    cacheControl: "0",
    upsert: false,
  });
  if (error || !data) throw internal("ASSET_UPLOAD_FAILED");
  const { data: publicData } = bucket.getPublicUrl(path);
  return json(
    req,
    assetUploadResponseSchema.parse({
      path,
      publicUrl: publicData.publicUrl,
      publicUrlWithBust: `${publicData.publicUrl}?v=${Date.now()}`,
    }),
  );
});
