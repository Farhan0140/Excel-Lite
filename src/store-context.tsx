import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Store } from './engine/store';

export const StoreContext = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(StoreContext);

// re-render whenever anything in the sheet changes
export function useStoreSync(store: Store) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
