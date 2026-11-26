import { useCallback, useEffect, useState } from 'react';
import type { AiStatus } from '@assistant/shared';
import { ApiError, fetchAiStatus } from '../lib/api';

export type AiState = { phase: 'loading' } | { phase: 'ready'; status: AiStatus } | { phase: 'error'; error: ApiError };

export function useAiStatus() {
  const [state, setState] = useState<AiState>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchAiStatus(controller.signal)
      .then((status) => !controller.signal.aborted && setState({ phase: 'ready', status }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ phase: 'error', error: error instanceof ApiError ? error : new ApiError('unknown', 'Something went wrong.') });
      });
    return () => controller.abort();
  }, [attempt]);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, refresh };
}
