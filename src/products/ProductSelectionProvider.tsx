import { createContext, useCallback, useContext, useMemo, useRef, type PropsWithChildren } from 'react';

export type RoutineProductSelection = {
  stepId: string;
  productId: number;
  shelfItemId: string;
  productName: string;
};

type Listener = (selection: RoutineProductSelection) => void;
type SelectionContextValue = {
  registerRoutineProductListener: (listener: Listener) => () => void;
  deliverRoutineProductSelection: (selection: RoutineProductSelection) => void;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function ProductSelectionProvider({ children }: PropsWithChildren) {
  const listener = useRef<Listener | null>(null);
  const registerRoutineProductListener = useCallback((next: Listener) => {
    listener.current = next;
    return () => { if (listener.current === next) listener.current = null; };
  }, []);
  const deliverRoutineProductSelection = useCallback((selection: RoutineProductSelection) => listener.current?.(selection), []);
  const value = useMemo(() => ({ registerRoutineProductListener, deliverRoutineProductSelection }), [registerRoutineProductListener, deliverRoutineProductSelection]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useProductSelection() {
  const context = useContext(SelectionContext);
  if (!context) throw new Error('useProductSelection must be used inside ProductSelectionProvider.');
  return context;
}
