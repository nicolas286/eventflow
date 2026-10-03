import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "../../supabaseEdgeSafe";
import {
  ASSET_MIME_TYPES,
  MAX_ASSET_BYTES,
  assetUploadQuerySchema,
  assetUploadResponseSchema,
} from "@contracts/organization-assets";

export type UploadResult = {
  path: string;
  publicUrl: string;
  publicUrlWithBust: string;
};

export function uploadOrgAssetsRepo(supabase: SupabaseClient) {
  async function upload(query: unknown, file: File): Promise<UploadResult> {
    const parsed = assetUploadQuerySchema.parse(query);
    if (!(file instanceof File) || !ASSET_MIME_TYPES.some((type) => type === file.type)) {
      throw new Error("Choisissez une image PNG, JPEG, WebP ou GIF.");
    }
    if (file.size === 0) throw new Error("Le fichier est vide. Choisissez une autre image.");
    if (file.size > MAX_ASSET_BYTES) throw new Error("L'image ne doit pas dépasser 5 Mo.");
    const search = new URLSearchParams({ orgId: parsed.orgId, kind: parsed.kind });
    if (parsed.eventId) search.set("eventId", parsed.eventId);
    const raw = await edgeSafe<unknown>(() =>
      supabase.functions.invoke(`organizations/assets/upload?${search}`, {
        body: file,
        headers: { "Content-Type": file.type },
      })
    );
    const result = assetUploadResponseSchema.parse(raw);
    const prefix = parsed.kind === "event_banner"
      ? `orgs/${parsed.orgId}/events/${parsed.eventId}/banner/`
      : `orgs/${parsed.orgId}/${parsed.kind}/`;
    const publicUrl = new URL(result.publicUrl);
    const previewUrl = new URL(result.publicUrlWithBust);
    if (!result.path.startsWith(prefix) ||
      !["https:", "http:"].includes(publicUrl.protocol) ||
      !publicUrl.pathname.endsWith(`/public-assets/${result.path}`) ||
      previewUrl.origin !== publicUrl.origin || previewUrl.pathname !== publicUrl.pathname) {
      throw new Error("Impossible de vérifier le fichier importé. Réessayez.");
    }
    return result;
  }

  return {
    async uploadOrgLogo(params: { orgId: string; file: File }): Promise<UploadResult> {
      const { file, ...query } = params;
      if ("kind" in query) throw new Error("Les paramètres du fichier sont invalides.");
      return upload({ ...query, kind: "logo" }, file);
    },
    async uploadOrgDefaultBanner(params: { orgId: string; file: File }): Promise<UploadResult> {
      const { file, ...query } = params;
      if ("kind" in query) throw new Error("Les paramètres du fichier sont invalides.");
      return upload({ ...query, kind: "default_banner" }, file);
    },
    async uploadEventBanner(params: { orgId: string; eventId: string; file: File }): Promise<UploadResult> {
      const { file, ...query } = params;
      if ("kind" in query) throw new Error("Les paramètres du fichier sont invalides.");
      return upload({ ...query, kind: "event_banner" }, file);
    },
  };
}
