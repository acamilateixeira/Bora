import { useCallback, useState } from 'react';
import { useSession } from './SessionProvider';

export function useAction() {
  const { beginGlobalLoading, endGlobalLoading } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>) => {
      setLoading(true);
      setError(null);
      setMessage(null);
      beginGlobalLoading();
      try {
        const result = await fn();
        return result;
      } catch (err: any) {
        const msg = err?.message || 'Erro inesperado';
        setError(msg);
        throw err;
      } finally {
        endGlobalLoading();
        setLoading(false);
      }
    },
    [beginGlobalLoading, endGlobalLoading]
  );

  return { run, loading, error, message, setMessage, setError };
}
