import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EdgeRequestError, humanEdgeRequestMessage } from "@errors/edgeRequestError";
import type { OrderPublicResponse } from "@contracts/orders-read";
import { fetchWidgetConfirmationOrder } from "../data/widgetConfirmationRepo";
import type { WidgetOrderCredentials } from "../helpers/widgetConfirmation";

type Request = { credentials: WidgetOrderCredentials | null; attempt: number };
type Result = { request: Request; order: OrderPublicResponse | null; error: string | null };

export function useWidgetConfirmationOrder(credentials: WidgetOrderCredentials | null) {
  const [attempt, setAttempt] = useState(0);
  const request = useMemo(() => ({ credentials, attempt }), [credentials, attempt]);
  const [result, setResult] = useState<Result | null>(null);
  const retryAt = useRef(0);

  useEffect(() => {
    if (!request.credentials) return;
    const controller = new AbortController();
    let active = true;

    void fetchWidgetConfirmationOrder(request.credentials, controller.signal).then(
      (order) => {
        if (active) setResult({ request, order, error: null });
      },
      (cause: unknown) => {
        if (!active) return;
        if (cause instanceof EdgeRequestError) {
          retryAt.current = Date.now() + cause.retryAfterSeconds * 1000;
        }
        setResult({ request, order: null, error: cause instanceof EdgeRequestError
          ? humanEdgeRequestMessage(cause)
          : "Impossible de vérifier votre réservation. Réessayez ou utilisez le lien reçu par e-mail." });
      },
    );

    return () => {
      active = false;
      controller.abort();
    };
  }, [request]);

  const current = result?.request === request ? result : null;
  const refresh = useCallback(() => {
    if (Date.now() >= retryAt.current) setAttempt((value) => value + 1);
  }, []);
  return {
    order: current?.order ?? null,
    error: current?.error ?? null,
    loading: Boolean(credentials && !current),
    refresh,
  };
}
