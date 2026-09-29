import { useCallback, useEffect, useMemo, useState } from "react";
import type { OrderPublicResponse } from "@contracts/orders-read";
import { fetchWidgetConfirmationOrder } from "../data/widgetConfirmationRepo";
import type { WidgetOrderCredentials } from "../helpers/widgetConfirmation";

type Request = { credentials: WidgetOrderCredentials | null; attempt: number };
type Result = { request: Request; order: OrderPublicResponse | null; error: string | null };

export function useWidgetConfirmationOrder(credentials: WidgetOrderCredentials | null) {
  const [attempt, setAttempt] = useState(0);
  const request = useMemo(() => ({ credentials, attempt }), [credentials, attempt]);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!request.credentials) return;
    const controller = new AbortController();
    let active = true;

    void fetchWidgetConfirmationOrder(request.credentials, controller.signal).then(
      (order) => {
        if (active) setResult({ request, order, error: null });
      },
      () => {
        if (active) setResult({ request, order: null, error: "Impossible de vérifier votre réservation. Réessayez ou utilisez le lien reçu par e-mail." });
      },
    );

    return () => {
      active = false;
      controller.abort();
    };
  }, [request]);

  const current = result?.request === request ? result : null;
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);
  return {
    order: current?.order ?? null,
    error: current?.error ?? null,
    loading: Boolean(credentials && !current),
    refresh,
  };
}
