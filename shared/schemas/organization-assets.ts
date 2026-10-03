import { z } from "zod";

export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
export const ASSET_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export const assetExtensionSchema = z.enum(["png", "jpg", "webp", "gif"]);
const querySchema = z.object({
  orgId: z.uuid(),
  kind: z.enum(["logo", "default_banner", "event_banner"]),
  eventId: z.uuid().optional(),
}).strict();
function validEventRelation(input: { kind: string; eventId?: string }) {
  return input.kind === "event_banner"
    ? input.eventId !== undefined
    : input.eventId === undefined;
}
export const assetUploadQuerySchema = querySchema.refine(validEventRelation, {
  message: "INVALID_ASSET_EVENT",
  path: ["eventId"],
});
export const assetDeleteRequestSchema = querySchema.extend({
  assetId: z.uuid(),
  extension: assetExtensionSchema,
}).refine(validEventRelation, {
  message: "INVALID_ASSET_EVENT",
  path: ["eventId"],
});
export const assetUploadResponseSchema = z.object({
  path: z.string().regex(
    /^orgs\/[0-9a-f-]{36}\/(?:logo|default_banner|events\/[0-9a-f-]{36}\/banner)\/[0-9a-f-]{36}\.(?:png|jpg|webp|gif)$/i,
  ),
  publicUrl: z.url(),
  publicUrlWithBust: z.url(),
}).strict();
export const assetDeleteResponseSchema = z.object({ success: z.literal(true) })
  .strict();
export type AssetUploadQuery = z.infer<typeof assetUploadQuerySchema>;
