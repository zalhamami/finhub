import {
  Alert,
  Button,
  Card,
  Group,
  Skeleton,
  Stack,
  Switch,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { IconAlertCircle, IconArrowsSort, IconCategory, IconPlus } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CategoryForm } from '../features/CategoryForm';
import { CategoryTree } from '../features/CategoryTree';
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  setCategoryArchived,
  updateCategory,
  type ApiCategory,
  type CategoryKind,
  type CategoryPayload,
} from '../lib/api';
import { moveItem } from '../lib/accounts';
import { CATEGORY_KIND_LABEL, flattenCategories, type CategoryRow } from '../lib/categories';
import { friendlyError } from '../lib/errors';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ResponsiveFormSheet } from '../ui/ResponsiveFormSheet';

type Sheet = { mode: 'create' } | { mode: 'edit'; category: ApiCategory } | null;

const findNode = (nodes: ApiCategory[], id: string): ApiCategory | undefined => {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return undefined;
};

export function CategoriesPage() {
  const qc = useQueryClient();
  const categories = useQuery({ queryKey: ['categories'], queryFn: fetchCategories });
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ApiCategory | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['categories'] });
  const closeSheet = () => {
    setSheet(null);
    setFormError(null);
  };

  const save = useMutation({
    mutationFn: (payload: Omit<CategoryPayload, 'kind'>) =>
      sheet?.mode === 'edit'
        ? updateCategory(sheet.category.id, payload)
        : createCategory({ ...payload, kind }),
    onSuccess: async () => {
      await refresh();
      closeSheet();
    },
    onError: (e) => setFormError(friendlyError(e, 'category')),
  });
  const archive = useMutation({
    mutationFn: (c: ApiCategory) => setCategoryArchived(c.id, c.archived_at === null),
    onSuccess: async () => {
      await refresh();
      closeSheet();
    },
    onError: (e) => setFormError(friendlyError(e, 'category')),
  });
  const remove = useMutation({
    mutationFn: (c: ApiCategory) => deleteCategory(c.id),
    onSuccess: async () => {
      await refresh();
      setConfirmDelete(null);
      closeSheet();
    },
    onError: (e) => setDeleteError(friendlyError(e, 'category')),
  });
  const reorder = useMutation({
    // No bulk endpoint for categories: patch only the siblings whose position changed.
    mutationFn: (updates: { id: string; sort_order: number }[]) =>
      Promise.all(updates.map((u) => updateCategory(u.id, { sort_order: u.sort_order }))),
    onSuccess: refresh,
  });

  if (categories.isError) {
    return (
      <Alert
        color="gray"
        icon={<IconAlertCircle size={20} stroke={1.75} />}
        title="Gagal memuat data"
      >
        <Stack gap="sm" align="flex-start">
          <Text size="sm">Kategori belum bisa ditampilkan. Periksa koneksi lalu coba lagi.</Text>
          <Button variant="default" size="xs" onClick={() => void categories.refetch()}>
            Coba lagi
          </Button>
        </Stack>
      </Alert>
    );
  }
  if (!categories.data) {
    return (
      <Stack gap="md" aria-busy="true" aria-label="Memuat">
        <Skeleton height={32} width={160} />
        <Skeleton height={260} radius="lg" />
      </Stack>
    );
  }

  const roots = categories.data;
  const rows = flattenCategories(roots, kind, showArchived);
  const hasArchived = (function any(nodes: ApiCategory[]): boolean {
    return nodes.some((n) => n.archived_at !== null || any(n.children));
  })(roots);

  const onMove = (row: CategoryRow, dir: 'up' | 'down') => {
    const siblings = row.siblingIds
      .map((id) => findNode(roots, id))
      .filter((n): n is ApiCategory => !!n)
      .map((n) => ({ id: n.id, sort_order: n.sort_order }));
    const updates = moveItem(siblings, row.category.id, dir);
    if (updates.length) reorder.mutate(updates);
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Title order={2}>Kategori</Title>
        <Group gap="xs">
          <Button
            variant={sorting ? 'light' : 'default'}
            leftSection={<IconArrowsSort size={18} stroke={1.75} />}
            aria-pressed={sorting}
            onClick={() => setSorting((s) => !s)}
          >
            {sorting ? 'Selesai' : 'Urutkan'}
          </Button>
          <Button
            leftSection={<IconPlus size={18} stroke={1.75} />}
            onClick={() => setSheet({ mode: 'create' })}
          >
            Tambah kategori
          </Button>
        </Group>
      </Group>

      <Tabs value={kind} onChange={(v) => v && setKind(v as CategoryKind)}>
        <Tabs.List>
          {(['expense', 'income'] as const).map((k) => (
            <Tabs.Tab key={k} value={k}>
              {CATEGORY_KIND_LABEL[k]}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      {hasArchived && (
        <Switch
          label="Tampilkan arsip"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.currentTarget.checked)}
        />
      )}

      {rows.length === 0 ? (
        <Card style={{ textAlign: 'center' }}>
          <Stack align="center" gap="xs">
            <IconCategory size={36} stroke={1.75} />
            <Title order={3}>Belum ada kategori {CATEGORY_KIND_LABEL[kind].toLowerCase()}</Title>
            <Button mt="xs" onClick={() => setSheet({ mode: 'create' })}>
              Tambah kategori
            </Button>
          </Stack>
        </Card>
      ) : (
        <Card padding={0}>
          <CategoryTree
            rows={rows}
            sorting={sorting}
            onEdit={(category) => setSheet({ mode: 'edit', category })}
            onMove={onMove}
          />
        </Card>
      )}

      <ResponsiveFormSheet
        opened={sheet !== null}
        onClose={closeSheet}
        title={sheet?.mode === 'edit' ? 'Ubah kategori' : 'Tambah kategori'}
      >
        {sheet && (
          <CategoryForm
            key={sheet.mode === 'edit' ? sheet.category.id : `new-${kind}`}
            category={sheet.mode === 'edit' ? sheet.category : undefined}
            kind={kind}
            roots={roots}
            submitting={save.isPending}
            error={formError}
            onSubmit={(payload) => {
              setFormError(null);
              save.mutate(payload);
            }}
            onToggleArchive={
              sheet.mode === 'edit' ? () => archive.mutate(sheet.category) : undefined
            }
            onDelete={
              sheet.mode === 'edit'
                ? () => {
                    setDeleteError(null);
                    setConfirmDelete(sheet.category);
                  }
                : undefined
            }
          />
        )}
      </ResponsiveFormSheet>

      <ConfirmDialog
        opened={confirmDelete !== null}
        title="Hapus kategori?"
        message={`Kategori "${confirmDelete?.name ?? ''}" akan dihapus permanen. Kategori yang sudah dipakai transaksi tidak bisa dihapus; arsipkan saja.`}
        confirmLabel="Hapus"
        loading={remove.isPending}
        error={deleteError}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove.mutate(confirmDelete)}
      />
    </Stack>
  );
}
