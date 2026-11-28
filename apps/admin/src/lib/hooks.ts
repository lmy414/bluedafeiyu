import { useEffect, useRef, useState } from 'react';
import { adminApi } from './api';
import type { Query } from './api';
import type { Page } from './models';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请重试';
}

type Resource<T> = string | null | ((signal: AbortSignal) => Promise<T>);

export function useResource<T>(resource: Resource<T>, query: Query = {}, pollMs?: number) {
  const queryKey = JSON.stringify(query);
  const key = typeof resource === 'function' ? resource : `${resource}${queryKey}`;
  const [result, setResult] = useState<{ key: typeof key; data?: T; error?: string }>();
  const [revision, setRevision] = useState(0);
  const reload = () => setRevision(value => value + 1);

  useEffect(() => {
    if (!resource) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load(source: Exclude<Resource<T>, null>) {
      try {
        const data = typeof source === 'function'
          ? await source(controller.signal)
          : await adminApi<T>(source, { query: JSON.parse(queryKey) as Query, signal: controller.signal });
        if (!controller.signal.aborted) setResult({ key, data });
      } catch (error) {
        if (!controller.signal.aborted) setResult(previous => ({ key, data: previous?.key === key ? previous.data : undefined, error: errorMessage(error) }));
      } finally {
        if (pollMs && !controller.signal.aborted) timer = setTimeout(() => void load(source), pollMs);
      }
    }
    void load(resource);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, resource, queryKey, revision, pollMs]);

  const current = result?.key === key ? result : undefined;
  return { data: current?.data, error: current?.error, loading: Boolean(resource && !current), reload };
}

export function useList<T>(resource: Exclude<Resource<Page<T> | T[]>, null>, query: Query = {}, pollMs?: number) {
  const result = useResource(resource, query, pollMs);
  const data = Array.isArray(result.data) ? { items: result.data } : result.data;
  return { ...result, data, rows: data?.items ?? [] };
}

export function useMutation() {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run<T>(action: () => Promise<T>, onSuccess: (value: T) => void) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      onSuccess(await action());
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return { busy, error, run };
}
