import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  ColorInput,
  Group,
  MantineProvider,
  Stack,
  Text,
  NavLink,
  Title,
  UnstyledButton,
  useMantineTheme,
} from '@mantine/core';
import { useDebouncedCallback } from '@mantine/hooks';
import {
  IconAlertCircle,
  IconCategory,
  IconCheck,
  IconChevronRight,
  IconWallet,
} from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Amount } from '../components/Amount';
import { patchSettings } from '../lib/api';
import { isHex, type Accent } from '../theme/accent';
import { useAccent } from '../theme/AccentProvider';
import { cssVariablesResolver } from '../theme/theme';
import { ACCENT_PRESETS, ACCENT_PRESET_NAMES } from '../theme/tokens';
import classes from './SettingsPage.module.css';

export function SettingsPage() {
  const { accent, setAccent } = useAccent();
  const qc = useQueryClient();
  const [failed, setFailed] = useState(false);
  const previous = useRef<Accent>(accent);

  const save = useMutation({
    mutationFn: (next: Accent) => patchSettings({ accent: next }),
    onSuccess: (data) => {
      setFailed(false);
      qc.setQueryData(['settings'], data);
    },
    onError: () => {
      setFailed(true);
      setAccent(previous.current); // the server did not take it: go back to what is saved
    },
  });
  const saveLater = useDebouncedCallback((next: Accent) => save.mutate(next), 600);

  const choose = (next: Accent, immediate: boolean) => {
    if (next === accent) return;
    if (!save.isPending) previous.current = accent;
    setAccent(next);
    if (immediate) save.mutate(next);
    else saveLater(next);
  };

  const customValue = isHex(accent) ? accent : '';

  return (
    <Stack gap="lg">
      <Title order={2}>Pengaturan</Title>

      <Card>
        <Stack gap="md">
          <div>
            <Text fw={600}>Warna aksen</Text>
            <Text size="sm" c="dimmed">
              Dipakai untuk tombol, tautan, dan penanda aktif. Perubahan langsung terlihat dan
              tersimpan otomatis.
            </Text>
          </div>

          <div className={classes.swatches} role="group" aria-label="Pilihan warna aksen">
            {ACCENT_PRESET_NAMES.map((name) => (
              <UnstyledButton
                key={name}
                className={classes.swatch}
                data-active={accent === name || undefined}
                aria-pressed={accent === name}
                onClick={() => choose(name, true)}
              >
                <span
                  className={classes.chip}
                  style={{ '--chip-color': ACCENT_PRESETS[name].scale[5] } as React.CSSProperties}
                />
                {ACCENT_PRESETS[name].label}
              </UnstyledButton>
            ))}
          </div>

          <ColorInput
            label="Warna kustom"
            description="Kode hex, misalnya dari logo atau warna favorit Anda."
            placeholder="#rrggbb"
            format="hex"
            value={customValue}
            onChange={(value) => {
              if (isHex(value)) choose(value.toLowerCase() as Accent, false);
            }}
            maw={320}
          />

          {failed && (
            <Alert
              color="gray"
              icon={<IconAlertCircle size={20} stroke={1.75} />}
              title="Gagal menyimpan"
            >
              Warna belum tersimpan di server. Periksa koneksi lalu coba lagi.
            </Alert>
          )}
          {save.isSuccess && !failed && (
            <Group gap={6} c="dimmed">
              <IconCheck size={16} stroke={1.75} />
              <Text size="xs">Tersimpan</Text>
            </Group>
          )}
        </Stack>
      </Card>

      <Card padding="xs">
        <NavLink
          component={Link}
          to="/kategori"
          label="Kategori"
          description="Kelola kategori pengeluaran dan pemasukan"
          leftSection={<IconCategory size={20} stroke={1.75} />}
          rightSection={<IconChevronRight size={16} stroke={1.75} />}
        />
        <NavLink
          component={Link}
          to="/pengaturan/jenis-akun"
          label="Jenis akun"
          description="Kelola jenis akun seperti Bank, E-wallet, atau Saham"
          leftSection={<IconWallet size={20} stroke={1.75} />}
          rightSection={<IconChevronRight size={16} stroke={1.75} />}
        />
      </Card>

      <Card>
        <Stack gap="md">
          <Text fw={600}>Pratinjau</Text>
          <div className={classes.previews}>
            <Preview scheme="light" label="Mode terang" />
            <Preview scheme="dark" label="Mode gelap" />
          </div>
        </Stack>
      </Card>
    </Stack>
  );
}

/** A forced-scheme sandbox that follows the live theme, so both modes show at once. */
function Preview({ scheme, label }: { scheme: 'light' | 'dark'; label: string }) {
  const theme = useMantineTheme();
  const ref = useRef<HTMLDivElement>(null);
  const selector = `[data-preview='${scheme}']`;
  return (
    <div ref={ref} data-preview={scheme} className={classes.preview}>
      <MantineProvider
        theme={theme}
        forceColorScheme={scheme}
        cssVariablesSelector={selector}
        cssVariablesResolver={cssVariablesResolver}
        getRootElement={() => ref.current ?? undefined}
        withGlobalClasses={false}
      >
        <Stack gap="sm" align="flex-start">
          <Text size="xs" c="dimmed" fw={600}>
            {label}
          </Text>
          <Group gap="sm">
            <Button>Simpan</Button>
            <Badge>Aktif</Badge>
          </Group>
          <Anchor href="#pratinjau" onClick={(e) => e.preventDefault()} size="sm">
            Lihat semua transaksi
          </Anchor>
          <Text size="lg" fw={700} component="div">
            <Amount minor="1234500000" />
          </Text>
        </Stack>
      </MantineProvider>
    </div>
  );
}
