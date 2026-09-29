import { unauthorized } from "../../errors.ts";
import {
  assertWorkerAuthentication,
  assertWorkerToken,
  WorkerAuthenticationError,
} from "../../modules/worker-auth/mod.ts";

const LEGACY_SERVICE_TOKEN_HEADER = "x-service-token";

export type InternalEdgeAuthenticationSource =
  | "authorization-bearer"
  | "legacy-x-service-token";

export async function assertInternalEdgeAuthentication(
  req: Request,
  expectedToken: string,
  options: { allowLegacyServiceToken?: boolean } = {},
): Promise<InternalEdgeAuthenticationSource> {
  try {
    if (req.headers.has("authorization")) {
      await assertWorkerAuthentication(req, expectedToken);
      return "authorization-bearer";
    }

    if (options.allowLegacyServiceToken) {
      const legacyToken =
        req.headers.get(LEGACY_SERVICE_TOKEN_HEADER)?.trim() ??
          "";
      await assertWorkerToken(legacyToken, expectedToken);
      return "legacy-x-service-token";
    }

    await assertWorkerAuthentication(req, expectedToken);
    return "authorization-bearer";
  } catch (error) {
    if (error instanceof WorkerAuthenticationError) {
      throw unauthorized("UNAUTHORIZED");
    }

    throw error;
  }
}
