import { useCallback, useEffect, useState } from 'react';
import type { HealthResponse } from '@assistant/shared';
import { ApiError, fetchHealth } from '../lib/api';

export type HealthState =
  | { phase: 'loading' }
  | { phase: 'ready'; health: HealthResponse }
  | { phase: 'error'; error: ApiError };

export function useHealth() {
  const [state, setState] = useState<HealthState>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });
    fetchHealth(controller.signal)
      .then((health) => {
        if (!controller.signal.aborted) setState({ phase: 'ready', health });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          phase: 'error',
          error: error instanceof ApiError ? error : new ApiError('unknown', 'Something went wrong.'),
        });
      });
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
