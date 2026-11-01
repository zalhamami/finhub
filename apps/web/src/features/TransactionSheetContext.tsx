import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ApiTransaction } from '../lib/api';

// The sheet (form, date pickers, queries) is a lazy chunk, fetched the first time it opens.
const TransactionSheet = lazy(() => import('./TransactionSheet'));

export type SheetState =
  /** `accountId`: preselect this account (a transfer starts from it) */
  { mode: 'create'; accountId?: string } | { mode: 'edit'; tx: ApiTransaction };

interface Value {
  openCreate: () => void;
  /** Add sheet with this account preselected (a transfer starts from it). */
  openCreateForAccount: (accountId: string) => void;
  openEdit: (tx: ApiTransaction) => void;
  isOpen: boolean;
}
const Ctx = createContext<Value | null>(null);

export function useTransactionSheet(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTransactionSheet must be used inside <TransactionSheetProvider>');
  return v;
}

/** Owns the add/edit transaction sheet so the header button, FAB, "n" shortcut and list rows share it. */
export function TransactionSheetProvider({ children }: { children: ReactNode }) {
  // the last sheet is kept while closing so the form does not flash empty during the exit animation
  const [sheet, setSheet] = useState<SheetState>({ mode: 'create' });
  const [opened, setOpened] = useState(false);
  // bumps on every open so the form always starts fresh
  const [openCount, setOpenCount] = useState(0);
  const [mounted, setMounted] = useState(false);
  const value = useMemo<Value>(() => {
    const open = (s: SheetState) => {
      setMounted(true);
      setOpenCount((n) => n + 1);
      setSheet(s);
      setOpened(true);
    };
    return {
      openCreate: () => open({ mode: 'create' }),
      openCreateForAccount: (accountId) => open({ mode: 'create', accountId }),
      openEdit: (tx) => open({ mode: 'edit', tx }),
      isOpen: opened,
    };
  }, [opened]);
  return (
    <Ctx value={value}>
      {children}
      {mounted && (
        <Suspense fallback={null}>
          <TransactionSheet
            key={openCount}
            sheet={sheet}
            opened={opened}
            onClose={() => setOpened(false)}
          />
        </Suspense>
      )}
    </Ctx>
  );
}
