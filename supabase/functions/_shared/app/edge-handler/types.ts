import type { SupabaseClient, User } from "npm:@supabase/supabase-js@2.75.0";
import type { EdgeLogger } from "../../modules/logger/mod.ts";
import type { HttpMethod } from "../../modules/http/mod.ts";
import type { RequestSupabaseContextOptions } from "../request-context.ts";

export type EdgeAuthMode = "required" | "optional" | "none";
export type EdgeHttpMethod = Exclude<HttpMethod, "OPTIONS">;

type AuthenticatedContext<TAuth extends EdgeAuthMode> = TAuth extends "required"
  ? { user: User }
  : { user: User | null };

type ServiceContext<TServiceClient extends boolean> = TServiceClient extends
  true ? { serviceClient: SupabaseClient } : Record<never, never>;

export type EdgeHandlerContext<
  TAuth extends EdgeAuthMode,
  TServiceClient extends boolean,
> =
  & {
    req: Request;
    logger: EdgeLogger;
    supabase: SupabaseClient;
  }
  & AuthenticatedContext<TAuth>
  & ServiceContext<TServiceClient>;

export type EdgeHandlerOptions<
  TAuth extends EdgeAuthMode,
  TServiceClient extends boolean,
> = {
  name: string;
  method: EdgeHttpMethod | readonly EdgeHttpMethod[];
  auth: TAuth;
  serviceClient?: TServiceClient;
  requireVerifiedEmail?: boolean;
  requestContextOptions?: RequestSupabaseContextOptions;
  authenticationRequiredResponse?: (req: Request) => Response;
  emailNotVerifiedResponse?: (req: Request) => Response;
  methodNotAllowedResponse?: (req: Request) => Response;
  onError?: (context: {
    req: Request;
    logger: EdgeLogger;
    error: unknown;
  }) => Response | Promise<Response>;
};

export type EdgeHandler<
  TAuth extends EdgeAuthMode,
  TServiceClient extends boolean,
> = (
  context: EdgeHandlerContext<TAuth, TServiceClient>,
) => Response | Promise<Response>;
