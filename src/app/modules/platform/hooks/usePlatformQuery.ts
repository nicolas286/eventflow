import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeError } from "@errors/errors";

export function usePlatformQuery<T>(load: () => Promise<T>, queryKey = "default") {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadersRef = useRef(new Map<string, () => Promise<T>>());
  loadersRef.current.set(queryKey, load);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const currentLoad = loadersRef.current.get(queryKey);
      if (!currentLoad) throw new Error("PLATFORM_QUERY_NOT_FOUND");
      setData(await currentLoad());
    } catch (cause) {
      setError(normalizeError(cause, "Impossible de charger ces données.").message);
    } finally {
      setLoading(false);
    }
  }, [queryKey]);

  useEffect(() => { void reload(); }, [reload]);
  return { data, loading, error, reload };
}
