import { useEffect, useState } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiError } from './api';
import { useToast } from '@/components/ui/overlay';

/** Mutation with toast feedback, field errors and cache invalidation. */
export function useAction<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>, opts: {
  success?: string | ((r: TResult) => string); invalidate?: QueryKey[]; onSuccess?: (r: TResult) => void;
} = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: fn,
    onMutate: () => setFieldErrors({}),
    onSuccess: async (r) => {
      for (const k of opts.invalidate ?? []) await qc.invalidateQueries({ queryKey: k });
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      opts.onSuccess?.(r);
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        setFieldErrors(e.fields);
        toast.error(e.message);
      } else toast.error('Something went wrong. Please try again.');
    },
  });
  return { ...m, fieldErrors };
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
