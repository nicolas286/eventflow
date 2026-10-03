import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeError } from "@errors/errors";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { getSessionScope } from "@gateways/supabase/sessionScope";

export function usePlatformQuery<T>(load: () => Promise<T>, queryKey = "default") {
  const { session } = useAuth();
  const sessionScope = getSessionScope(session);
  const key = JSON.stringify([sessionScope, queryKey]);
  const [result, setResult] = useState<{ key: string; data: T | null; loading: boolean; error: string | null }>({ key, data: null, loading: true, error: null });
  const loaderRef = useRef(load);
  const activeKeyRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  useEffect(() => { loaderRef.current = load; }, [load]);

  const request = useCallback(async () => {
    if (sessionScope === null || activeKeyRef.current !== key) return;
    const generation = ++generationRef.current;
    const isCurrent = () => activeKeyRef.current === key && generationRef.current === generation;
    try {
      const data = await loaderRef.current();
      if (isCurrent()) setResult({ key, data, loading: false, error: null });
    } catch (cause) {
      if (isCurrent()) setResult({ key, data: null, loading: false, error: normalizeError(cause, "Impossible de charger ces données.").message });
    }
  }, [key, sessionScope]);

  const reload = useCallback(async () => {
    if (sessionScope === null || activeKeyRef.current !== key) return;
    setResult({ key, data: null, loading: true, error: null });
    await request();
  }, [key, request, sessionScope]);

  useEffect(() => {
    activeKeyRef.current = key;
    void request();
    return () => { activeKeyRef.current = null; };
  }, [key, request]);
  // Mask on the very first render of a different identity/org, before effects.
  const current = sessionScope !== null && result.key === key;
  return { data: current ? result.data : null, loading: current ? result.loading : sessionScope !== null, error: current ? result.error : null, reload };
}
