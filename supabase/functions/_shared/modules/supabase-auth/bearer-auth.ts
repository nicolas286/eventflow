import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  isSupabaseAuthenticationError,
  RequestAuthenticationError,
} from "./errors.ts";

export function parseBearerToken(authorization: string): string {
  const match = /^Bearer[\t ]+([^\s]+)$/i.exec(authorization.trim());
  if (!match) {
    throw new RequestAuthenticationError("Malformed Authorization header");
  }
  return match[1];
}

export async function resolveSupabaseBearerUser(
  req: Request,
  authClient: Pick<SupabaseClient, "auth">,
): Promise<User | null> {
  const authorization = req.headers.get("authorization");
  if (!authorization) return null;

  const accessToken = parseBearerToken(authorization);
  let result: Awaited<ReturnType<typeof authClient.auth.getUser>>;

  try {
    result = await authClient.auth.getUser(accessToken);
  } catch (error) {
    if (isSupabaseAuthenticationError(error)) {
      throw new RequestAuthenticationError(
        "Invalid authentication token",
        error,
      );
    }
    throw error;
  }

  if (result.error) {
    if (isSupabaseAuthenticationError(result.error)) {
      throw new RequestAuthenticationError(
        "Invalid authentication token",
        result.error,
      );
    }
    throw result.error;
  }

  if (!result.data.user) {
    throw new RequestAuthenticationError("Authenticated request has no user");
  }

  return result.data.user;
}
