import { useCallback, useEffect, useRef, useState } from "react";

type AsyncState<T> =
  | { data: T | undefined; error: undefined; loading: true }
  | { data: T; error: undefined; loading: false }
  | { data: undefined; error: Error; loading: false };

export function useAsyncData<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<AsyncState<T>>({
    data: undefined,
    error: undefined,
    loading: true
  });
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  const silentReload = useCallback(async () => {
    try {
      const data = await loaderRef.current();
      setState({ data, error: undefined, loading: false });
    } catch {
      // Silent reloads swallow errors so a transient upstream blip
      // doesn't replace the currently-rendered data with an error state.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    setState({
      data: undefined,
      error: undefined,
      loading: true
    });

    loader()
      .then((data) => {
        if (!cancelled) {
          setState({
            data,
            error: undefined,
            loading: false
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            data: undefined,
            error: error instanceof Error ? error : new Error(String(error)),
            loading: false
          });
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadToken]);

  return { ...state, reload, silentReload };
}
