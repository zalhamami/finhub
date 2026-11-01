import { Alert, Button, Card, Group, Skeleton, Stack, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconWallet } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Amount } from '../components/Amount';
import {
  fetchNetWorth,
  type AccountKind,
  type NetWorthAccount,
  type NetWorthReport,
} from '../lib/api';
import { KIND_LABEL } from '../lib/accounts';
import { dayjs } from '../lib/dayjs';
import { parseMinor } from '../lib/money';
import classes from './NetWorthPage.module.css';

const ASSET_KINDS = ['cash', 'bank', 'ewallet', 'investment'] as const;

export function NetWorthPage() {
  const netWorth = useQuery({ queryKey: ['reports', 'net-worth'], queryFn: fetchNetWorth });

  if (netWorth.isError) {
    return (
      <Alert
        color="gray"
        icon={<IconAlertCircle size={20} stroke={1.75} />}
        title="Gagal memuat data"
      >
        <Stack gap="sm" align="flex-start">
          <Text size="sm">
            Kekayaan Anda belum bisa ditampilkan. Periksa koneksi lalu coba lagi.
          </Text>
          <Button variant="default" size="xs" onClick={() => void netWorth.refetch()}>
            Coba lagi
          </Button>
        </Stack>
      </Alert>
    );
  }
  if (!netWorth.data) return <NetWorthSkeleton />;
  return <NetWorthView netWorth={netWorth.data} />;
}

function NetWorthSkeleton() {
  return (
    <Stack gap="lg" aria-busy="true" aria-label="Memuat">
      <Stack gap="xs">
        <Skeleton height={14} width={120} />
        <Skeleton height={44} width="min(320px, 80%)" />
      </Stack>
      <div className={classes.grid}>
        <Skeleton height={260} radius="lg" />
        <Skeleton height={260} radius="lg" />
      </div>
    </Stack>
  );
}

export function NetWorthView({ netWorth }: { netWorth: NetWorthReport }) {
  // Per-account values come from the net-worth report itself (holdings included), so the rows
  // of a group always add up to its total.
  const byKind = (kind: AccountKind) => netWorth.accounts.filter((a) => a.kind === kind);
  if (netWorth.accounts.length === 0) return <EmptyState />;

  const assetGroups = ASSET_KINDS.filter((k) => byKind(k).length > 0);
  const liabilities = byKind('liability');
  const missing = netWorth.missing_rates;
  const missingNames = [...new Set(missing.map((m) => m.account_name))];

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Text size="sm" c="dimmed" fw={500}>
          Kekayaan bersih
        </Text>
        <Title order={1} component="div">
          <Amount minor={netWorth.net_worth_minor} hero />
        </Title>
        <Text size="xs" c="dimmed">
          per {dayjs(netWorth.as_of).format('D MMMM YYYY')}
        </Text>
      </Stack>

      <div className={classes.grid}>
        <Card>
          <SectionHeader title="Aset" minor={netWorth.assets_minor} />
          <Stack gap="md" mt="sm">
            {assetGroups.map((kind) => (
              <AccountGroup
                key={kind}
                label={KIND_LABEL[kind]}
                total={netWorth.by_kind[kind]}
                accounts={byKind(kind)}
                baseCurrency={netWorth.base_currency}
              />
            ))}
            {assetGroups.length === 0 && (
              <Text size="sm" c="dimmed">
                Belum ada aset.
              </Text>
            )}
          </Stack>
        </Card>

        <Stack gap="lg">
          <Card>
            <Text fw={600} mb="sm">
              Komposisi aset
            </Text>
            <CompositionBar netWorth={netWorth} />
          </Card>
          <Card>
            <SectionHeader title="Liabilitas" minor={netWorth.liabilities_minor} />
            <Stack gap="md" mt="sm">
              {liabilities.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Tidak ada liabilitas.
                </Text>
              ) : (
                <AccountGroup accounts={liabilities} baseCurrency={netWorth.base_currency} />
              )}
            </Stack>
          </Card>
        </Stack>
      </div>

      {missing.length > 0 && (
        <Text size="xs" c="dimmed" role="note">
          Kurs atau harga belum tersedia untuk {missingNames.join(', ')}; akun ini belum dihitung
          dalam total.
        </Text>
      )}
    </Stack>
  );
}

function SectionHeader({ title, minor }: { title: string; minor: string }) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Text fw={600}>{title}</Text>
      <Text fw={600} component="div">
        <Amount minor={minor} />
      </Text>
    </Group>
  );
}

function AccountGroup({
  label,
  total,
  accounts,
  baseCurrency,
}: {
  label?: string;
  total?: string;
  accounts: NetWorthAccount[];
  baseCurrency: string;
}) {
  return (
    <div>
      {label && (
        <Group justify="space-between" wrap="nowrap" className={classes.groupHead}>
          <Text size="sm" fw={600}>
            {label}
          </Text>
          <Text size="sm" fw={600} component="div">
            <Amount minor={total} />
          </Text>
        </Group>
      )}
      {accounts.map((a) => {
        const value = a.value_base_minor;
        return (
          <Group key={a.id} justify="space-between" wrap="nowrap" className={classes.row}>
            <Text size="sm" truncate>
              {a.name}
              {a.currency !== baseCurrency && (
                <Text span size="xs" c="dimmed" ml={6}>
                  {a.currency}
                </Text>
              )}
            </Text>
            <Text size="sm" component="div" c={value === null ? 'dimmed' : undefined}>
              <Amount minor={value} tone={a.kind === 'liability' ? 'neutral' : 'plain'} />
            </Text>
          </Group>
        );
      })}
    </div>
  );
}

const KIND_CLASS: Record<AccountKind, string> = {
  bank: classes.segBank!,
  investment: classes.segInvestment!,
  ewallet: classes.segEwallet!,
  cash: classes.segCash!,
  liability: '',
};

/** Thin bar: share of each asset kind in total assets. Shares are ratios (permille), not money. */
function CompositionBar({ netWorth }: { netWorth: NetWorthReport }) {
  const total = parseMinor(netWorth.assets_minor) ?? 0n;
  const parts = (['bank', 'investment', 'ewallet', 'cash'] as const)
    .map((kind) => ({ kind, value: parseMinor(netWorth.by_kind[kind]) ?? 0n }))
    .filter((p) => p.value > 0n && total > 0n)
    .map((p) => ({ ...p, permille: Number((p.value * 1000n) / total) }));
  if (parts.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        Belum ada aset untuk ditampilkan.
      </Text>
    );
  }
  return (
    <Stack gap="sm">
      <div className={classes.bar} role="img" aria-label="Komposisi aset menurut jenis">
        {parts.map((p) => (
          <div
            key={p.kind}
            className={`${classes.seg} ${KIND_CLASS[p.kind]}`}
            style={{ flexGrow: p.permille }}
          />
        ))}
      </div>
      <div className={classes.legend}>
        {parts.map((p) => (
          <Text key={p.kind} size="xs" c="dimmed" className={classes.legendItem}>
            <span className={`${classes.dot} ${KIND_CLASS[p.kind]}`} />
            {KIND_LABEL[p.kind]}{' '}
            {(p.permille / 10).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%
          </Text>
        ))}
      </div>
    </Stack>
  );
}

function EmptyState() {
  return (
    <Card className={classes.empty}>
      <Stack align="center" gap="xs">
        <IconWallet size={36} stroke={1.75} />
        <Title order={3}>Belum ada akun</Title>
        <Text size="sm" c="dimmed" maw={360}>
          Tambahkan rekening, e-wallet, atau kas untuk mulai melihat kekayaan bersih Anda.
          Kelola akun di halaman Akun.
        </Text>
      </Stack>
    </Card>
  );
}
