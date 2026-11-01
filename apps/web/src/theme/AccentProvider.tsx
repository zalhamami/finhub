import { MantineProvider } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchSettings } from '../lib/api';
import { isAccent, readStoredAccent, storeAccent, type Accent } from './accent';
import { cssVariablesResolver, createFinhubTheme } from './theme';

interface AccentContextValue {
  accent: Accent;
  /** Applies the accent to the live theme and caches it for the next first paint. */
  setAccent: (accent: Accent) => void;
}

const AccentContext = createContext<AccentContextValue | null>(null);

export function useAccent(): AccentContextValue {
  const ctx = useContext(AccentContext);
  if (!ctx) throw new Error('useAccent must be used inside <ThemeRoot>');
  return ctx;
}

/** MantineProvider whose theme follows the accent (initially: localStorage, else the default). */
export function ThemeRoot({
  children,
  initialAccent,
}: {
  children: ReactNode;
  initialAccent?: Accent;
}) {
  const [accent, setAccentState] = useState<Accent>(() => initialAccent ?? readStoredAccent());
  const theme = useMemo(() => createFinhubTheme({ accent }), [accent]);
  const setAccent = useCallback((next: Accent) => {
    storeAccent(next);
    setAccentState(next);
  }, []);
  const value = useMemo(() => ({ accent, setAccent }), [accent, setAccent]);
  return (
    <AccentContext value={value}>
      <MantineProvider
        theme={theme}
        cssVariablesResolver={cssVariablesResolver}
        defaultColorScheme="auto"
      >
        {children}
      </MantineProvider>
    </AccentContext>
  );
}

/** Pulls the saved accent from the server (inside QueryClientProvider) and adopts it. */
export function AccentSync() {
  const { setAccent } = useAccent();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
  const saved = data?.accent;
  useEffect(() => {
    if (saved && isAccent(saved)) setAccent(saved.toLowerCase() as Accent);
  }, [saved, setAccent]);
  return null;
}
