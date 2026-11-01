import { Badge, Button, Group, Select, TextInput } from '@mantine/core';
import { useDebouncedCallback, useMediaQuery } from '@mantine/hooks';
import { IconFilter, IconSearch, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { bySortOrder } from '../lib/accounts';
import type { ApiAccount, ApiCategory } from '../lib/api';
import { categorySelectData } from '../lib/categories';
import { todayJakarta } from '../lib/dates';
import { TX_TYPE_LABEL } from '../lib/transactions';
import {
  DATE_PRESETS,
  datePreset,
  hasActiveFilters,
  TX_TYPES,
  type TxFilters,
  type TxType,
} from '../lib/txFilters';
import { DateRangeField } from '../ui/dates';
import classes from './TransactionFilters.module.css';

export const SEARCH_DEBOUNCE_MS = 300;

interface Props {
  filters: TxFilters;
  accounts: ApiAccount[];
  categories: ApiCategory[];
  /** called with the complete next filter state */
  onChange: (next: TxFilters) => void;
}

const TYPE_DATA = TX_TYPES.map((value) => ({ value, label: TX_TYPE_LABEL[value] }));

/** Presentational filter bar. State lives in the URL; the page passes it in and receives changes. */
export function TransactionFilters({ filters, accounts, categories, onChange }: Props) {
  const desktop = useMediaQuery('(min-width: 48em)', true, { getInitialValueInEffect: false });
  const [mobileOpen, setMobileOpen] = useState(false);

  // Search text is local so typing is instant; the URL (and the query) follows 300 ms later.
  const [text, setText] = useState(filters.q ?? '');
  const committed = useRef(filters.q ?? '');
  const latest = useRef(filters);
  useEffect(() => {
    latest.current = filters;
  });
  const commit = useDebouncedCallback((value: string) => {
    committed.current = value.trim();
    onChange({ ...latest.current, q: value.trim() || undefined });
  }, SEARCH_DEBOUNCE_MS);
  useEffect(() => {
    // the URL changed from outside (reset, back button): follow it
    if ((filters.q ?? '') !== committed.current) {
      committed.current = filters.q ?? '';
      setText(filters.q ?? '');
    }
  }, [filters.q]);

  const set = (patch: Partial<TxFilters>) => onChange({ ...filters, ...patch });
  const today = todayJakarta();
  const activeCount = Object.keys(filters).filter((k) => k !== 'q').length;

  const accountData = accounts
    .filter((a) => !a.archived_at || a.id === filters.account)
    .sort(bySortOrder)
    .map((a) => ({ value: a.id, label: a.archived_at ? `${a.name} (arsip)` : a.name }));

  return (
    <div className={classes.bar}>
      <Group gap="sm" wrap="nowrap" className={classes.searchRow}>
        <TextInput
          className={classes.search}
          aria-label="Cari transaksi"
          placeholder="Cari catatan atau penerima"
          leftSection={<IconSearch size={18} stroke={1.75} />}
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value);
            commit(e.currentTarget.value);
          }}
        />
        <Button
          hiddenFrom="sm"
          variant="default"
          leftSection={<IconFilter size={18} stroke={1.75} />}
          rightSection={
            activeCount > 0 ? (
              <Badge size="sm" circle>
                {activeCount}
              </Badge>
            ) : undefined
          }
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((o) => !o)}
        >
          Filter
        </Button>
      </Group>

      <div hidden={!(desktop || mobileOpen)}>
        <div className={classes.fields}>
          <Select
            aria-label="Akun"
            placeholder="Semua akun"
            searchable
            clearable
            data={accountData}
            value={filters.account ?? null}
            onChange={(id) => set({ account: id ?? undefined })}
            nothingFoundMessage="Akun tidak ditemukan"
          />
          <Select
            aria-label="Kategori"
            placeholder="Semua kategori"
            searchable
            clearable
            data={categorySelectData(categories, null, { keep: filters.category })}
            value={filters.category ?? null}
            onChange={(id) => set({ category: id ?? undefined })}
            nothingFoundMessage="Kategori tidak ditemukan"
          />
          <Select
            aria-label="Jenis"
            placeholder="Semua jenis"
            clearable
            data={TYPE_DATA}
            value={filters.type ?? null}
            onChange={(t) => set({ type: (t as TxType | null) ?? undefined })}
          />
          <DateRangeField
            aria-label="Rentang tanggal"
            placeholder="Semua tanggal"
            clearable
            value={[filters.from ?? null, filters.to ?? null]}
            onChange={([from, to]) => {
              // wait for both ends; clearing sends both as null
              if ((from && to) || (!from && !to))
                set({ from: from ?? undefined, to: to ?? undefined });
            }}
          />
        </div>
        <Group gap="xs" mt="sm" wrap="wrap">
          {DATE_PRESETS.map(({ name, label }) => {
            const range = datePreset(name, today);
            const active = filters.from === range.from && filters.to === range.to;
            return (
              <Button
                key={name}
                size="compact-sm"
                variant={active ? 'light' : 'default'}
                aria-pressed={active}
                onClick={() => set(range)}
              >
                {label}
              </Button>
            );
          })}
          {hasActiveFilters(filters) && (
            <Button
              size="compact-sm"
              variant="subtle"
              color="dark"
              leftSection={<IconX size={16} stroke={1.75} />}
              onClick={() => {
                committed.current = '';
                setText('');
                onChange({});
              }}
            >
              Reset filter
            </Button>
          )}
        </Group>
      </div>
    </div>
  );
}
