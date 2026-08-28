'use client';

import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/**
 * `true` once the component is running on the client, `false` during SSR and
 * the first hydration pass.
 *
 * Implemented with `useSyncExternalStore` rather than the usual
 * `useState(false)` + `useEffect(() => setMounted(true))` pair. That pattern
 * schedules a second render after commit, which the React Compiler's
 * `set-state-in-effect` rule flags — correctly, since the value is not really
 * state. `useSyncExternalStore` gets the same result from the server/client
 * snapshot split, with no extra render and no effect.
 *
 * Use it only for genuinely unknowable-during-SSR values, such as the resolved
 * colour theme or the platform's modifier key.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
